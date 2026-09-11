import { Suspense } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CalendarClock,
  CircleDollarSign,
  FolderKanban,
  Handshake,
  MoonStar,
  Receipt,
  Target,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { AgendaDuJour } from "@/components/crm/agenda-du-jour";
import { PipelineInsight } from "@/components/crm/pipeline-insight";
import { DailySuggestions } from "@/components/crm/daily-suggestions";
import type { SuggestionItemType } from "@/app/(crm)/suggestions-actions";
import { Badge, Card, EmptyState, ProgressBar, SectionTitle } from "@/components/ui";
import {
  CHANTIER_STATUS,
  DEAL_STAGE,
  DEAL_STAGE_ORDER,
  METRIC_SOURCE,
  OPEN_STAGES,
  PROJECT_STATUS,
  TONE_DOT,
  TONE_GRADIENT,
} from "@/lib/constants";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn, daysUntil, formatDate, formatMoney, formatRelative, pluralize } from "@/lib/utils";

export const metadata = { title: "Tableau de bord" };

export default async function DashboardPage() {
  const profile = await requireStaff();
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const inTwoWeeks = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

  const [
    { data: deals },
    { data: health },
    { data: leadsToCall },
    { data: projects },
    { data: dueTasks },
  ] = await Promise.all([
    supabase
      .from("deals")
      .select("id, name, stage, amount, company_id, expected_close_on, stage_changed_at"),
    supabase.from("deal_health").select("deal_id, sante, jours_dans_etape"),
    supabase
      .from("leads")
      .select("id, full_name, company_name, status, follow_up_on")
      .not("follow_up_on", "is", null)
      .lte("follow_up_on", inTwoWeeks)
      .order("follow_up_on", { ascending: true })
      .limit(6),
    supabase
      .from("projects")
      .select("id, name, code, status, due_on, health, company_id")
      .not("status", "in", "(cloture)")
      .order("due_on", { ascending: true, nullsFirst: false })
      .limit(5),
    supabase
      .from("tasks")
      .select("id, title, due_on, project_id, kind, status")
      .neq("status", "termine")
      .not("due_on", "is", null)
      .lte("due_on", inTwoWeeks)
      .order("due_on", { ascending: true })
      .limit(6),
  ]);

  const { data: facturesDues } = await supabase
    .from("invoices")
    .select("id, label, amount_ttc, due_on, status")
    .in("status", ["prevue", "emise"])
    .not("due_on", "is", null)
    .lte("due_on", inTwoWeeks)
    .order("due_on")
    .limit(5);

  const [{ data: insight }, { data: suggestions }, { data: doneRows }, { data: chantiers }, { data: objectifs }] =
    await Promise.all([
      supabase
        .from("pipeline_insights")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("daily_suggestions").select("*").eq("for_date", today).maybeSingle(),
      supabase
        .from("suggestion_done")
        .select("item_key")
        .eq("suggestion_date", today)
        .eq("user_id", profile.id),
      supabase
        .from("chantiers")
        .select("id, title, intention, status, started_on")
        .neq("status", "termine")
        .order("position", { ascending: true })
        .limit(4),
      supabase.from("objectifs").select("chantier_id, title, target_value, current_value, source, due_on"),
    ]);

  // La RLS restreint déjà ces deux tables au propriétaire de la boîte : on ne
  // voit jamais le courrier de l'autre, même sur un tableau de bord partagé.
  const [{ data: passages }, mailsEnAttente] = await Promise.all([
    supabase.from("mail_runs").select("*").order("started_at", { ascending: false }).limit(1),
    supabase.from("mail_triage").select("id", { count: "exact", head: true }).eq("review", "en_attente"),
  ]);
  const dernierTri = (passages ?? [])[0] ?? null;

  /*
    Actif ou dormant : la lecture qui manquait.

    Une propale sans réponse depuis deux mois n'est pas perdue — la déclarer
    morte serait faux, et surtout irréversible. Mais la compter dans le
    prévisionnel au même titre qu'une affaire vivante gonfle un chiffre sur
    lequel on prend des décisions. D'où cette troisième lecture, calculée depuis
    la date du dernier mouvement, et dont les seuils vivent en base.
  */
  const sante = new Map((health ?? []).map((row) => [row.deal_id, row]));
  const allDeals = deals ?? [];
  const openDeals = allDeals.filter((deal) => OPEN_STAGES.includes(deal.stage));
  const dormant = openDeals.filter((deal) => sante.get(deal.id)?.sante === "dormant");
  const actifs = openDeals.filter((deal) => sante.get(deal.id)?.sante !== "dormant");
  const wonDeals = allDeals.filter((deal) => deal.stage === "gagne");

  const pipelineActif = actifs.reduce((sum, deal) => sum + (deal.amount ?? 0), 0);
  const pipelineDormant = dormant.reduce((sum, deal) => sum + (deal.amount ?? 0), 0);
  const weighted = actifs.reduce(
    (sum, deal) => sum + ((deal.amount ?? 0) * DEAL_STAGE[deal.stage].probability) / 100,
    0,
  );
  const wonValue = wonDeals.reduce((sum, deal) => sum + (deal.amount ?? 0), 0);
  const closed = allDeals.filter((deal) => ["gagne", "perdu"].includes(deal.stage)).length;
  const winRate = closed > 0 ? Math.round((wonDeals.length / closed) * 100) : null;

  const aReveiller = [...dormant]
    .sort(
      (a, b) => (sante.get(b.id)?.jours_dans_etape ?? 0) - (sante.get(a.id)?.jours_dans_etape ?? 0),
    )
    .slice(0, 6);

  const byStage = DEAL_STAGE_ORDER.map((stage) => {
    const stageDeals = allDeals.filter((deal) => deal.stage === stage);
    return {
      stage,
      total: stageDeals.length,
      dormants: stageDeals.filter((deal) => sante.get(deal.id)?.sante === "dormant").length,
      amount: stageDeals.reduce((sum, deal) => sum + (deal.amount ?? 0), 0),
    };
  });
  const maxStageCount = Math.max(1, ...byStage.map((entry) => entry.total));

  const objectifsByChantier = new Map<string, typeof objectifs>();
  for (const objectif of objectifs ?? []) {
    const list = objectifsByChantier.get(objectif.chantier_id) ?? [];
    list.push(objectif);
    objectifsByChantier.set(objectif.chantier_id, list);
  }

  /*
    Une seule file pour tout ce qui tombe.

    Relances, tâches et factures étaient trois listes côte à côte, chacune
    triée dans son coin. Or la question qu'on se pose devant un tableau de bord
    n'est pas « qu'est-ce que j'ai en tâches » mais « qu'est-ce qui tombe en
    premier » : l'ordre chronologique répond, trois colonnes obligent à faire
    la fusion de tête.
  */
  const echeances = [
    ...(leadsToCall ?? []).map((lead) => ({
      id: `lead-${lead.id}`,
      date: lead.follow_up_on,
      titre: lead.full_name ?? "Sans nom",
      detail: lead.company_name ?? "Relance",
      href: `/leads?lead=${lead.id}`,
      genre: "relance" as const,
    })),
    ...(dueTasks ?? []).map((task) => ({
      id: `task-${task.id}`,
      date: task.due_on,
      titre: task.title,
      detail: task.kind === "jalon" ? "Jalon de projet" : "Tâche",
      href: `/projets/${task.project_id}`,
      genre: "tache" as const,
    })),
    ...(facturesDues ?? []).map((facture) => ({
      id: `facture-${facture.id}`,
      date: facture.due_on,
      titre: facture.label,
      detail: `${formatMoney(Number(facture.amount_ttc), true)} · ${facture.status === "emise" ? "à encaisser" : "à émettre"}`,
      href: "/facturation",
      genre: "facture" as const,
    })),
  ]
    .filter((entree) => entree.date)
    .sort((a, b) => (a.date! < b.date! ? -1 : 1))
    .slice(0, 8);

  const GENRE_ICONE = {
    relance: CalendarClock,
    tache: FolderKanban,
    facture: Receipt,
  } as const;

  const stats = [
    {
      label: "Pipeline actif",
      value: formatMoney(pipelineActif, true),
      hint: pluralize(actifs.length, "affaire en mouvement", "affaires en mouvement"),
      icon: CircleDollarSign,
      href: "/affaires",
    },
    {
      label: "Prévisionnel pondéré",
      value: formatMoney(weighted, true),
      hint: "Sur le seul pipeline actif",
      icon: Target,
      href: "/affaires",
    },
    {
      label: "En sommeil",
      value: formatMoney(pipelineDormant, true),
      hint:
        dormant.length === 0
          ? "Aucune affaire à réveiller"
          : `${pluralize(dormant.length, "affaire sans nouvelle", "affaires sans nouvelle")}`,
      icon: MoonStar,
      href: "/affaires",
    },
    {
      label: "Signé",
      value: formatMoney(wonValue, true),
      hint: winRate == null ? "Aucune affaire clôturée" : `${winRate} % de réussite`,
      icon: Handshake,
      href: "/affaires",
    },
  ];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-7">
      <PageHeader
        title={`Bonjour ${profile.full_name?.split(" ")[0] ?? ""}`.trim()}
        description="Ce qui t'attend, ce qui avance, et ce qui dort."
      />

      <PipelineInsight insight={insight} />

      {/* ---------------------------------------------------- Aujourd'hui */}
      <section className="flex flex-col gap-3">
        <Titre>Aujourd&apos;hui</Titre>
        {/*
          Deux panneaux de même hauteur, chacun défilant dans son cadre.
          L'agenda et la liste du jour se lisent ensemble — ce qui est déjà pris
          décide de ce qu'il reste à faire — et aucun des deux ne doit repousser
          l'autre hors de l'écran en se remplissant.
        */}
        <div className="grid items-stretch gap-4 lg:grid-cols-2">
          <Suspense
            fallback={
              <Card className="p-5">
                <div className="skeleton h-4 w-40" />
                <div className="skeleton mt-3 h-3 w-52" />
              </Card>
            }
          >
            <AgendaDuJour userId={profile.id} className="h-full" />
          </Suspense>

          <DailySuggestions
            focus={suggestions?.focus ?? null}
            items={(suggestions?.items ?? []) as unknown as SuggestionItemType[]}
            done={(doneRows ?? []).map((row) => row.item_key)}
            generatedAt={suggestions?.created_at ?? null}
            className="h-full"
          />
        </div>
      </section>

      {/* ------------------------------------------------------- Les chiffres */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, hint, icon: Icon, href }, index) => (
          <Link key={label} href={href} style={{ ["--i" as string]: index }} className="stagger">
            <Card interactive glow className="h-full p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-[var(--text-muted)]">{label}</p>
                  <p className="mt-1 text-[22px] font-semibold tracking-tight tabular-nums">
                    {value}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">{hint}</p>
                </div>
                <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-linear-to-br from-brand-500/15 to-accent-500/10 text-brand-400 ring-1 ring-[var(--border-subtle)]">
                  <Icon className="size-4" />
                </span>
              </div>
            </Card>
          </Link>
        ))}
      </section>

      {/* ------------------------------------------- Ce qui demande une décision */}
      <section className="flex flex-col gap-3">
        <Titre>Ce qui demande une décision</Titre>
        <div className="grid items-stretch gap-4 lg:grid-cols-2">
          <Card className="flex flex-col p-5">
            <SectionTitle
              title="À réveiller"
              description="Ni gagnées ni perdues : simplement sans nouvelle"
            />
            {aReveiller.length === 0 ? (
              <EmptyState
                icon={<MoonStar className="size-5" />}
                title="Rien ne dort"
                description="Toutes les affaires ouvertes ont bougé récemment."
              />
            ) : (
              <ul className="mt-4 max-h-72 flex-1 divide-y divide-[var(--border-subtle)] overflow-y-auto pr-1">
                {aReveiller.map((deal, index) => {
                  const days = sante.get(deal.id)?.jours_dans_etape ?? 0;
                  return (
                    <li key={deal.id} className="stagger py-2.5" style={{ ["--i" as string]: index }}>
                      <Link
                        href={`/affaires?affaire=${deal.id}`}
                        className="group flex items-center justify-between gap-3"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium group-hover:text-brand-300">
                            {deal.name}
                          </span>
                          <span className="block truncate text-[11.5px] text-[var(--text-muted)]">
                            {DEAL_STAGE[deal.stage].label}
                            {deal.amount ? ` · ${formatMoney(deal.amount, true)}` : ""}
                          </span>
                        </span>
                        <Badge tone="amber">{days} j</Badge>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card className="flex flex-col p-5">
            <SectionTitle
              title="Ce qui tombe"
              description="Relances, jalons et factures, dans l'ordre où ça arrive"
            />
            {echeances.length === 0 ? (
              <EmptyState
                icon={<CalendarClock className="size-5" />}
                title="Rien d'imminent"
                description="Aucune échéance dans les deux prochaines semaines."
              />
            ) : (
              <ul className="mt-4 max-h-72 flex-1 divide-y divide-[var(--border-subtle)] overflow-y-auto pr-1">
                {echeances.map((entree, index) => {
                  const Icone = GENRE_ICONE[entree.genre];
                  const restant = daysUntil(entree.date);
                  const retard = restant != null && restant < 0;
                  return (
                    <li key={entree.id} className="stagger py-2.5" style={{ ["--i" as string]: index }}>
                      <Link href={entree.href} className="group flex items-center gap-2.5">
                        <Icone
                          className={cn(
                            "size-3.5 shrink-0",
                            retard ? "text-rose-500" : "text-[var(--text-muted)]",
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] group-hover:text-brand-300">
                            {entree.titre}
                          </span>
                          <span className="block truncate text-[11.5px] text-[var(--text-muted)]">
                            {entree.detail}
                          </span>
                        </span>
                        <Badge tone={retard ? "rose" : restant! <= 3 ? "amber" : "stone"}>
                          {retard ? `${Math.abs(restant!)} j de retard` : formatDate(entree.date)}
                        </Badge>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </section>

      {/* ------------------------------------------------------- L'entreprise */}
      <section className="flex flex-col gap-3">
        <Titre>L&apos;entreprise</Titre>
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Chantiers */}
          <Card className="flex flex-col p-5">
            <SectionTitle
              title="Chantiers"
              action={
                <Link href="/chantiers" className="text-[12px] text-brand-400 hover:text-brand-300">
                  Piloter
                </Link>
              }
            />
            {(chantiers ?? []).length === 0 ? (
              <p className="mt-3 text-[12.5px] text-[var(--text-muted)]">
                Aucun chantier ouvert. Un chantier porte un objectif chiffré.
              </p>
            ) : (
              <ul className="mt-3.5 flex-1 space-y-3">
                {(chantiers ?? []).slice(0, 3).map((chantier) => {
                  const list = objectifsByChantier.get(chantier.id) ?? [];
                  const premier = list[0];
                  const meta = CHANTIER_STATUS[chantier.status];
                  const cible = premier ? Number(premier.target_value) : 0;
                  const atteint = premier ? Number(premier.current_value) : 0;
                  const pct = cible > 0 ? Math.min(100, Math.round((atteint / cible) * 100)) : 0;

                  return (
                    <li key={chantier.id}>
                      <span className="flex items-center gap-2">
                        <span className={cn("size-1.5 rounded-full", TONE_DOT[meta.tone])} aria-hidden />
                        <span className="truncate text-[12.5px] font-medium">{chantier.title}</span>
                      </span>
                      {premier ? (
                        <>
                          <span className="mt-1 flex items-baseline justify-between gap-2">
                            <span className="truncate text-[11px] text-[var(--text-muted)]">
                              {premier.title}
                            </span>
                            <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-muted)]">
                              {METRIC_SOURCE[premier.source].money
                                ? `${formatMoney(atteint, true)} / ${formatMoney(cible, true)}`
                                : `${atteint} / ${cible}`}
                            </span>
                          </span>
                          <ProgressBar value={pct} tone={pct >= 100 ? "emerald" : "brand"} className="mt-1" />
                        </>
                      ) : (
                        <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">
                          Sans objectif chiffré
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* Projets */}
          <Card className="flex flex-col p-5">
            <SectionTitle
              title="Projets"
              action={
                <Link href="/projets" className="text-[12px] text-brand-400 hover:text-brand-300">
                  Tout voir
                </Link>
              }
            />
            {(projects ?? []).length === 0 ? (
              <p className="mt-3 text-[12.5px] text-[var(--text-muted)]">
                Aucun projet actif. Un projet naît d&apos;une affaire gagnée.
              </p>
            ) : (
              <ul className="mt-3.5 flex-1 space-y-2">
                {(projects ?? []).slice(0, 4).map((project) => (
                  <li key={project.id}>
                    <Link
                      href={`/projets/${project.id}`}
                      className="group flex items-center justify-between gap-2"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[12.5px] font-medium group-hover:text-brand-300">
                          {project.name}
                        </span>
                        <span className="block text-[11px] text-[var(--text-muted)]">
                          {formatDate(project.due_on)}
                        </span>
                      </span>
                      <Badge tone={PROJECT_STATUS[project.status].tone}>
                        {PROJECT_STATUS[project.status].label}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Boîte mail */}
          <Link href="/mails" className="block">
            <Card interactive className="flex h-full flex-col p-5">
              <SectionTitle title="Boîte mail" />
              <p className="mt-3 text-[22px] font-semibold tabular-nums">
                {mailsEnAttente.count ?? 0}
              </p>
              <p className="text-[12px] text-[var(--text-muted)]">
                {(mailsEnAttente.count ?? 0) > 0
                  ? "en attente de ta décision"
                  : "rien ne t'attend"}
              </p>
              <p className="mt-auto pt-3 text-[11px] text-[var(--text-muted)]">
                {dernierTri
                  ? `Trié ${formatRelative(dernierTri.started_at)} · ${dernierTri.lus} lu(s)` +
                    (dernierTri.spams > 0 ? ` · ${dernierTri.spams} écarté(s)` : "")
                  : "Le tri ne s'est encore jamais exécuté"}
              </p>
            </Card>
          </Link>
        </div>
      </section>

      {/* -------------------------------------------------- Le pipeline, en bas */}
      {allDeals.length > 0 ? (
        <Card className="p-5">
          <SectionTitle
            title="Répartition du pipeline"
            description="La part ambrée n'a plus bougé depuis le délai fixé"
            action={
              <Link
                href="/affaires"
                className="inline-flex items-center gap-1 text-[12px] text-brand-400 hover:text-brand-300"
              >
                Ouvrir le Kanban <ArrowUpRight className="size-3.5" />
              </Link>
            }
          />
          <ul className="mt-4 space-y-2">
            {byStage
              .filter((entry) => entry.total > 0)
              .map(({ stage, total, dormants, amount }, index) => (
                <li
                  key={stage}
                  className="stagger grid grid-cols-[8.5rem_1fr_auto] items-center gap-3"
                  style={{ ["--i" as string]: index }}
                >
                  <span className="truncate text-[12px] text-[var(--text-secondary)]">
                    {DEAL_STAGE[stage].label}
                  </span>
                  {/* Une seule barre, deux teintes : la longueur dit le volume,
                      la couleur dit ce qui est encore vivant. */}
                  <span className="flex h-2 overflow-hidden rounded-full bg-[var(--surface-hover)]">
                    <span
                      className={cn(
                        "block h-full bg-linear-to-r transition-[width] duration-700",
                        TONE_GRADIENT[DEAL_STAGE[stage].tone],
                      )}
                      style={{ width: `${((total - dormants) / maxStageCount) * 100}%` }}
                    />
                    <span
                      className="block h-full bg-linear-to-r from-amber-500/70 to-amber-400/50 transition-[width] duration-700"
                      style={{ width: `${(dormants / maxStageCount) * 100}%` }}
                    />
                  </span>
                  <span className="text-right text-[11.5px] tabular-nums text-[var(--text-muted)]">
                    {total}
                    {dormants > 0 ? ` · ${dormants} dorm.` : ""}
                    {amount > 0 ? ` · ${formatMoney(amount, true)}` : ""}
                  </span>
                </li>
              ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * Le titre d'une zone.
 *
 * Quatre intertitres suffisent à remplacer la lecture de neuf cartes empilées :
 * l'œil saute d'une zone à l'autre au lieu de parcourir la page en entier pour
 * retrouver ce qu'il cherche.
 */
function Titre({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-medium tracking-[0.08em] text-[var(--text-muted)] uppercase">
      {children}
    </h2>
  );
}
