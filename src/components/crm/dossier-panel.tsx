"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, FileSignature, Plus, Receipt, Trash2, Wallet } from "lucide-react";

import { Badge, Button, Input, useToast } from "@/components/ui";
import { INVOICE_STATUS } from "@/lib/constants";
import type { DossierLine, Invoice, InvoiceStatus } from "@/lib/database.types";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import { PennylanePanel } from "@/components/crm/pennylane-panel";
import {
  addInvoice,
  deleteLine,
  fetchDossier,
  saveLine,
  setInvoiceStatus,
  updateDossier,
  type DossierDetail,
} from "@/app/(crm)/facturation/actions";

/**
 * Le dossier administratif d'une affaire.
 *
 * Volontairement présenté comme une section de l'affaire plutôt que comme un
 * écran à part : le commercial n'a rien de neuf à apprendre, le dossier existe
 * déjà quand il arrive dessus. L'écran autonome n'est là que pour qui suit la
 * facturation.
 */
export function DossierPanel({ dossierId, isAdmin }: { dossierId: string; isAdmin: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [detail, setDetail] = useState<DossierDetail | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const result = await fetchDossier(dossierId);
    if (result.ok) setDetail(result.detail);
  }

  useEffect(() => {
    let active = true;
    fetchDossier(dossierId).then((result) => {
      if (active && result.ok) setDetail(result.detail);
    });
    return () => {
      active = false;
    };
  }, [dossierId]);

  if (!detail) {
    return <p className="text-[12.5px] text-[var(--text-muted)]">Chargement du dossier…</p>;
  }

  const { dossier, lines, invoices } = detail;

  const facture = invoices
    .filter((invoice) => invoice.status === "emise" || invoice.status === "payee")
    .reduce((sum, invoice) => sum + Number(invoice.amount_ttc), 0);
  const encaisse = invoices.reduce((sum, invoice) => sum + Number(invoice.paid_amount), 0);
  const reste = facture - encaisse;

  async function act(run: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    const result = await run();
    setBusy(false);
    if (!result.ok) {
      toast(result.error ?? "Échec.", "error");
      return;
    }
    await load();
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-4">
      {/* --- Trésorerie du dossier ------------------------------------- */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Facturé", value: facture, tone: "text-[var(--text-primary)]" },
          { label: "Encaissé", value: encaisse, tone: "text-emerald-600 dark:text-emerald-400" },
          {
            label: "Reste dû",
            value: reste,
            tone: reste > 0 ? "text-amber-600 dark:text-amber-400" : "text-[var(--text-muted)]",
          },
        ].map((tile) => (
          <div
            key={tile.label}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-base)]/50 px-3 py-2"
          >
            <p className="text-[10.5px] tracking-wide text-[var(--text-muted)] uppercase">
              {tile.label}
            </p>
            <p className={cn("mt-0.5 text-[15px] font-semibold tabular-nums", tile.tone)}>
              {formatMoney(tile.value)}
            </p>
          </div>
        ))}
      </div>

      {/* --- Lignes du devis -------------------------------------------- */}
      <section>
        <h4 className="flex items-center gap-2 text-[12.5px] font-medium text-[var(--text-secondary)]">
          <FileSignature className="size-3.5 text-brand-500 dark:text-brand-300" />
          Lignes du devis
          <span className="ml-auto text-[11.5px] font-normal text-[var(--text-muted)] tabular-nums">
            {formatMoney(dossier.amount_ht)} HT · {formatMoney(dossier.amount_ttc)} TTC
          </span>
        </h4>

        <ul className="mt-2 space-y-1.5">
          {lines.map((line) => (
            <LineRow
              key={line.id}
              line={line}
              busy={busy}
              onSave={(patch) => act(() => saveLine(dossier.id, { id: line.id, ...patch }))}
              onDelete={() => act(() => deleteLine(dossier.id, line.id))}
            />
          ))}
        </ul>

        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          loading={busy}
          onClick={() =>
            act(() => saveLine(dossier.id, { label: "Nouvelle ligne", quantity: 1, unit_price_ht: 0 }))
          }
        >
          <Plus className="size-3.5" />
          Ajouter une ligne
        </Button>
      </section>

      <PennylanePanel dossier={dossier} invoices={invoices} isAdmin={isAdmin} />

      {/* --- Échéancier -------------------------------------------------- */}
      <section>
        <h4 className="flex items-center gap-2 text-[12.5px] font-medium text-[var(--text-secondary)]">
          <Receipt className="size-3.5 text-brand-500 dark:text-brand-300" />
          Échéancier
          <span className="ml-auto text-[11px] font-normal text-[var(--text-muted)]">
            paiement à {dossier.payment_terms_days} jours
          </span>
        </h4>

        <ul className="mt-2 space-y-1.5">
          {invoices.map((invoice) => (
            <InvoiceRow
              key={invoice.id}
              invoice={invoice}
              busy={busy}
              onStatus={(status) => act(() => setInvoiceStatus(invoice.id, status))}
            />
          ))}
        </ul>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            loading={busy}
            onClick={() => act(() => addInvoice(dossier.id, `Échéance ${invoices.length + 1}`))}
          >
            <Plus className="size-3.5" />
            Ajouter une échéance
          </Button>

          {!dossier.quote_signed_at ? (
            <Button
              size="sm"
              variant="secondary"
              loading={busy}
              onClick={() =>
                act(() =>
                  updateDossier(dossier.id, { quote_signed_at: new Date().toISOString() }),
                )
              }
            >
              <Check className="size-3.5" />
              Marquer le devis signé
            </Button>
          ) : (
            <span className="flex items-center gap-1.5 text-[11.5px] text-emerald-600 dark:text-emerald-400">
              <Check className="size-3.5" />
              Devis signé le {formatDate(dossier.quote_signed_at)}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}

/** Une ligne de devis, éditable sur place. */
function LineRow({
  line,
  busy,
  onSave,
  onDelete,
}: {
  line: DossierLine;
  busy: boolean;
  onSave: (patch: { label: string; quantity: number; unit_price_ht: number }) => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState(line.label);
  const [quantity, setQuantity] = useState(String(line.quantity));
  const [price, setPrice] = useState(String(line.unit_price_ht));

  useEffect(() => {
    setLabel(line.label);
    setQuantity(String(line.quantity));
    setPrice(String(line.unit_price_ht));
  }, [line.label, line.quantity, line.unit_price_ht]);

  const dirty =
    label !== line.label ||
    quantity !== String(line.quantity) ||
    price !== String(line.unit_price_ht);

  function commit() {
    if (!dirty) return;
    onSave({
      label: label.trim() || "Ligne",
      quantity: Number(quantity) || 0,
      unit_price_ht: Number(price) || 0,
    });
  }

  return (
    <li className="flex items-center gap-2 rounded-[10px] border border-[var(--border-subtle)] px-2 py-1.5">
      <Input
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        onBlur={commit}
        className="h-7 flex-1 text-[12.5px]"
        aria-label="Intitulé"
      />
      <Input
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
        onBlur={commit}
        className="h-7 w-14 text-right text-[12.5px]"
        aria-label="Quantité"
      />
      <span className="text-[11px] text-[var(--text-muted)]">×</span>
      <Input
        value={price}
        onChange={(event) => setPrice(event.target.value)}
        onBlur={commit}
        className="h-7 w-24 text-right text-[12.5px]"
        aria-label="Prix unitaire HT"
      />
      <span className="w-24 shrink-0 text-right text-[12.5px] font-medium tabular-nums">
        {formatMoney(Number(quantity) * Number(price))}
      </span>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        aria-label="Supprimer la ligne"
        className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-rose-500"
      >
        <Trash2 className="size-3.5" />
      </button>
    </li>
  );
}

/** Une échéance, et le geste qui la fait avancer. */
function InvoiceRow({
  invoice,
  busy,
  onStatus,
}: {
  invoice: Invoice;
  busy: boolean;
  onStatus: (status: InvoiceStatus) => void;
}) {
  const meta = INVOICE_STATUS[invoice.status];
  const late =
    invoice.status === "emise" &&
    invoice.due_on !== null &&
    invoice.due_on < new Date().toISOString().slice(0, 10);

  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-[10px] border px-3 py-2",
        late ? "border-rose-500/30 bg-rose-500/5" : "border-[var(--border-subtle)]",
      )}
    >
      <div className="min-w-32 flex-1">
        <p className="text-[12.5px] font-medium">{invoice.label}</p>
        <p className="text-[11px] text-[var(--text-muted)]">
          {invoice.due_on ? `échéance ${formatDate(invoice.due_on)}` : "date à la signature"}
          {invoice.invoice_number ? ` · ${invoice.invoice_number}` : ""}
        </p>
      </div>

      <span className="text-[12.5px] font-medium tabular-nums">
        {formatMoney(invoice.amount_ttc)}
      </span>

      <Badge tone={late ? "red" : meta.tone}>{late ? "En retard" : meta.label}</Badge>

      {invoice.status === "prevue" ? (
        <Button size="sm" variant="ghost" loading={busy} onClick={() => onStatus("emise")}>
          Émettre
        </Button>
      ) : null}
      {invoice.status === "emise" ? (
        <Button size="sm" variant="ghost" loading={busy} onClick={() => onStatus("payee")}>
          <Wallet className="size-3.5" />
          Encaissée
        </Button>
      ) : null}
    </li>
  );
}
