"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Lock,
  LockOpen,
  PhoneCall,
  RefreshCw,
  Rocket,
  Sparkles,
} from "lucide-react";

import { Button, Card, Input, useToast } from "@/components/ui";
import { DateField } from "@/components/ui/date-field";
import { nomProchainOuvre } from "@/lib/echeances";
import {
  RELANCES_PAR_JOUR,
  planDe,
  verrouProspection,
  type Groupe as GroupeAffaires,
  type ItemAffaire,
  type ItemLead,
} from "@/lib/plan-logique";
import type { PlanComplet } from "@/lib/plan-du-jour";
import { cn, formatMoney, initials } from "@/lib/utils";
import { faireAvancer } from "@/app/(crm)/actions-du-jour";
import { cocherItem, generateSuggestions } from "@/app/(crm)/suggestions-actions";

type Membre = { id: string; nom: string };

const GROUPES: Array<{ groupe: GroupeAffaires; titre: string; ton: string }> = [
  { groupe: "no_show", titre: "No-show à replanifier", ton: "text-rose-600 dark:text-rose-400" },
  { groupe: "traiter", titre: "À traiter", ton: "text-brand-600 dark:text-brand-300" },
  { groupe: "reveiller", titre: "À réveiller", ton: "text-amber-600 dark:text-amber-400" },
];

/**
 * Le plan du jour commercial : la seule liste à suivre.
 *
 * Trois paliers qu'on descend dans l'ordre. Les affaires d'abord — classées
 * par importance, une ligne chacune —, puis les leads à relancer, et
 * seulement ensuite la prospection libre, qui reste fermée tant que les deux
 * premiers ne sont pas vides. Cocher une affaire demande sa suite : c'est ce
 * qui la fait avancer au lieu de la laisser revenir demain.
 */
export function PlanDuJour({ plan, moi, membres }: { plan: PlanComplet; moi: string; membres: Membre[] }) {
  const toast = useToast();
  const router = useRouter();
  // L'équipe par défaut : à deux, chacun doit voir toutes les affaires ouvertes.
  const [vue, setVue] = useState<"moi" | "equipe">("equipe");
  const [retires, setRetires] = useState<Set<string>>(new Set());
  const [conseils, demarrerConseils] = useTransition();

  const monPlan = planDe(plan, moi);
  const visible = vue === "moi" ? monPlan : plan;
  const affaires = visible.affaires.filter((a) => !retires.has(a.cle));
  const relances = visible.relances.filter((l) => !retires.has(l.cle));
  const verrou = verrouProspection({
    ...monPlan,
    affaires: monPlan.affaires.filter((a) => !retires.has(a.cle)),
    relances: monPlan.relances.filter((l) => !retires.has(l.cle)),
  });
  const enAttente =
    vue === "moi"
      ? (plan.relancesEnAttente[moi] ?? 0)
      : Object.values(plan.relancesEnAttente).reduce((a, b) => a + b, 0);
  const nomDe = (id: string | null) => membres.find((m) => m.id === id)?.nom ?? null;
  const retirer = (cle: string) => setRetires((r) => new Set(r).add(cle));

  function actualiserConseils() {
    demarrerConseils(async () => {
      const r = await generateSuggestions();
      if (!r.ok) return toast(r.error, "error");
      router.refresh();
    });
  }

  return (
    <Card className="flex flex-col p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold tracking-tight">Plan du jour</h2>
          <p className="text-[12.5px] text-[var(--text-muted)]">
            {affaires.length + relances.length === 0
              ? "Tout est fait. La prospection est à toi."
              : `${affaires.length} affaire${affaires.length > 1 ? "s" : ""} · ${relances.length} relance${relances.length > 1 ? "s" : ""}`}
            {plan.faits + retires.size ? ` · ${plan.faits + retires.size} fait${plan.faits + retires.size > 1 ? "s" : ""} aujourd'hui` : ""}
          </p>
        </div>
        <div className="flex shrink-0 rounded-lg bg-[var(--surface-hover)] p-0.5 text-[11.5px]">
          {(["moi", "equipe"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVue(v)}
              className={cn(
                "rounded-md px-2 py-0.5 font-medium transition-colors",
                vue === v ? "bg-[var(--surface-overlay)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-muted)]",
              )}
            >
              {v === "moi" ? "Moi" : "Équipe"}
            </button>
          ))}
        </div>
      </div>

      {/* Le cap du jour, écrit par l'IA à partir de l'objectif */}
      <div className="mt-3 flex items-start gap-2 rounded-[10px] bg-brand-500/8 px-3 py-2 text-[12.5px]">
        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-brand-500 dark:text-brand-300" />
        <p className="min-w-0 flex-1">{plan.cap ?? "Pas encore de cap pour aujourd'hui."}</p>
        <button
          type="button"
          onClick={actualiserConseils}
          disabled={conseils}
          title="Régénérer le cap et les gestes conseillés"
          className="shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <RefreshCw className={cn("size-3.5", conseils && "animate-spin")} />
        </button>
      </div>

      {/* 1 · Affaires */}
      <Palier numero={1} titre="Affaires" compte={affaires.length}>
        {affaires.length === 0 ? (
          <p className="text-[12.5px] text-[var(--text-muted)]">Aucune affaire n&apos;attend de geste aujourd&apos;hui.</p>
        ) : (
          GROUPES.map(({ groupe, titre, ton }) => {
            const items = affaires.filter((a) => a.groupe === groupe);
            if (!items.length) return null;
            return (
              <Groupe key={groupe} titre={titre} ton={ton} items={items} replierApres={100}>
                {(a) => (
                  <LigneAffaire
                    key={a.cle}
                    a={a}
                    geste={plan.gestes[a.cle]}
                    responsable={vue === "equipe" ? nomDe(a.ownerId) : null}
                    onFait={() => retirer(a.cle)}
                  />
                )}
              </Groupe>
            );
          })
        )}
        {plan.aVenir ? (
          <p className="mt-2 text-[11.5px] text-[var(--text-muted)]">
            {plan.aVenir} étape{plan.aVenir > 1 ? "s" : ""} prévue{plan.aVenir > 1 ? "s" : ""} pour{" "}
            {nomProchainOuvre(plan.aujourdhui).toLowerCase()}.
          </p>
        ) : null}
      </Palier>

      {/* 2 · Leads à relancer */}
      <Palier
        numero={2}
        titre="Leads à relancer"
        compte={relances.length}
        note={affaires.length ? `lot du jour, ${RELANCES_PAR_JOUR} max par personne · après les affaires` : `lot du jour, ${RELANCES_PAR_JOUR} max par personne`}
      >
        {relances.length === 0 ? (
          <p className="text-[12.5px] text-[var(--text-muted)]">Aucune relance due.</p>
        ) : (
          <>
            <ul className="space-y-0.5">
              {relances.map((l) => (
                <LigneLead key={l.cle} l={l} responsable={vue === "equipe" ? nomDe(l.ownerId) : null} onFait={() => retirer(l.cle)} />
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <Link
                href="/leads?vue=prospection"
                className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-brand-600 hover:underline dark:text-brand-300"
              >
                <PhoneCall className="size-3.5" />
                Ouvrir la file de relances
              </Link>
              {enAttente ? (
                <span className="text-[11.5px] text-[var(--text-muted)]">
                  {enAttente} autre{enAttente > 1 ? "s" : ""} en attente pour les jours suivants
                </span>
              ) : null}
            </div>
          </>
        )}
      </Palier>

      {/* 3 · Prospection libre */}
      <Palier numero={3} titre="Prospection libre" compte={null}>
        {verrou.ouvert ? (
          <Link
            href="/leads?vue=prospection"
            className="flex items-center gap-2 rounded-[10px] bg-emerald-500/10 px-3 py-2 text-[12.5px] font-medium text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-300"
          >
            <LockOpen className="size-3.5" />
            Ouverte : le plan est fait, place aux nouveaux leads
            <Rocket className="ml-auto size-3.5" />
          </Link>
        ) : (
          <p className="flex items-center gap-2 text-[12.5px] text-[var(--text-muted)]">
            <Lock className="size-3.5" />
            S&apos;ouvre quand tes affaires ({verrou.affaires}) et tes relances ({verrou.relances}) sont traitées.
          </p>
        )}
      </Palier>
    </Card>
  );
}

function Palier({
  numero,
  titre,
  compte,
  note,
  children,
}: {
  numero: number;
  titre: string;
  compte: number | null;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4 border-t border-[var(--border-subtle)] pt-3">
      <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
        <span className="grid size-5 place-items-center rounded-full bg-[var(--surface-hover)] text-[11px]">{numero}</span>
        {titre}
        {compte != null ? <span className="font-normal text-[var(--text-muted)]">{compte}</span> : null}
        {note ? <span className="ml-auto text-[11px] font-normal text-[var(--text-muted)]">{note}</span> : null}
      </h3>
      {children}
    </section>
  );
}

function Groupe({
  titre,
  ton,
  items,
  replierApres,
  children,
}: {
  titre: string;
  ton: string;
  items: ItemAffaire[];
  replierApres: number;
  children: (a: ItemAffaire) => React.ReactNode;
}) {
  const [tout, setTout] = useState(false);
  const montres = tout ? items : items.slice(0, replierApres);
  return (
    <div className="mb-2.5">
      <p className={cn("mb-1 text-[10.5px] font-semibold tracking-wide uppercase", ton)}>
        {titre} · {items.length}
      </p>
      <ul className="space-y-1">{montres.map(children)}</ul>
      {items.length > montres.length ? (
        <button
          type="button"
          onClick={() => setTout(true)}
          className="mt-1 flex items-center gap-1 text-[11.5px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <ChevronDown className="size-3" /> {items.length - montres.length} de plus
        </button>
      ) : null}
    </div>
  );
}

function Pastille({ nom }: { nom: string | null }) {
  if (!nom) return null;
  return (
    <span
      title={nom}
      className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--surface-hover)] text-[10px] font-medium text-[var(--text-secondary)]"
    >
      {initials(nom)}
    </span>
  );
}

function LigneAffaire({
  a,
  geste,
  responsable,
  onFait,
}: {
  a: ItemAffaire;
  geste: string | undefined;
  responsable: string | null;
  onFait: () => void;
}) {
  const toast = useToast();
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [etape, setEtape] = useState("");
  const [le, setLe] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  function valider(avecSuite: boolean) {
    demarrer(async () => {
      const r = await faireAvancer(a.dealId, avecSuite ? { etape, le } : { etape: null, le: null });
      if (!r.ok) return toast(r.error, "error");
      onFait();
      toast(avecSuite && le ? "Fait — prochaine étape enregistrée." : "Fait.");
      router.refresh();
    });
  }

  return (
    <li className={cn("rounded-[10px] ring-1 ring-transparent transition-colors", ouvert ? "bg-[var(--surface-hover)]/50 ring-[var(--border-subtle)]" : "hover:bg-[var(--surface-hover)]/40")}>
      <div className="flex items-start gap-2.5 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOuvert((o) => !o)}
          aria-label="Marquer comme fait"
          title="Fait"
          className={cn(
            "mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full ring-1 transition-colors",
            ouvert ? "bg-emerald-500 text-white ring-emerald-500" : "text-transparent ring-[var(--border-strong)] hover:text-emerald-500 hover:ring-emerald-500",
          )}
        >
          <Check className="size-3" />
        </button>
        <Link href={`/affaires?affaire=${a.dealId}`} className="group min-w-0 flex-1">
          <p className="text-[13px] leading-snug font-medium">
            {a.action}
            {a.retard ? <span className="ml-1.5 text-[11.5px] font-normal text-rose-500">{a.retard} j de retard</span> : null}
            {a.type === "dormante" ? <span className="ml-1.5 text-[11.5px] font-normal text-amber-600 dark:text-amber-400">{a.motif}</span> : null}
          </p>
          <p className="truncate text-[11.5px] text-[var(--text-muted)]">
            {a.nom} · {a.etapeLibelle}
            {a.montant ? ` · ${formatMoney(a.montant, true)}` : ""}
            {a.aussi.length ? ` · ${a.aussi.join(" · ")}` : ""}
          </p>
          {geste ? (
            <p className="mt-0.5 flex items-start gap-1 text-[11.5px] text-[var(--text-secondary)]">
              <Sparkles className="mt-0.5 size-3 shrink-0 text-brand-500 dark:text-brand-300" />
              {geste}
            </p>
          ) : null}
        </Link>
        <Pastille nom={responsable} />
        <Link
          href={`/affaires?affaire=${a.dealId}`}
          aria-label="Ouvrir l'affaire"
          className="mt-0.5 shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <ArrowUpRight className="size-3.5" />
        </Link>
      </div>

      {ouvert ? (
        <div className="flex flex-wrap items-center gap-2 px-2 pb-2 pl-9">
          <Input
            autoFocus
            value={etape}
            onChange={(e) => setEtape(e.target.value)}
            placeholder="Prochaine étape (ex. Relancer après la démo)"
            className="h-9 min-w-48 flex-1 text-[13px] sm:h-8"
            onKeyDown={(e) => e.key === "Enter" && etape.trim() && le && valider(true)}
          />
          <DateField value={le} onChange={setLe} placeholder="Quand ?" dense />
          <Button size="sm" variant="primary" loading={enCours} disabled={!etape.trim() || !le} onClick={() => valider(true)}>
            Enregistrer
          </Button>
          <Button size="sm" variant="ghost" disabled={enCours} onClick={() => valider(false)}>
            Plus tard
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function LigneLead({ l, responsable, onFait }: { l: ItemLead; responsable: string | null; onFait: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const [enCours, demarrer] = useTransition();

  function cocher() {
    demarrer(async () => {
      const r = await cocherItem(l.cle, true);
      if (!r.ok) return toast(r.error, "error");
      onFait();
      router.refresh();
    });
  }

  return (
    <li className={cn("flex items-center gap-2.5 rounded-[10px] px-2 py-1 hover:bg-[var(--surface-hover)]/40", enCours && "opacity-50")}>
      <button
        type="button"
        onClick={cocher}
        disabled={enCours}
        aria-label="Relance faite"
        title="Relance faite"
        className="grid size-[18px] shrink-0 place-items-center rounded-full text-transparent ring-1 ring-[var(--border-strong)] transition-colors hover:text-emerald-500 hover:ring-emerald-500"
      >
        <Check className="size-3" />
      </button>
      <Link href={`/leads?lead=${l.leadId}`} className="min-w-0 flex-1 truncate text-[13px]">
        <span className="font-medium">{l.nom}</span>
        <span className="text-[var(--text-muted)]">
          {l.entreprise ? ` · ${l.entreprise}` : ""} · {l.statutLibelle}
        </span>
      </Link>
      {l.retard ? <span className="shrink-0 text-[11px] text-rose-500">{l.retard} j</span> : null}
      <Pastille nom={responsable} />
    </li>
  );
}
