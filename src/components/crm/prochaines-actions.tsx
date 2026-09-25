"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CornerDownRight,
  FileSignature,
  ListTodo,
  Mail,
  PhoneCall,
  Target,
} from "lucide-react";

import { Card, SectionTitle, useToast } from "@/components/ui";
import type { Radar } from "@/lib/prochaines-actions";
import { cn, initials } from "@/lib/utils";
import { etapeFaite, reporterEtape } from "@/app/(crm)/actions-du-jour";

type Membre = { id: string; nom: string };

/**
 * Les prochaines actions des affaires, là où on ne peut pas les rater.
 *
 * Trois temps : ce qui est en retard, ce qui tombe aujourd'hui, et le prochain
 * jour travaillé pour l'anticiper. Une ligne se coche ou se repousse sans
 * ouvrir l'affaire. Devis à relancer et récaps prêts suivent : ce sont eux
 * aussi des gestes qu'une affaire chaude attend.
 */
export function ProchainesActions({
  radar,
  membres,
  moi,
  className,
}: {
  radar: Radar;
  membres: Membre[];
  moi: string;
  className?: string;
}) {
  const [qui, setQui] = useState<"moi" | "tous">(() =>
    radar.affaires.some((a) => a.ownerId === moi) ? "moi" : "tous",
  );
  const [faits, setFaits] = useState<Set<string>>(new Set());
  const garder = <T extends { ownerId: string | null }>(x: T) => qui === "tous" || x.ownerId === moi || x.ownerId === null;

  const affaires = radar.affaires.filter((a) => garder(a) && !faits.has(a.dealId));
  const retard = affaires.filter((a) => a.echeance === "retard");
  const jour = affaires.filter((a) => a.echeance === "jour");
  const prochain = affaires.filter((a) => a.echeance === "prochain");
  const devis = radar.devis.filter(garder);
  const recaps = radar.recaps.filter(garder);
  const sansSuite = radar.sansSuite.filter(garder);
  const relances = radar.relances.filter(garder);
  const taches = radar.taches.filter((t) => qui === "tous" || t.assignees.length === 0 || t.assignees.includes(moi));

  const nomDe = (id: string | null) => membres.find((m) => m.id === id)?.nom ?? null;
  const total = retard.length + jour.length + devis.length + recaps.length;

  return (
    <Card className={cn("flex flex-col p-5", className)}>
      <div className="flex items-start gap-3">
        <SectionTitle
          title="Prochaines actions"
          description={
            total === 0
              ? `Rien de dû aujourd'hui${prochain.length ? ` · ${prochain.length} pour ${radar.nomProchain.toLowerCase()}` : ""}`
              : `${total} à traiter aujourd'hui${prochain.length ? ` · ${prochain.length} pour ${radar.nomProchain.toLowerCase()}` : ""}`
          }
        />
        <div className="ml-auto flex shrink-0 rounded-lg bg-[var(--surface-hover)] p-0.5 text-[11.5px]">
          {(["moi", "tous"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setQui(v)}
              className={cn(
                "rounded-md px-2 py-0.5 font-medium transition-colors",
                qui === v ? "bg-[var(--surface-overlay)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-muted)]",
              )}
            >
              {v === "moi" ? "Moi" : "Équipe"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 space-y-3">
        <Groupe titre="En retard" ton="retard" items={retard} nomDe={nomDe} radar={radar} onFait={(id) => setFaits((f) => new Set(f).add(id))} />
        <Groupe titre="Aujourd'hui" ton="jour" items={jour} nomDe={nomDe} radar={radar} onFait={(id) => setFaits((f) => new Set(f).add(id))} />
        <Groupe titre={radar.nomProchain} ton="prochain" items={prochain} nomDe={nomDe} radar={radar} onFait={(id) => setFaits((f) => new Set(f).add(id))} />

        {taches.length ? (
          <div className="border-t border-[var(--border-subtle)] pt-3">
            <p className="mb-1 flex items-center justify-between text-[10.5px] font-medium tracking-wide text-[var(--text-muted)] uppercase">
              Tâches · {taches.length}
              <Link href="/taches" className="normal-case tracking-normal hover:text-[var(--text-primary)]">
                Tout voir →
              </Link>
            </p>
            <ul className="space-y-0.5 text-[12.5px]">
              {taches.slice(0, 6).map((t) => (
                <li key={t.id}>
                  <Link href="/taches" className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-[var(--surface-hover)]/60">
                    <ListTodo
                      className={cn(
                        "size-3.5 shrink-0",
                        t.probleme || t.echeance === "retard" ? "text-rose-500" : t.prio ? "text-amber-500" : "text-[var(--text-muted)]",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{t.titre}</span>
                    <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
                      {t.probleme
                        ? "problème"
                        : t.echeance === "retard"
                          ? "en retard"
                          : t.echeance === "jour"
                            ? "aujourd'hui"
                            : t.echeance === "prochain"
                              ? radar.nomProchain.toLowerCase()
                              : "prioritaire"}
                    </span>
                    {t.assignees.map((id) => (
                      <span key={id} title={nomDe(id) ?? ""} className="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--surface-hover)] text-[9px] font-medium">
                        {initials(nomDe(id) ?? "?")}
                      </span>
                    ))}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {devis.length || recaps.length || sansSuite.length ? (
          <ul className="space-y-1 border-t border-[var(--border-subtle)] pt-3 text-[12.5px]">
            {recaps.map((r) => (
              <Ligne key={`r${r.dealId}`} href={`/affaires?affaire=${r.dealId}`} icone={Mail} ton="brand">
                Récap R2 prêt à envoyer — <strong className="font-medium">{r.nom}</strong>
              </Ligne>
            ))}
            {devis.map((d) => (
              <Ligne key={`d${d.dealId}${d.numero}`} href={`/affaires?affaire=${d.dealId}`} icone={FileSignature} ton="amber">
                {d.expire ? "Devis expiré" : "Devis à relancer"} {d.numero ? `(${d.numero})` : ""} —{" "}
                <strong className="font-medium">{d.nom}</strong>
              </Ligne>
            ))}
            {sansSuite.slice(0, 5).map((s) => (
              <Ligne key={`s${s.dealId}`} href={`/affaires?affaire=${s.dealId}`} icone={Target} ton="muted">
                {s.etape} sans prochaine étape — <strong className="font-medium">{s.nom}</strong>
              </Ligne>
            ))}
          </ul>
        ) : null}

        {relances.length ? (
          <Link
            href="/leads?vue=prospection"
            className="flex items-center gap-2 rounded-[10px] bg-[var(--surface-hover)]/60 px-3 py-2 text-[12.5px] transition-colors hover:bg-[var(--surface-hover)]"
          >
            <PhoneCall className="size-3.5 text-brand-500 dark:text-brand-300" />
            <span className="flex-1">
              <strong className="font-medium">{relances.length}</strong> relance{relances.length > 1 ? "s" : ""} de leads
              aujourd&apos;hui
              {relances.some((r) => r.retard > 0) ? (
                <span className="text-rose-500"> · {relances.filter((r) => r.retard > 0).length} en retard</span>
              ) : null}
            </span>
            <ArrowRight className="size-3.5 text-[var(--text-muted)]" />
          </Link>
        ) : null}
      </div>
    </Card>
  );
}

const TONS = {
  retard: "text-rose-600 dark:text-rose-400",
  jour: "text-brand-600 dark:text-brand-300",
  prochain: "text-[var(--text-muted)]",
} as const;

function Groupe({
  titre,
  ton,
  items,
  nomDe,
  radar,
  onFait,
}: {
  titre: string;
  ton: keyof typeof TONS;
  items: Radar["affaires"];
  nomDe: (id: string | null) => string | null;
  radar: Radar;
  onFait: (dealId: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div>
      <p className={cn("mb-1 flex items-center gap-1.5 text-[10.5px] font-medium tracking-wide uppercase", TONS[ton])}>
        {ton === "retard" ? <AlertTriangle className="size-3" /> : null}
        {titre} · {items.length}
      </p>
      <ul className="space-y-1">
        {items.map((a) => (
          <ActionLigne key={a.dealId} a={a} nom={nomDe(a.ownerId)} radar={radar} onFait={onFait} />
        ))}
      </ul>
    </div>
  );
}

function ActionLigne({
  a,
  nom,
  radar,
  onFait,
}: {
  a: Radar["affaires"][number];
  nom: string | null;
  radar: Radar;
  onFait: (dealId: string) => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const [enCours, demarrer] = useTransition();

  function faire(action: () => Promise<{ ok: boolean; error?: string }>, message: string) {
    demarrer(async () => {
      const r = await action();
      if (!r.ok) return toast(r.error ?? "Échec.", "error");
      onFait(a.dealId);
      toast(message);
      router.refresh();
    });
  }

  return (
    <li
      className={cn(
        "group flex items-center gap-2 rounded-[10px] px-2 py-1.5 transition-colors hover:bg-[var(--surface-hover)]/60",
        enCours && "opacity-50",
      )}
    >
      <Link href={`/affaires?affaire=${a.dealId}`} className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{a.action || "Prochaine étape à préciser"}</p>
        <p className="flex items-center gap-1 truncate text-[11.5px] text-[var(--text-muted)]">
          <CornerDownRight className="size-3 shrink-0" />
          {a.nom} · {a.etape}
          {a.retard > 0 ? <span className="text-rose-500"> · {a.retard} j de retard</span> : null}
        </p>
      </Link>
      {nom ? (
        <span
          title={nom}
          className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--surface-hover)] text-[10px] font-medium text-[var(--text-secondary)]"
        >
          {initials(nom)}
        </span>
      ) : null}
      <span className="flex shrink-0 gap-0.5 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-within:opacity-100">
        {a.echeance !== "prochain" ? (
          <button
            type="button"
            disabled={enCours}
            onClick={() => faire(() => reporterEtape(a.dealId, radar.prochain), `Reporté à ${radar.nomProchain.toLowerCase()}.`)}
            title={`Reporter à ${radar.nomProchain.toLowerCase()}`}
            className="rounded-md px-1.5 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          >
            +1 j
          </button>
        ) : null}
        <button
          type="button"
          disabled={enCours}
          onClick={() => faire(() => etapeFaite(a.dealId), "Fait. Pensez à fixer l'étape suivante dans l'affaire.")}
          title="Fait"
          aria-label="Marquer comme fait"
          className="rounded-md p-1 text-[var(--text-muted)] hover:bg-emerald-500/15 hover:text-emerald-600"
        >
          <Check className="size-3.5" />
        </button>
      </span>
    </li>
  );
}

function Ligne({
  href,
  icone: Icone,
  ton,
  children,
}: {
  href: string;
  icone: typeof Mail;
  ton: "brand" | "amber" | "muted";
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-[var(--surface-hover)]/60">
        <Icone
          className={cn(
            "size-3.5 shrink-0",
            ton === "brand" && "text-brand-500 dark:text-brand-300",
            ton === "amber" && "text-amber-500",
            ton === "muted" && "text-[var(--text-muted)]",
          )}
        />
        <span className="min-w-0 flex-1 truncate">{children}</span>
      </Link>
    </li>
  );
}
