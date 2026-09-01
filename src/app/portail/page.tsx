import Link from "next/link";
import { ArrowRight, FolderKanban } from "lucide-react";

import { Badge, Card, EmptyState, ProgressBar } from "@/components/ui";
import { PROJECT_STATUS } from "@/lib/constants";
import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Mes projets" };

export default async function PortalHome() {
  const profile = await requireClient();
  const supabase = await createClient();

  // La RLS limite déjà la lecture aux projets de l'entreprise du client.
  const [{ data: projects }, { data: progress }, { data: company }] = await Promise.all([
    supabase.from("projects").select("*").order("created_at", { ascending: false }),
    supabase.from("project_progress").select("*"),
    profile.company_id
      ? supabase.from("companies").select("name").eq("id", profile.company_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const progressById = new Map((progress ?? []).map((row) => [row.project_id, row]));

  return (
    <div className="flex flex-col gap-6">
      <header className="animate-fade-up">
        <h1 className="text-[24px] font-semibold tracking-tight">
          Vos projets <span className="text-gradient">Antichaos</span>
        </h1>
        <p className="mt-1.5 text-[13.5px] text-[var(--text-muted)]">
          {company?.name
            ? `Suivi en temps réel des projets de ${company.name}.`
            : "Suivi en temps réel de l'avancement, des jalons et des livrables."}
        </p>
      </header>

      {(projects ?? []).length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderKanban className="size-5" />}
            title="Aucun projet accessible"
            description="Votre espace s'activera dès le lancement de votre projet. Contactez votre interlocuteur Antichaos si vous pensez qu'il s'agit d'une erreur."
          />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {(projects ?? []).map((project, index) => {
            const stats = progressById.get(project.id);
            const pct = stats?.progress_pct ?? 0;

            return (
              <Link
                key={project.id}
                href={`/portail/${project.id}`}
                style={{ ["--i" as string]: index }}
                className="stagger"
              >
                <Card interactive glow className="h-full p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-medium">{project.name}</p>
                      <p className="mt-0.5 text-[11.5px] text-[var(--text-muted)]">{project.code ?? "—"}</p>
                    </div>
                    <Badge tone={PROJECT_STATUS[project.status].tone}>
                      {PROJECT_STATUS[project.status].label}
                    </Badge>
                  </div>

                  <div className="mt-5 flex items-center gap-3">
                    <ProgressBar value={pct} tone={pct === 100 ? "emerald" : "brand"} className="flex-1" />
                    <span className="text-[13px] font-medium tabular-nums">{pct} %</span>
                  </div>

                  <div className="mt-4 flex items-center justify-between text-[11.5px] text-[var(--text-muted)]">
                    <span>
                      {stats?.milestones_done ?? 0} / {stats?.milestones_total ?? 0} jalons atteints
                    </span>
                    <span className="inline-flex items-center gap-1 text-brand-400">
                      Voir le détail <ArrowRight className="size-3" />
                    </span>
                  </div>

                  {project.due_on ? (
                    <p className="mt-2 text-[11.5px] text-[var(--text-muted)]">
                      Livraison prévue le {formatDate(project.due_on, "long")}
                    </p>
                  ) : null}
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
