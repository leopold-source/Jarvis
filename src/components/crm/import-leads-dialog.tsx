"use client";

import { useState } from "react";
import { FileSpreadsheet, Sparkles, Upload, Wand2 } from "lucide-react";

import { Badge, Button, Input, Modal, useToast } from "@/components/ui";
import { fetchImportIndex, importLeads } from "@/app/(crm)/leads/actions";
import { cleanRowsWithAi } from "@/app/(crm)/leads/ai-actions";
import {
  buildLookup,
  classifyRow,
  VERDICT_STYLE,
  type DedupeVerdict,
} from "@/lib/leads-dedupe";
import { parseLeadsCsv, type ParsedLeadsCsv } from "@/lib/leads-csv";
import { cn } from "@/lib/utils";

type Row = Record<string, string | number | null>;
type Analysed = { row: Row; verdict: DedupeVerdict; reason: string };

/**
 * Import d'un export CSV de leads.
 *
 * Le fichier est analysé dans le navigateur, confronté à l'existant pour
 * repérer les doublons, puis — optionnellement — passé à Claude pour être
 * normalisé (régions, téléphones, casse) avant insertion. Rien n'est écrit
 * tant que l'aperçu n'est pas validé.
 */
export function ImportLeadsDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (inserted: number, skipped: number) => void;
}) {
  const toast = useToast();
  const [parsed, setParsed] = useState<ParsedLeadsCsv | null>(null);
  const [analysed, setAnalysed] = useState<Analysed[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState<"analyse" | "ia" | "import" | null>(null);
  const [aiChanges, setAiChanges] = useState<Array<{ label: string; changes: string[] }>>([]);
  const [aiInstruction, setAiInstruction] = useState("");

  function reset() {
    setParsed(null);
    setAnalysed(null);
    setFileName("");
    setAiChanges([]);
    setAiInstruction("");
  }

  /** Confronte les lignes à l'existant. Rejoué après un passage IA. */
  async function analyse(rows: Row[]) {
    setBusy("analyse");
    try {
      const lookup = buildLookup(await fetchImportIndex());
      const seen = { emails: new Set<string>(), people: new Set<string>() };
      setAnalysed(rows.map((row) => ({ row, ...classifyRow(row, lookup, seen) })));
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "Analyse impossible", "error");
    } finally {
      setBusy(null);
    }
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setFileName(file.name);
    setAiChanges([]);
    try {
      const result = parseLeadsCsv(await file.text());
      setParsed(result);
      await analyse(result.rows);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "Fichier illisible", "error");
      setParsed(null);
      setAnalysed(null);
    }
  }

  async function runAi() {
    if (!parsed) return;
    setBusy("ia");
    const result = await cleanRowsWithAi(parsed.rows, aiInstruction);
    setBusy(null);

    if (!result.ok) {
      toast(result.error, "error");
      return;
    }

    setParsed({ ...parsed, rows: result.rows });
    setAiChanges(result.changes.map(({ label, changes }) => ({ label, changes })));
    await analyse(result.rows);
    toast(
      result.changes.length === 0
        ? "Le fichier était déjà propre."
        : `${result.changes.length} ligne(s) corrigée(s) par l'IA.`,
    );
  }

  async function submit() {
    if (!analysed) return;
    const keepers = analysed.filter((entry) => entry.verdict !== "doublon").map((entry) => entry.row);
    if (keepers.length === 0) {
      toast("Toutes les lignes sont des doublons.", "error");
      return;
    }

    setBusy("import");
    const result = await importLeads(keepers);
    setBusy(null);

    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    const duplicates = analysed.length - keepers.length;
    reset();
    onImported(result.data!.inserted, duplicates + result.data!.skipped);
  }

  const tally = analysed
    ? {
        nouveau: analysed.filter((entry) => entry.verdict === "nouveau").length,
        entreprise_connue: analysed.filter((entry) => entry.verdict === "entreprise_connue").length,
        doublon: analysed.filter((entry) => entry.verdict === "doublon").length,
      }
    : null;

  const importable = tally ? tally.nouveau + tally.entreprise_connue : 0;

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      size="lg"
      title="Importer des leads"
      description="Fichier CSV exporté depuis votre table de prospection."
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Annuler
          </Button>
          <Button
            variant="primary"
            disabled={!analysed || importable === 0}
            loading={busy === "import"}
            onClick={submit}
          >
            Importer {importable > 0 ? `${importable} lead(s)` : ""}
          </Button>
        </>
      }
    >
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--border-strong)] px-6 py-7 text-center transition-colors hover:border-brand-500/60 hover:bg-[var(--surface-hover)]/50">
        <span className="grid size-10 place-items-center rounded-full bg-linear-to-br from-brand-500/25 to-accent-500/15 text-brand-300">
          <Upload className="size-4.5" />
        </span>
        <span className="text-[13.5px] font-medium">{fileName || "Choisir un fichier CSV"}</span>
        <span className="max-w-md text-[11.5px] text-[var(--text-muted)]">
          Colonnes reconnues : Name, Prénom, Nom, E-mail, Tél, Entreprise, Statut, Région, Relance,
          Valeur CA, Site entreprise, Url LinkedIn, Commentaire, Activité, Secteur, Adresse.
        </span>
        <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
      </label>

      {parsed ? (
        <div className="mt-4 space-y-3.5">
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <FileSpreadsheet className="size-4 text-brand-400" />
            <span>
              <span className="font-medium">{parsed.rows.length}</span> ligne(s) lues
              {parsed.skipped > 0 ? ` · ${parsed.skipped} ignorée(s) (ni nom ni e-mail)` : ""}
            </span>
            {tally ? (
              <span className="ml-auto flex gap-1.5">
                {tally.nouveau > 0 ? <Badge tone="stone">{tally.nouveau} nouveau(x)</Badge> : null}
                {tally.entreprise_connue > 0 ? (
                  <Badge tone="emerald">{tally.entreprise_connue} entreprise(s) connue(s)</Badge>
                ) : null}
                {tally.doublon > 0 ? <Badge tone="rose">{tally.doublon} doublon(s)</Badge> : null}
              </span>
            ) : null}
          </div>

          {parsed.unknownColumns.length > 0 ? (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11.5px] text-amber-600 ring-1 ring-amber-500/25 dark:text-amber-300">
              Colonnes ignorées : {parsed.unknownColumns.join(", ")}
            </p>
          ) : null}

          {/* --- Nettoyage assisté ------------------------------------- */}
          <div className="rounded-xl border border-[var(--border-subtle)] bg-linear-to-br from-brand-500/8 to-accent-500/5 p-3.5">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-brand-500/20 text-brand-300">
                <Sparkles className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">Ranger le fichier avec l&apos;IA</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
                  Claude normalise les régions à partir des adresses et codes postaux, met les
                  téléphones au format français et corrige la casse des entreprises. Il ne remplit
                  jamais un champ vide en inventant une donnée.
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <Input
                    value={aiInstruction}
                    onChange={(event) => setAiInstruction(event.target.value)}
                    placeholder="Consigne supplémentaire (facultatif)…"
                    className="h-8 min-w-52 flex-1 text-[12.5px]"
                  />
                  <Button size="sm" variant="secondary" loading={busy === "ia"} onClick={runAi}>
                    <Wand2 className="size-3.5" />
                    Nettoyer
                  </Button>
                </div>
              </div>
            </div>
            {aiChanges.length > 0 ? (
              <ul className="mt-3 max-h-32 space-y-1 overflow-y-auto border-t border-[var(--border-subtle)] pt-2.5 text-[11.5px]">
                {aiChanges.map((entry, index) => (
                  <li key={index} className="flex gap-2">
                    <span className="shrink-0 font-medium text-[var(--text-secondary)]">{entry.label}</span>
                    <span className="text-[var(--text-muted)]">{entry.changes.join(" · ")}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {/* --- Aperçu ------------------------------------------------- */}
          {analysed ? (
            <div className="max-h-64 overflow-auto rounded-lg border border-[var(--border-subtle)]">
              <table className="w-full text-left text-[12px]">
                <thead className="sticky top-0 bg-[var(--surface-overlay)] text-[10.5px] tracking-wide text-[var(--text-muted)] uppercase">
                  <tr className="border-b border-[var(--border-subtle)]">
                    <th className="px-2.5 py-1.5">Nom</th>
                    <th className="px-2.5 py-1.5">Entreprise</th>
                    <th className="px-2.5 py-1.5">Région</th>
                    <th className="px-2.5 py-1.5">Analyse</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {analysed.map((entry, index) => {
                    const style = VERDICT_STYLE[entry.verdict];
                    return (
                      <tr key={index} className={cn("transition-colors", style.row)}>
                        <td className="px-2.5 py-1.5">{String(entry.row.full_name ?? "—")}</td>
                        <td className="px-2.5 py-1.5">{String(entry.row.company_name ?? "—")}</td>
                        <td className="px-2.5 py-1.5 text-[var(--text-muted)]">
                          {String(entry.row.region ?? "—")}
                        </td>
                        <td className="px-2.5 py-1.5">
                          <Badge tone={style.tone}>{entry.reason}</Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[12px] text-[var(--text-muted)]">
              {busy === "analyse" ? "Analyse des doublons en cours…" : ""}
            </p>
          )}

          <p className="text-[11.5px] leading-relaxed text-[var(--text-muted)]">
            <span className="font-medium text-emerald-500">Vert</span> : l&apos;entreprise est déjà
            en relation mais cette personne est nouvelle — la ligne est importée.{" "}
            <span className="font-medium text-rose-500">Rose</span> : déjà en base, la ligne est
            ignorée.
          </p>
        </div>
      ) : null}
    </Modal>
  );
}
