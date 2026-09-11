import { CheckCircle2, Clock, Download, FileText } from "lucide-react";

import { Badge, Card, EmptyState } from "@/components/ui";
import type { Invoice } from "@/lib/database.types";
import { cn, formatDate, formatMoney } from "@/lib/utils";

/**
 * Ce qui a été facturé, et ce qui reste à régler.
 *
 * Le client ne voit que des factures réellement émises — pas l'échéancier
 * prévisionnel, qui est un outil de pilotage interne et donnerait l'impression
 * de réclamer de l'argent avant l'heure. Les lignes du devis restent internes
 * elles aussi : le détail de ce qu'on a chiffré n'est pas la même chose que ce
 * qu'on a facturé.
 */
export function PortalInvoices({ invoices }: { invoices: Invoice[] }) {
  if (invoices.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="size-5" />}
        title="Aucune facture pour l'instant"
        description="Les factures apparaîtront ici dès leur émission."
      />
    );
  }

  const total = invoices.reduce((somme, f) => somme + Number(f.amount_ttc), 0);
  const regle = invoices.reduce((somme, f) => somme + Number(f.paid_amount), 0);
  const reste = total - regle;
  const aujourdhui = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Facturé", valeur: total, ton: "text-[var(--text-primary)]" },
          { label: "Réglé", valeur: regle, ton: "text-emerald-600 dark:text-emerald-400" },
          {
            label: "Reste à régler",
            valeur: reste,
            ton: reste > 0 ? "text-amber-600 dark:text-amber-400" : "text-[var(--text-muted)]",
          },
        ].map((tuile) => (
          <Card key={tuile.label} className="p-4">
            <p className="text-[10.5px] tracking-wide text-[var(--text-muted)] uppercase">
              {tuile.label}
            </p>
            <p className={cn("mt-1 text-[19px] font-semibold tabular-nums", tuile.ton)}>
              {formatMoney(tuile.valeur)}
            </p>
          </Card>
        ))}
      </div>

      <ul className="space-y-2">
        {invoices.map((facture) => {
          const payee = facture.status === "payee";
          const retard = !payee && facture.due_on !== null && facture.due_on < aujourdhui;

          return (
            <li
              key={facture.id}
              className={cn(
                "flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3",
                retard ? "border-amber-500/30 bg-amber-500/5" : "border-[var(--border-subtle)]",
              )}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--surface-hover)] text-[var(--text-muted)]">
                {payee ? (
                  <CheckCircle2 className="size-4 text-emerald-500" />
                ) : (
                  <Clock className="size-4" />
                )}
              </span>

              <span className="min-w-40 flex-1">
                <span className="block text-[13.5px] font-medium">{facture.label}</span>
                <span className="block text-[11.5px] text-[var(--text-muted)]">
                  {facture.invoice_number ? `${facture.invoice_number} · ` : ""}
                  {payee
                    ? `réglée le ${formatDate(facture.paid_on)}`
                    : facture.due_on
                      ? `à régler avant le ${formatDate(facture.due_on)}`
                      : "échéance à définir"}
                </span>
              </span>

              <span className="text-[14px] font-semibold tabular-nums">
                {formatMoney(facture.amount_ttc)}
              </span>

              <Badge tone={payee ? "emerald" : retard ? "amber" : "sky"}>
                {payee ? "Réglée" : retard ? "En attente" : "Émise"}
              </Badge>

              {facture.invoice_url ? (
                <a
                  href={facture.invoice_url}
                  target="_blank"
                  rel="noreferrer"
                  title="Télécharger la facture"
                  className="rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-brand-500"
                >
                  <Download className="size-4" />
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
