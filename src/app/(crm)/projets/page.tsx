import Link from "next/link";
import { CalendarClock, FolderKanban } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge, Card, EmptyState, ProgressBar } from "@/components/ui";
import { PROJECT_HEALTH, PROJECT_STATUS, PROJECT_STATUS_ORDER } from "@/lib/constants";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { daysUntil, formatDate, formatMoney } from "@/lib/utils";

export const metadata = { title: "Projets" };

export default async function ProjectsPage() {
  await requireStaff();
  const supabase = await createClient();

  const [{ data: projects }, { data: progress }, { data: companies }] = await Promise.all([
    supabase.from("projects").select("*").order("created_at", { ascending: false }),
    supabase.from("project_progress").select("*"),
    supabase.from("companies").select("id, name"),
  ]);

  const progressById = new Map((progress ?? []).map((row) => [row.project_id, row]));
  const companyById = new Map((companies ?? []).map((company) => [company.id, company.name]));

  const grouped = PROJECT_STATUS_ORDER.map((status) => ({
    status,
    items: (projects ?? []).filter((project) => project.status === status),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        title="Projets"
        description="Chaque projet naît d'une affaire gagnée. Suivez l'avancement, les jalons et les livrables."
      />

      {(projects ?? []).length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderKanban className="size-5" />}
            title="Aucun projet pour l'instant"
            description="Faites passer une affaire en « gagné » dans le Kanban : le projet est créé avec son plan de démarrage."
          />
        </Card>
      ) : (
        grouped.map((group) => (
          <section key={group.status} className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-[13px] font-medium text-[var(--text-secondary)]">
              {PROJECT_STATUS[group.status].label}
              <span className="rounded-full bg-[var(--surface-hover)] px-1.5 text-[11px] tabular-nums text-[var(--text-muted)]">
                {group.items.length}
              </span>
            </h2>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {group.items.map((project, index) => {
                const stats = progressById.get(project.id);
                const pct = stats?.progress_pct ?? 0;
                const remaining = daysUntil(project.due_on);
                const overdue = (stats?.tasks_overdue ?? 0) > 0;

                return (
                  <Link
                    key={project.id}
                    href={`/projets/${project.id}`}
                    style={{ ["--i" as string]: index }}
                    className="stagger"
                  >
                    <Card interactive glow className="h-full p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[14.5px] font-medium">{project.name}</p>
                          <p className="mt-0.5 truncate text-[11.5px] text-[var(--text-muted)]">
                            {project.code ?? "—"}
                            {project.company_id ? ` · ${companyById.get(project.company_id) ?? ""}` : ""}
                          </p>
                        </div>
                        {project.health && PROJECT_HEALTH[project.health] ? (
                          <Badge tone={PROJECT_HEALTH[project.health].tone}>
                            {PROJECT_HEALTH[project.health].label}
                          </Badge>
                        ) : null}
                      </div>

                      <div className="mt-4 flex items-center gap-2.5">
                        <ProgressBar
                          value={pct}
                          tone={overdue ? "amber" : pct === 100 ? "emerald" : "brand"}
                          className="flex-1"
                        />
                        <span className="text-[12px] tabular-nums text-[var(--text-secondary)]">{pct} %</span>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11.5px]">
                        <Badge tone="stone">
                          {stats?.tasks_done ?? 0}/{stats?.tasks_total ?? 0} tâches
                        </Badge>
                        <Badge tone="violet">
                          {stats?.milestones_done ?? 0}/{stats?.milestones_total ?? 0} jalons
                        </Badge>
                        {overdue ? <Badge tone="rose">{stats!.tasks_overdue} en retard</Badge> : null}
                      </div>

                      <div className="mt-3 flex items-center justify-between text-[11.5px] text-[var(--text-muted)]">
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock className="size-3" />
                          {project.due_on
                            ? `${formatDate(project.due_on)}${
                                remaining != null && remaining < 0 ? " (dépassée)" : ""
                              }`
                            : "Pas d'échéance"}
                        </span>
                        {project.budget ? <span>{formatMoney(project.budget, true)}</span> : null}
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
