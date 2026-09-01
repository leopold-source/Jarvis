"use client";

import { useState } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";

import { Button, Modal, useToast } from "@/components/ui";
import { importLeads } from "@/app/(crm)/leads/actions";
import { parseLeadsCsv, type ParsedLeadsCsv } from "@/lib/leads-csv";

/**
 * Import d'un export CSV de leads. Le fichier est analysé dans le navigateur
 * (aucun envoi tant que l'aperçu n'est pas validé), puis inséré par lots.
 */
export function ImportLeadsDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (count: number) => void;
}) {
  const toast = useToast();
  const [parsed, setParsed] = useState<ParsedLeadsCsv | null>(null);
  const [fileName, setFileName] = useState("");
  const [importingNow, setImportingNow] = useState(false);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      setParsed(parseLeadsCsv(await file.text()));
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : "Fichier illisible", "error");
      setParsed(null);
    }
  }

  async function submit() {
    if (!parsed) return;
    setImportingNow(true);
    const result = await importLeads(parsed.rows);
    setImportingNow(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    setParsed(null);
    setFileName("");
    onImported(result.data!.inserted);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Importer des leads"
      description="Fichier CSV exporté depuis votre table de prospection."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" disabled={!parsed} loading={importingNow} onClick={submit}>
            Importer {parsed ? `${parsed.rows.length} lead(s)` : ""}
          </Button>
        </>
      }
    >
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--border-strong)] px-6 py-8 text-center transition-colors hover:border-brand-500/60 hover:bg-[var(--surface-hover)]/50">
        <span className="grid size-10 place-items-center rounded-full bg-linear-to-br from-brand-500/20 to-accent-500/10 text-brand-300">
          <Upload className="size-4.5" />
        </span>
        <span className="text-[13.5px] font-medium">
          {fileName || "Choisir un fichier CSV"}
        </span>
        <span className="text-[11.5px] text-[var(--text-muted)]">
          Colonnes reconnues : Name, Prénom, Nom, E-mail, Tél, Entreprise, Statut, Région, Relance,
          Valeur CA, Site entreprise, Url LinkedIn, Commentaire, Activité, Secteur, Adresse.
        </span>
        <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
      </label>

      {parsed ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2 text-[13px]">
            <FileSpreadsheet className="size-4 text-brand-400" />
            <span>
              <span className="font-medium">{parsed.rows.length}</span> ligne(s) prêtes
              {parsed.skipped > 0 ? ` · ${parsed.skipped} ignorée(s) (ni nom ni e-mail)` : ""}
            </span>
          </div>

          {parsed.unknownColumns.length > 0 ? (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11.5px] text-amber-400 ring-1 ring-amber-500/25">
              Colonnes ignorées : {parsed.unknownColumns.join(", ")}
            </p>
          ) : null}

          <div className="max-h-48 overflow-auto rounded-lg border border-[var(--border-subtle)]">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-[var(--surface-hover)]/60 text-[10.5px] tracking-wide text-[var(--text-muted)] uppercase">
                <tr>
                  <th className="px-2.5 py-1.5">Nom</th>
                  <th className="px-2.5 py-1.5">Entreprise</th>
                  <th className="px-2.5 py-1.5">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {parsed.rows.slice(0, 8).map((row, index) => (
                  <tr key={index}>
                    <td className="px-2.5 py-1.5">{String(row.full_name ?? "—")}</td>
                    <td className="px-2.5 py-1.5">{String(row.company_name ?? "—")}</td>
                    <td className="px-2.5 py-1.5">{String(row.status ?? "nouveau")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
