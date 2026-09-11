"use client";

import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, FileSpreadsheet, Linkedin, MapPin, Sparkles, Upload, Wand2 } from "lucide-react";

import { Badge, Button, Input, Modal, useToast } from "@/components/ui";
import { fetchImportIndex, importLeads, syncLeadsFromCsv } from "@/app/(crm)/leads/actions";
import { cleanRowsWithAi } from "@/app/(crm)/leads/ai-actions";
import {
  buildLookup,
  classifyRow,
  VERDICT_STYLE,
  type DedupeVerdict,
} from "@/lib/leads-dedupe";
import { parseLeadsCsv, type ParsedLeadsCsv, type ParseOptions } from "@/lib/leads-csv";
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
  onImported: (inserted: number, skipped: number, updated?: number) => void;
}) {
  const toast = useToast();
  const [parsed, setParsed] = useState<ParsedLeadsCsv | null>(null);
  const [analysed, setAnalysed] = useState<Analysed[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState<"analyse" | "ia" | "import" | null>(null);
  const [aiChanges, setAiChanges] = useState<Array<{ label: string; changes: string[] }>>([]);
  const [aiInstruction, setAiInstruction] = useState("");
  /*
    Le texte du fichier, gardé après lecture.

    Les deux exclusions sont des choix, pas des règles : les rouvrir doit
    relire le fichier, pas obliger à le resélectionner. C'est aussi ce qui
    permet de voir l'effet de la case en la cochant.
  */
  const [source, setSource] = useState("");
  const [options, setOptions] = useState<ParseOptions>({});
  /*
    Corriger ce qui est déjà en base.

    Décoché par défaut : un import ajoute, il n'écrase pas. Mais quand le CSV
    est la table de prospection elle-même — et c'est le cas ici — il porte la
    vérité sur les statuts, et rien d'autre ne permet de réparer une fiche
    entrée de travers.
  */
  const [majDoublons, setMajDoublons] = useState(false);

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
      const seen = { emails: new Set<string>(), people: new Set<string>(), domains: new Set<string>() };
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
    const texte = await file.text();
    setSource(texte);
    await relire(texte, options);
  }

  async function relire(texte: string, choix: ParseOptions) {
    try {
      const result = parseLeadsCsv(texte, choix);
      setParsed(result);
      await analyse(result.rows);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "Fichier illisible", "error");
      setParsed(null);
      setAnalysed(null);
    }
  }

  function basculer(cle: keyof ParseOptions) {
    const suivant = { ...options, [cle]: !options[cle] };
    setOptions(suivant);
    if (source) void relire(source, suivant);
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

    if (!result.ok) {
      setBusy(null);
      toast(result.error, "error");
      return;
    }

    // La mise à jour porte sur tout le fichier, doublons compris : ce sont eux
    // qu'elle vise, et les lignes qui viennent d'être insérées sont déjà à jour.
    let updated = 0;
    if (majDoublons) {
      const sync = await syncLeadsFromCsv(analysed.map((entry) => entry.row));
      if (!sync.ok) {
        setBusy(null);
        toast(`Import fait, mise à jour impossible : ${sync.error}`, "error");
        return;
      }
      updated = sync.data!.updated;
    }

    setBusy(null);
    const duplicates = analysed.length - keepers.length;
    reset();
    onImported(result.data!.inserted, duplicates + result.data!.skipped, updated);
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
          Export de votre table de prospection ou d&apos;un outil de sourcing. Les en-têtes sont
          reconnus automatiquement, et le fichier vous dira lesquels il a lus.
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

          {/*
            Les statuts qu'on n'a pas su traduire.

            Un libellé inconnu devient « À contacter », ce qui remet à appeler
            une fiche déjà travaillée. Le dire au moment de l'import est la
            seule occasion de s'en apercevoir : une fois en base, la fiche est
            indistinguable d'un vrai nouveau lead.
          */}
          {parsed.unknownStatuses.length > 0 ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-[11.5px]">
              <p className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300">
                <AlertTriangle className="size-3.5" />
                {parsed.unknownStatuses.reduce((total, statut) => total + statut.count, 0)} fiche(s)
                avec un statut inconnu — elles arriveront en « À contacter »
              </p>
              <p className="mt-1 text-[var(--text-muted)]">
                {parsed.unknownStatuses
                  .map((statut) => `${statut.label} (${statut.count})`)
                  .join(" · ")}
              </p>
            </div>
          ) : null}

          {/* Les deux exclusions, dites avec leur compte et réversibles sur
              place : une case à cocher qui n'annonce pas ce qu'elle change
              n'aide pas à décider. */}
          <div className="space-y-1.5 rounded-lg border border-[var(--border-subtle)] px-3 py-2.5 text-[11.5px]">
            <Exclusion
              coche={Boolean(options.inclureHorsCible)}
              onChange={() => basculer("inclureHorsCible")}
              compte={parsed.excluded.horsCible}
              titre="fiche(s) hors cible ou en reconversion"
              detail="« Hors cible », « A changer de métier »"
            />
            <Exclusion
              coche={Boolean(options.inclureSansContact)}
              onChange={() => basculer("inclureSansContact")}
              compte={parsed.excluded.sansContact}
              titre="fiche(s) sans téléphone ni e-mail"
              detail="rien pour les joindre"
            />

            <label className="flex cursor-pointer items-center gap-2 border-t border-[var(--border-subtle)] pt-1.5 text-[var(--text-muted)]">
              <input
                type="checkbox"
                checked={majDoublons}
                onChange={() => setMajDoublons((valeur) => !valeur)}
                className="size-3.5 accent-[var(--brand-500,theme(colors.sky.500))]"
              />
              <span>
                <span className="text-[var(--text-secondary)]">
                  Corriger les {tally?.doublon ?? 0} fiche(s) déjà en base
                </span>
                <span className="ml-1 opacity-70">
                  — statut, relance et commentaire repris du fichier ; l&apos;ancienneté du
                  lead n&apos;est pas remise à zéro
                </span>
              </span>
            </label>
          </div>

          <ColumnReport parsed={parsed} />

          {/* --- Nettoyage assisté ------------------------------------- */}
          <div className="rounded-xl border border-[var(--border-subtle)] bg-linear-to-br from-brand-500/8 to-accent-500/5 p-3.5">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-brand-500/20 text-brand-300">
                <Sparkles className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">Ranger le fichier avec l&apos;IA</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
                  Les codes postaux et les téléphones sont déjà traités à la lecture, sans appel
                  au modèle. Claude reprend le reste : la casse des entreprises, les adresses sans
                  code postal, les régions mal orthographiées. Il ne remplit jamais un champ vide
                  en inventant une donnée.
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
                    <th className="px-2.5 py-1.5">Poste</th>
                    <th className="px-2.5 py-1.5">Entreprise</th>
                    <th className="px-2.5 py-1.5">Téléphone</th>
                    <th className="px-2.5 py-1.5">E-mail</th>
                    <th className="px-2.5 py-1.5">Région</th>
                    <th className="px-2.5 py-1.5">Analyse</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {analysed.map((entry, index) => {
                    const style = VERDICT_STYLE[entry.verdict];
                    return (
                      <tr key={index} className={cn("transition-colors", style.row)}>
                        <td className="px-2.5 py-1.5 whitespace-nowrap">
                          {String(entry.row.full_name ?? "—")}
                          {entry.row.linkedin_url ? (
                            <Linkedin className="ml-1 inline size-3 text-[var(--text-muted)]" />
                          ) : null}
                        </td>
                        <td className="max-w-32 truncate px-2.5 py-1.5 text-[var(--text-muted)]">
                          {String(entry.row.job_title ?? "—")}
                        </td>
                        <td className="max-w-40 truncate px-2.5 py-1.5">
                          {String(entry.row.company_name ?? "—")}
                        </td>
                        {/* Le portable d'abord ; à défaut le standard, signalé comme tel. */}
                        <td className="px-2.5 py-1.5 whitespace-nowrap text-[var(--text-muted)]">
                          {entry.row.phone
                            ? String(entry.row.phone)
                            : entry.row.phone_standard
                              ? `${entry.row.phone_standard} (std)`
                              : "—"}
                        </td>
                        <td className="max-w-40 truncate px-2.5 py-1.5 text-[var(--text-muted)]">
                          {String(entry.row.email ?? "—")}
                        </td>
                        <td className="px-2.5 py-1.5 whitespace-nowrap text-[var(--text-muted)]">
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

/**
 * Ce que le fichier a donné, en-tête par en-tête.
 *
 * Trois catégories, et la distinction compte : une colonne lue rassure, une
 * colonne écartée sciemment ferme le sujet, une colonne inconnue est un travail
 * à faire. Les mélanger — c'était le cas — donnait une liste alarmante de
 * « colonnes ignorées » où figuraient aussi bien le SIRET, réellement perdu,
 * que des identifiants Hubspot dont personne ne veut.
 */
/**
 * Une exclusion, son compte, et de quoi la lever.
 *
 * Affichée même à zéro : « 0 fiche hors cible » dit que la règle a tourné,
 * alors qu'une ligne absente laisse croire qu'elle n'existe pas.
 */
function Exclusion({
  coche,
  onChange,
  compte,
  titre,
  detail,
}: {
  coche: boolean;
  onChange: () => void;
  compte: number;
  titre: string;
  detail: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[var(--text-muted)]">
      <input
        type="checkbox"
        checked={coche}
        onChange={onChange}
        className="size-3.5 accent-[var(--brand-500,theme(colors.sky.500))]"
      />
      <span>
        {coche ? (
          <span className="text-[var(--text-secondary)]">Importer les {titre}</span>
        ) : (
          <>
            <span className="font-medium text-[var(--text-secondary)]">{compte}</span> {titre} écartée
            {compte > 1 ? "s" : ""}
          </>
        )}
        <span className="ml-1 opacity-70">— {detail}</span>
      </span>
    </label>
  );
}

function ColumnReport({ parsed }: { parsed: ParsedLeadsCsv }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-[var(--border-subtle)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-[11.5px] transition-colors hover:bg-[var(--surface-hover)]/60"
      >
        <Check className="size-3.5 text-emerald-500" />
        <span>
          <span className="font-medium">{parsed.mappedColumns.length}</span> colonne(s) lue(s)
          {parsed.profile === "pharow" ? " · format de sourcing reconnu" : ""}
        </span>

        {parsed.regionsDerived > 0 ? (
          <span className="flex items-center gap-1 text-[var(--text-muted)]">
            <MapPin className="size-3" />
            {parsed.regionsDerived} région(s) déduite(s) du code postal
          </span>
        ) : null}

        {parsed.unknownColumns.length > 0 ? (
          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-300">
            <AlertTriangle className="size-3" />
            {parsed.unknownColumns.length} non reconnue(s)
          </span>
        ) : null}

        <ChevronDown
          className={cn("ml-auto size-3.5 text-[var(--text-muted)] transition-transform", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div className="space-y-2.5 border-t border-[var(--border-subtle)] px-3 py-2.5 text-[11px]">
          <div className="flex flex-wrap gap-1">
            {parsed.mappedColumns.map(({ header, field }) => (
              <span
                key={header}
                title={`→ ${field}`}
                className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-300"
              >
                {header}
              </span>
            ))}
          </div>

          {parsed.unknownColumns.length > 0 ? (
            <p className="text-amber-600 dark:text-amber-300">
              <span className="font-medium">Non reconnues :</span> {parsed.unknownColumns.join(", ")}.
              Ces données ne seront pas importées.
            </p>
          ) : null}

          {parsed.ignoredColumns.length > 0 ? (
            <ul className="space-y-0.5 text-[var(--text-muted)]">
              {parsed.ignoredColumns.map(({ header, reason }) => (
                <li key={header}>
                  <span className="text-[var(--text-secondary)]">{header}</span> — écartée : {reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
