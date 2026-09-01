import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CalendarClock } from "lucide-react";

import { Badge, Card, ProgressBar } from "@/components/ui";
import { PROJECT_STATUS } from "@/lib/constants";
import { PortalTimeline } from "@/components/portal/portal-timeline";
import { PortalDocuments } from "@/components/portal/portal-documents";
import { PortalThread } from "@/components/portal/portal-thread";
import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("projects").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ?? "Projet" };
}

export default async function PortalProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireClient();
  const supabase = await createClient();

  // Chaque requête est filtrée par la RLS : un client ne peut lire que les
  // projets de son entreprise, et seulement ce qui a été partagé avec lui.
  const { data: project } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (!project) notFound();

  const [{ data: tasks }, { data: documents }, { data: comments }, { data: progress }] =
    await Promise.all([
      supabase.from("tasks").select("*").eq("project_id", id).order("due_on", { nullsFirst: false }),
      supabase.from("documents").select("*").eq("project_id", id).order("created_at", { ascending: false }),
      supabase.from("comments").select("*").eq("project_id", id).order("created_at", { ascending: false }),
      supabase.from("project_progress").select("*").eq("project_id", id).maybeSingle(),
    ]);

  const pct = progress?.progress_pct ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/portail"
        className="inline-flex w-fit items-center gap-1.5 text-[12.5px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
      >
        <ArrowLeft className="size-3.5" />
        Tous mes projets
      </Link>

      <header className="animate-fade-up">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[24px] font-semibold tracking-tight">{project.name}</h1>
          <Badge tone={PROJECT_STATUS[project.status].tone}>{PROJECT_STATUS[project.status].label}</Badge>
        </div>
        {project.description ? (
          <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-[var(--text-secondary)]">
            {project.description}
          </p>
        ) : null}
      </header>

      <Card glow className="p-5">
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-semibold tabular-nums">{pct} %</span>
          <span className="text-[13px] text-[var(--text-muted)]">d&apos;avancement</span>
        </div>
        <ProgressBar value={pct} tone={pct === 100 ? "emerald" : "brand"} className="mt-3" />

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Metric label="Jalons atteints" value={`${progress?.milestones_done ?? 0} / ${progress?.milestones_total ?? 0}`} />
          <Metric label="Démarrage" value={formatDate(project.start_on, "long")} />
          <Metric label="Livraison prévue" value={formatDate(project.due_on, "long")} />
        </div>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <CalendarClock className="size-4 text-brand-400" />
          Avancement du projet
        </h2>
        <PortalTimeline tasks={tasks ?? []} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight">Documents</h2>
        <PortalDocuments documents={documents ?? []} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight">Échanges</h2>
        <PortalThread projectId={project.id} comments={comments ?? []} currentUser={profile} />
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-base)]/50 px-3 py-2.5">
      <p className="text-[11px] text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 text-[13.5px] font-medium">{value}</p>
    </div>
  );
}
