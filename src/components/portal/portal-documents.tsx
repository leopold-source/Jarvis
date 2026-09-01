"use client";

import { Download, FileText } from "lucide-react";

import { Badge, Button, Card, EmptyState, useToast } from "@/components/ui";
import { DOCUMENT_KIND } from "@/lib/constants";
import type { DocumentRow } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils";

export function PortalDocuments({ documents }: { documents: DocumentRow[] }) {
  const toast = useToast();

  async function download(document: DocumentRow) {
    // Le bucket est privé : on demande une URL signée à courte durée de vie.
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(document.storage_path, 60);

    if (error || !data) {
      toast("Ce document n'est pas disponible au téléchargement.", "error");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  if (documents.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<FileText className="size-5" />}
          title="Aucun document partagé"
          description="Devis, contrat et livrables apparaîtront ici au fil du projet."
        />
      </Card>
    );
  }

  return (
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
                Ajouté le {formatDate(document.created_at, "long")}
              </span>
            </span>
            <Badge tone={DOCUMENT_KIND[document.kind].tone}>{DOCUMENT_KIND[document.kind].label}</Badge>
            <Button variant="ghost" size="icon" aria-label="Télécharger" onClick={() => download(document)}>
              <Download className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
