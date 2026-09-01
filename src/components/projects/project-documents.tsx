"use client";

import { useState } from "react";
import { Download, Eye, EyeOff, FileText, Trash2, Upload } from "lucide-react";

import { Badge, Button, Card, EmptyState, Select, useToast } from "@/components/ui";
import { DOCUMENT_KIND } from "@/lib/constants";
import type { DocumentKind, DocumentRow, Project } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils";
import {
  deleteDocument,
  registerDocument,
  toggleDocumentVisibility,
} from "@/app/(crm)/projets/actions";

const MAX_BYTES = 50 * 1024 * 1024;

/**
 * Documents du projet (devis, contrat, livrables).
 *
 * Le fichier part directement du navigateur vers Supabase Storage : seule la
 * fiche est enregistrée côté serveur, ce qui évite de faire transiter des
 * dizaines de mégaoctets par la fonction Next.
 */
export function ProjectDocuments({
  project,
  documents,
  onChanged,
}: {
  project: Project;
  documents: DocumentRow[];
  onChanged: () => void;
}) {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [kind, setKind] = useState<DocumentKind>("livrable");

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (file.size > MAX_BYTES) {
      toast("Fichier trop volumineux (50 Mo maximum).", "error");
      return;
    }

    setUploading(true);
    const supabase = createClient();
    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `projects/${project.id}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(path, file, { cacheControl: "3600", upsert: false });

    if (uploadError) {
      setUploading(false);
      toast(uploadError.message, "error");
      return;
    }

    const result = await registerDocument({
      project_id: project.id,
      name: file.name,
      kind,
      storage_path: path,
      mime_type: file.type || null,
      size_bytes: file.size,
      is_client_visible: kind !== "brief",
    });

    setUploading(false);
    if (!result.ok) {
      // La fiche a échoué : on ne laisse pas d'orphelin dans le bucket.
      await supabase.storage.from("documents").remove([path]);
      toast(result.error, "error");
      return;
    }

    toast("Document ajouté.");
    onChanged();
  }

  async function download(document: DocumentRow) {
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(document.storage_path, 60);

    if (error || !data) {
      toast(error?.message ?? "Lien indisponible", "error");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-center gap-2.5 p-3.5">
        <Select
          value={kind}
          onChange={(event) => setKind(event.target.value as DocumentKind)}
          className="w-auto min-w-40"
          aria-label="Type de document"
        >
          {(Object.keys(DOCUMENT_KIND) as DocumentKind[]).map((value) => (
            <option key={value} value={value}>
              {DOCUMENT_KIND[value].label}
            </option>
          ))}
        </Select>

        <label className="inline-flex cursor-pointer">
          <span
            className={
              "inline-flex h-9.5 items-center gap-2 rounded-[10px] bg-linear-to-r from-brand-600 to-brand-500 px-4 text-sm font-medium text-white " +
              "transition-all duration-200 hover:from-brand-500 hover:to-accent-500 hover:shadow-[0_0_24px_-6px_var(--glow-brand)]"
            }
          >
            <Upload className="size-4" />
            {uploading ? "Envoi en cours…" : "Téléverser"}
          </span>
          <input type="file" className="hidden" onChange={upload} disabled={uploading} />
        </label>

        <p className="text-[11.5px] text-[var(--text-muted)]">50 Mo maximum par fichier.</p>
      </Card>

      {documents.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileText className="size-5" />}
            title="Aucun document"
            description="Déposez ici le devis, le contrat signé et les livrables du projet."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-[var(--border-subtle)]">
            {documents.map((document, index) => (
              <li
                key={document.id}
                style={{ ["--i" as string]: index }}
                className="stagger flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--surface-hover)]/50"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-linear-to-br from-brand-500/15 to-accent-500/10 text-brand-400 ring-1 ring-[var(--border-subtle)]">
                  <FileText className="size-4" />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{document.name}</span>
                  <span className="block text-[11.5px] text-[var(--text-muted)]">
                    {formatDate(document.created_at)} · {formatSize(document.size_bytes)}
                  </span>
                </span>

                <Badge tone={DOCUMENT_KIND[document.kind].tone}>{DOCUMENT_KIND[document.kind].label}</Badge>

                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={
                    document.is_client_visible ? "Masquer au client" : "Rendre visible au client"
                  }
                  title={document.is_client_visible ? "Visible par le client" : "Interne"}
                  onClick={async () => {
                    const result = await toggleDocumentVisibility(
                      document.id,
                      project.id,
                      !document.is_client_visible,
                    );
                    if (!result.ok) {
                      toast(result.error, "error");
                      return;
                    }
                    onChanged();
                  }}
                >
                  {document.is_client_visible ? (
                    <Eye className="size-4 text-brand-400" />
                  ) : (
                    <EyeOff className="size-4" />
                  )}
                </Button>

                <Button variant="ghost" size="icon" aria-label="Télécharger" onClick={() => download(document)}>
                  <Download className="size-4" />
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Supprimer"
                  className="text-[var(--text-muted)] hover:text-rose-400"
                  onClick={async () => {
                    if (!window.confirm(`Supprimer « ${document.name} » ?`)) return;
                    const result = await deleteDocument(document.id, project.id, document.storage_path);
                    if (!result.ok) {
                      toast(result.error, "error");
                      return;
                    }
                    toast("Document supprimé.");
                    onChanged();
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function formatSize(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}
