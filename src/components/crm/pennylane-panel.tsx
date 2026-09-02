"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileSignature, Send, ShieldCheck } from "lucide-react";

import { Badge, Button, useToast } from "@/components/ui";
import type { Dossier, Invoice } from "@/lib/database.types";
import {
  checkDossierReady,
  pushInvoiceDraft,
  pushQuoteDraft,
  submitQuoteForReview,
} from "@/app/(crm)/facturation/pennylane-actions";

const REVIEW_LABEL: Record<string, { label: string; tone: "stone" | "amber" | "sky" | "emerald" }> = {
  a_preparer: { label: "À préparer", tone: "stone" },
  a_valider: { label: "À valider", tone: "amber" },
  brouillon_pousse: { label: "Brouillon chez Pennylane", tone: "sky" },
  envoye: { label: "Envoyé", tone: "emerald" },
};

/**
 * Le circuit de validation, vu depuis le dossier.
 *
 * Chaque bouton dit ce qu'il fait vraiment, et la phrase sous les actions
 * rappelle ce qui ne se produit pas : rien ne part au client. C'est le point
 * qu'il faut lever de tout doute quand un outil manipule de la facturation.
 */
export function PennylanePanel({
  dossier,
  invoices,
  isAdmin,
}: {
  dossier: Dossier;
  invoices: Invoice[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<string[] | null>(null);

  const review = REVIEW_LABEL[dossier.quote_review] ?? REVIEW_LABEL.a_preparer;

  async function run(action: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      toast(result.error ?? "Échec.", "error");
      return;
    }
    if (result.message) toast(result.message);
    startTransition(() => router.refresh());
  }

  async function verify() {
    setBusy(true);
    const result = await checkDossierReady(dossier.id);
    setBusy(false);
    setMissing(result.missing);
    if (result.missing.length === 0) toast("Le dossier est complet.");
  }

  const pending = invoices.filter((invoice) => invoice.review === "a_valider");

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-base)]/50 p-3.5">
      <h4 className="flex flex-wrap items-center gap-2 text-[12.5px] font-medium text-[var(--text-secondary)]">
        <FileSignature className="size-3.5 text-brand-500 dark:text-brand-300" />
        Pennylane
        <Badge tone={review.tone}>{review.label}</Badge>
      </h4>

      {missing && missing.length > 0 ? (
        <ul className="mt-2 space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[12px] text-amber-700 dark:text-amber-300">
          {missing.map((item) => (
            <li key={item} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      ) : null}

      {missing && missing.length === 0 ? (
        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="size-3.5" />
          Dossier complet : SIRET, adresse et e-mail de facturation présents.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" loading={busy} onClick={verify}>
          <ShieldCheck className="size-3.5" />
          Vérifier le dossier
        </Button>

        {dossier.quote_review === "a_preparer" ? (
          <Button
            size="sm"
            variant="secondary"
            loading={busy}
            onClick={() => run(() => submitQuoteForReview(dossier.id))}
          >
            Soumettre à validation
          </Button>
        ) : null}

        {isAdmin && dossier.quote_review === "a_valider" ? (
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            onClick={() => run(() => pushQuoteDraft(dossier.id))}
          >
            <Send className="size-3.5" />
            Créer le devis en brouillon
          </Button>
        ) : null}

        {isAdmin && pending.length > 0
          ? pending.map((invoice) => (
              <Button
                key={invoice.id}
                size="sm"
                variant="primary"
                loading={busy}
                onClick={() => run(() => pushInvoiceDraft(invoice.id))}
              >
                <Send className="size-3.5" />
                Facturer « {invoice.label} » en brouillon
              </Button>
            ))
          : null}
      </div>

      <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
        Rien n&apos;est envoyé au client depuis le CRM. Devis comme factures sont créés en
        brouillon chez Pennylane ; c&apos;est de là, après votre relecture, qu&apos;ils partent.
      </p>
    </section>
  );
}
