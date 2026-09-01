import Link from "next/link";
import {
  ArrowUpRight,
  CalendarClock,
  CircleDollarSign,
  FolderKanban,
  Handshake,
  Sparkles,
  Target,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge, Card, EmptyState, ProgressBar, SectionTitle } from "@/components/ui";
import {
  DEAL_STAGE,
  DEAL_STAGE_ORDER,
  OPEN_STAGES,
  PROJECT_STATUS,
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

  const [{ data: deals }, { data: leadsToCall }, { data: projects }, { data: dueTasks }, leadCount] =
    await Promise.all([
      supabase.from("deals").select("id, name, stage, amount, company_id, expected_close_on, stage_changed_at"),
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

  const allDeals = deals ?? [];
  const openDeals = allDeals.filter((deal) => OPEN_STAGES.includes(deal.stage));
  const wonDeals = allDeals.filter((deal) => deal.stage === "gagne");

  const pipelineValue = openDeals.reduce((sum, deal) => sum + (deal.amount ?? 0), 0);
  const weighted = openDeals.reduce(
    (sum, deal) => sum + ((deal.amount ?? 0) * DEAL_STAGE[deal.stage].probability) / 100,
    0,
  );
  const wonValue = wonDeals.reduce((sum, deal) => sum + (deal.amount ?? 0), 0);
  const closed = allDeals.filter((deal) => ["gagne", "perdu"].includes(deal.stage)).length;
  const winRate = closed > 0 ? Math.round((wonDeals.length / closed) * 100) : null;

  const byStage = DEAL_STAGE_ORDER.map((stage) => ({
    stage,
    deals: allDeals.filter((deal) => deal.stage === stage),
  }));
  const maxStageCount = Math.max(1, ...byStage.map((entry) => entry.deals.length));

  const stats = [
    {
      label: "Pipeline ouvert",
      value: formatMoney(pipelineValue, true),
      hint: pluralize(openDeals.length, "affaire active", "affaires actives"),
      icon: CircleDollarSign,
      href: "/affaires",
    },
    {
      label: "Prévisionnel pondéré",
      value: formatMoney(weighted, true),
      hint: "Selon la probabilité d'étape",
      icon: Target,
      href: "/affaires",
    },
    {
      label: "Signé",
      value: formatMoney(wonValue, true),
      hint: winRate == null ? "Aucune affaire clôturée" : `${winRate} % de réussite`,
      icon: Handshake,
      href: "/affaires",
    },
    {
      label: "Leads en base",
      value: String(leadCount.count ?? 0),
      hint: `${(leadsToCall ?? []).length} relance(s) à venir`,
      icon: Sparkles,
      href: "/leads",
    },
  ];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title={`Bonjour ${profile.full_name?.split(" ")[0] ?? ""}`.trim()}
        description="Vue d'ensemble du pipeline, des relances à passer et des projets en cours."
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

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-3">
          <SectionTitle
            title="Répartition du pipeline"
            description="Nombre d'affaires par étape"
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
              {byStage.map(({ stage, deals: stageDeals }, index) => {
                const amount = stageDeals.reduce((sum, deal) => sum + (deal.amount ?? 0), 0);
                return (
                  <li
                    key={stage}
                    className="stagger grid grid-cols-[9.5rem_1fr_auto] items-center gap-3"
                    style={{ ["--i" as string]: index }}
                  >
                    <span className="truncate text-[12.5px] text-[var(--text-secondary)]">
                      {DEAL_STAGE[stage].label}
                    </span>
                    <span className="h-2 overflow-hidden rounded-full bg-[var(--surface-hover)]">
                      <span
                        className={cn(
                          "block h-full rounded-full bg-linear-to-r transition-[width] duration-700",
                          TONE_GRADIENT[DEAL_STAGE[stage].tone],
                        )}
                        style={{ width: `${(stageDeals.length / maxStageCount) * 100}%` }}
                      />
                    </span>
                    <span className="text-right text-[12px] tabular-nums text-[var(--text-muted)]">
                      {stageDeals.length}
                      {amount > 0 ? ` · ${formatMoney(amount, true)}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="p-5 lg:col-span-2">
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

      {allDeals.length > 0 ? (
        <Card className="p-5">
          <SectionTitle title="Taux de conversion" description="Part des affaires clôturées remportées" />
          <div className="mt-4 flex items-center gap-4">
            <span className="text-3xl font-semibold tabular-nums">{winRate ?? 0} %</span>
            <ProgressBar value={winRate ?? 0} className="flex-1" tone="emerald" />
          </div>
          <p className="mt-2 text-[12px] text-[var(--text-muted)]">
            {wonDeals.length} gagnée(s) sur {closed} clôturée(s).
          </p>
        </Card>
      ) : null}
    </div>
  );
}
