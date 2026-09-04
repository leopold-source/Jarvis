import Link from "next/link";
import {
  ArrowUpRight,
  CalendarClock,
  CircleDollarSign,
  Compass,
  FolderKanban,
  Handshake,
  MoonStar,
  Target,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
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
import { cn, daysUntil, formatDate, formatMoney, pluralize } from "@/lib/utils";

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
    leadCount,
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
    supabase.from("leads").select("id", { count: "exact", head: true }),
  ]);

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
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title={`Bonjour ${profile.full_name?.split(" ")[0] ?? ""}`.trim()}
        description="Ce qui avance, ce qui dort, et ce qui attend une décision."
      />

      <PipelineInsight insight={insight} />

      <DailySuggestions
        focus={suggestions?.focus ?? null}
        items={(suggestions?.items ?? []) as unknown as SuggestionItemType[]}
        done={(doneRows ?? []).map((row) => row.item_key)}
        generatedAt={suggestions?.created_at ?? null}
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, hint, icon: Icon, href }, index) => (
          <Link key={label} href={href} style={{ ["--i" as string]: index }} className="stagger">
            <Card interactive glow className="h-full p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-[var(--text-muted)]">{label}</p>
                  <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
                  <p className="mt-1 truncate text-[11.5px] text-[var(--text-muted)]">{hint}</p>
                </div>
                <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-linear-to-br from-brand-500/15 to-accent-500/10 text-brand-400 ring-1 ring-[var(--border-subtle)]">
                  <Icon className="size-4.5" />
                </span>
              </div>
            </Card>
          </Link>
        ))}
      </section>

      {/* --- Chantiers ------------------------------------------------- */}
      <Card className="p-5">
        <SectionTitle
          title="Chantiers en cours"
          description="Les sujets que l'on a décidé de faire avancer, et leur avancement réel"
          action={
            <Link
              href="/chantiers"
              className="inline-flex items-center gap-1 text-[12.5px] text-brand-400 hover:text-brand-300"
            >
              Piloter <ArrowUpRight className="size-3.5" />
            </Link>
          }
        />
        {(chantiers ?? []).length === 0 ? (
          <EmptyState
            icon={<Compass className="size-5" />}
            title="Aucun chantier ouvert"
            description="Un chantier porte un objectif chiffré : c'est ce qui distingue une intention d'un cap."
          />
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {(chantiers ?? []).map((chantier, index) => {
              const list = objectifsByChantier.get(chantier.id) ?? [];
              const meta = CHANTIER_STATUS[chantier.status];
              return (
                <Link
                  key={chantier.id}
                  href="/chantiers"
                  style={{ ["--i" as string]: index }}
                  className="stagger group relative overflow-hidden rounded-xl border border-[var(--border-subtle)] p-3.5 transition-colors hover:bg-[var(--surface-hover)]"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute -top-10 -right-10 size-28 rounded-full bg-linear-to-br opacity-15 blur-2xl transition-opacity group-hover:opacity-30",
                      TONE_GRADIENT[meta.tone],
                    )}
                  />
                  <span className="relative flex items-center gap-2">
                    <span className={cn("size-1.5 rounded-full", TONE_DOT[meta.tone])} aria-hidden />
                    <span className="truncate text-[13.5px] font-medium">{chantier.title}</span>
                  </span>

                  {list.length === 0 ? (
                    <p className="relative mt-2 text-[11.5px] text-[var(--text-muted)]">
                      Sans objectif chiffré
                    </p>
                  ) : (
                    <ul className="relative mt-2.5 space-y-2">
                      {list.slice(0, 2).map((objectif) => {
                        const target = Number(objectif.target_value);
                        const current = Number(objectif.current_value);
                        const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
                        const money = METRIC_SOURCE[objectif.source].money;
                        return (
                          <li key={objectif.title}>
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-[11.5px] text-[var(--text-secondary)]">
                                {objectif.title}
                              </span>
                              <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-muted)]">
                                {money
                                  ? `${formatMoney(current, true)} / ${formatMoney(target, true)}`
                                  : `${current} / ${target}`}
                              </span>
                            </span>
                            <ProgressBar
                              value={pct}
                              tone={pct >= 100 ? "emerald" : "brand"}
                              className="mt-1"
                            />
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-3">
          <SectionTitle
            title="Répartition du pipeline"
            description="Affaires par étape — la part ambrée n'a plus bougé depuis le délai fixé"
            action={
              <Link
                href="/affaires"
                className="inline-flex items-center gap-1 text-[12.5px] text-brand-400 hover:text-brand-300"
              >
                Ouvrir le Kanban <ArrowUpRight className="size-3.5" />
              </Link>
            }
          />
          {allDeals.length === 0 ? (
            <EmptyState
              icon={<Handshake className="size-5" />}
              title="Aucune affaire pour l'instant"
              description="Convertissez un lead en « call pris » pour créer votre première affaire."
            />
          ) : (
            <ul className="mt-5 space-y-2.5">
              {byStage.map(({ stage, total, dormants, amount }, index) => (
                <li
                  key={stage}
                  className="stagger grid grid-cols-[9.5rem_1fr_auto] items-center gap-3"
                  style={{ ["--i" as string]: index }}
                >
                  <span className="truncate text-[12.5px] text-[var(--text-secondary)]">
                    {DEAL_STAGE[stage].label}
                  </span>
                  {/*
                    Une seule barre, deux teintes : la longueur dit le volume,
                    la couleur dit ce qui est encore vivant. Deux barres
                    séparées auraient obligé à comparer deux échelles.
                  */}
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
                  <span className="text-right text-[12px] tabular-nums text-[var(--text-muted)]">
                    {total}
                    {dormants > 0 ? ` · ${dormants} dorm.` : ""}
                    {amount > 0 ? ` · ${formatMoney(amount, true)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5 lg:col-span-2">
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
            <ul className="mt-4 divide-y divide-[var(--border-subtle)]">
              {aReveiller.map((deal, index) => {
                const days = sante.get(deal.id)?.jours_dans_etape ?? 0;
                return (
                  <li key={deal.id} className="stagger py-2.5" style={{ ["--i" as string]: index }}>
                    <Link
                      href={`/affaires?affaire=${deal.id}`}
                      className="group flex items-center justify-between gap-3"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-medium group-hover:text-brand-300">
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
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle title="Relances à passer" description="Leads dont la date de relance approche" />
          {(leadsToCall ?? []).length === 0 ? (
            <EmptyState
              icon={<CalendarClock className="size-5" />}
              title="Rien à relancer"
              description="Aucune relance planifiée dans les deux prochaines semaines."
            />
          ) : (
            <ul className="mt-4 divide-y divide-[var(--border-subtle)]">
              {(leadsToCall ?? []).map((lead, index) => {
                const remaining = daysUntil(lead.follow_up_on);
                return (
                  <li key={lead.id} className="stagger py-2.5" style={{ ["--i" as string]: index }}>
                    <Link href={`/leads?lead=${lead.id}`} className="group flex items-center justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-medium group-hover:text-brand-300">
                          {lead.full_name ?? "Sans nom"}
                        </span>
                        <span className="block truncate text-[11.5px] text-[var(--text-muted)]">
                          {lead.company_name ?? "—"}
                        </span>
                      </span>
                      <Badge tone={remaining != null && remaining < 0 ? "rose" : "amber"}>
                        {remaining != null && remaining < 0
                          ? `En retard de ${Math.abs(remaining)} j`
                          : formatDate(lead.follow_up_on)}
                      </Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-[11.5px] text-[var(--text-muted)]">
            {leadCount.count ?? 0} leads en base.{" "}
            <Link href="/leads" className="text-brand-400 hover:text-brand-300">
              Ouvrir la prospection
            </Link>
          </p>
        </Card>

        <Card className="p-5">
          <SectionTitle title="Échéances proches" description="Tâches et jalons des 14 prochains jours" />
          {(dueTasks ?? []).length === 0 ? (
            <EmptyState
              icon={<CalendarClock className="size-5" />}
              title="Aucune échéance imminente"
              description="Les tâches à venir apparaîtront ici."
            />
          ) : (
            <ul className="mt-4 divide-y divide-[var(--border-subtle)]">
              {(dueTasks ?? []).map((task, index) => {
                const remaining = daysUntil(task.due_on);
                return (
                  <li key={task.id} className="stagger py-2.5" style={{ ["--i" as string]: index }}>
                    <Link href={`/projets/${task.project_id}`} className="group flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        {task.kind === "jalon" ? (
                          <span className="size-1.5 shrink-0 rotate-45 bg-brand-400" aria-hidden />
                        ) : (
                          <span className="size-1.5 shrink-0 rounded-full bg-[var(--text-muted)]" aria-hidden />
                        )}
                        <span className="truncate text-[13.5px] group-hover:text-brand-300">{task.title}</span>
                      </span>
                      <Badge tone={remaining != null && remaining < 0 ? "rose" : remaining! <= 3 ? "amber" : "stone"}>
                        {formatDate(task.due_on)}
                      </Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle
            title="Projets en cours"
            action={
              <Link
                href="/projets"
                className="inline-flex items-center gap-1 text-[12.5px] text-brand-400 hover:text-brand-300"
              >
                Tout voir <ArrowUpRight className="size-3.5" />
              </Link>
            }
          />
          {(projects ?? []).length === 0 ? (
            <EmptyState
              icon={<FolderKanban className="size-5" />}
              title="Aucun projet actif"
              description="Un projet est créé automatiquement dès qu'une affaire passe en « gagné »."
            />
          ) : (
            <ul className="mt-4 space-y-2.5">
              {(projects ?? []).map((project, index) => (
                <li key={project.id} className="stagger" style={{ ["--i" as string]: index }}>
                  <Link
                    href={`/projets/${project.id}`}
                    className="group flex items-center justify-between gap-3 rounded-[10px] px-2 py-2 transition-colors hover:bg-[var(--surface-hover)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-medium group-hover:text-brand-300">
                        {project.name}
                      </span>
                      <span className="block text-[11.5px] text-[var(--text-muted)]">
                        {project.code ?? "—"} · échéance {formatDate(project.due_on)}
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

        {allDeals.length > 0 ? (
          <Card className="p-5">
            <SectionTitle title="Taux de conversion" description="Part des affaires clôturées remportées" />
            <div className="mt-4 flex items-center gap-4">
              <span className="text-3xl font-semibold tabular-nums">{winRate ?? 0} %</span>
              <ProgressBar value={winRate ?? 0} className="flex-1" tone="emerald" />
            </div>
            <p className="mt-2 text-[12px] text-[var(--text-muted)]">
              {wonDeals.length} gagnée(s) sur {closed} clôturée(s). Les {dormant.length} affaire(s) en
              sommeil ne comptent dans aucun des deux : elles n&apos;ont pas été tranchées.
            </p>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
