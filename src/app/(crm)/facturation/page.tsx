import Link from "next/link";
import { AlertTriangle, Banknote, Clock, Wallet } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge, Card, EmptyState } from "@/components/ui";
import { DOSSIER_STATUS } from "@/lib/constants";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn, formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Facturation" };

/**
 * Le suivi administratif.
 *
 * Trois chiffres seulement, et aucune marge : tant qu'on ne sait pas d'où
 * viendraient les coûts de production, l'afficher reviendrait à afficher un
 * nombre faux — ce qui est pire que de ne rien montrer.
 */
export default async function FacturationPage() {
  await requireStaff();
  const supabase = await createClient();

  const [{ data: dossiers }, { data: finance }, { data: companies }] = await Promise.all([
    supabase.from("dossiers").select("*").order("created_at", { ascending: false }),
    supabase.from("dossier_finance").select("*"),
    supabase.from("companies").select("id, name"),
  ]);

  const financeById = new Map((finance ?? []).map((row) => [row.dossier_id, row]));
  const companyById = new Map((companies ?? []).map((row) => [row.id, row.name]));

  const total = (field: "facture_ttc" | "encaisse_ttc" | "en_retard_ttc" | "a_facturer_ttc") =>
    (finance ?? []).reduce((sum, row) => sum + Number(row[field] ?? 0), 0);

  const facture = total("facture_ttc");
  const encaisse = total("encaisse_ttc");
  const enRetard = total("en_retard_ttc");
  const aFacturer = total("a_facturer_ttc");

  const tiles = [
    { label: "Facturé", value: facture, icon: Banknote, tone: "" },
    {
      label: "Encaissé",
      value: encaisse,
      icon: Wallet,
      tone: "text-emerald-600 dark:text-emerald-400",
      hint: facture > 0 ? `${Math.round((encaisse / facture) * 100)} % du facturé` : undefined,
    },
    {
      label: "En retard",
      value: enRetard,
      icon: AlertTriangle,
      tone: enRetard > 0 ? "text-rose-600 dark:text-rose-400" : "text-[var(--text-muted)]",
    },
    { label: "Reste à facturer", value: aFacturer, icon: Clock, tone: "text-[var(--text-secondary)]" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Facturation"
        description="Le réel administratif : ce qui est facturé, ce qui est encaissé, ce qui traîne."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map(({ label, value, icon: Icon, tone, hint }, index) => (
          <Card key={label} glow style={{ ["--i" as string]: index }} className="stagger p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11.5px] text-[var(--text-muted)]">{label}</p>
                <p className={cn("mt-1 text-[19px] font-semibold tabular-nums", tone)}>
                  {formatMoney(value)}
                </p>
                {hint ? <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{hint}</p> : null}
              </div>
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-500/12 text-brand-500 dark:text-brand-300">
                <Icon className="size-4" />
              </span>
            </div>
          </Card>
        ))}
      </section>

      {(dossiers ?? []).length === 0 ? (
        <EmptyState
          icon={<Banknote className="size-5" />}
          title="Aucun dossier"
          description="Un dossier se crée automatiquement dès qu'une affaire passe en gagnée."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-[12.5px]">
              <thead className="text-[10.5px] tracking-wide text-[var(--text-muted)] uppercase">
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="px-3 py-2 font-medium">Dossier</th>
                  <th className="px-3 py-2 font-medium">Client</th>
                  <th className="px-3 py-2 font-medium">Statut</th>
                  <th className="px-3 py-2 text-right font-medium">Montant TTC</th>
                  <th className="px-3 py-2 text-right font-medium">Encaissé</th>
                  <th className="px-3 py-2 font-medium">Prochaine échéance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {(dossiers ?? []).map((dossier, index) => {
                  const money = financeById.get(dossier.id);
                  const late = Number(money?.en_retard_ttc ?? 0) > 0;
                  const meta = DOSSIER_STATUS[dossier.status];

                  return (
                    <tr
                      key={dossier.id}
                      style={{ ["--i" as string]: index }}
                      className={cn(
                        "stagger transition-colors hover:bg-[var(--surface-hover)]/60",
                        late && "bg-rose-500/[0.06]",
                      )}
                    >
                      <td className="px-3 py-2 font-mono text-[11.5px]">{dossier.code ?? "—"}</td>
                      <td className="max-w-52 truncate px-3 py-2">
                        {dossier.company_id
                          ? (companyById.get(dossier.company_id) ?? "—")
                          : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatMoney(dossier.amount_ttc)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatMoney(Number(money?.encaisse_ttc ?? 0))}
                      </td>
                      <td className="px-3 py-2">
                        {money?.prochaine_echeance ? (
                          <span className={cn(late && "text-rose-500")}>
                            {formatDate(money.prochaine_echeance)}
                          </span>
                        ) : (
                          <span className="text-[var(--text-muted)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <p className="text-[11.5px] text-[var(--text-muted)]">
        La marge n&apos;est pas affichée : aucun coût de production n&apos;est suivi aujourd&apos;hui,
        et un chiffre calculé sur du vide serait pris pour un fait.{" "}
        <Link href="/affaires" className="text-brand-500 hover:underline dark:text-brand-300">
          Voir les affaires
        </Link>
      </p>
    </div>
  );
}
