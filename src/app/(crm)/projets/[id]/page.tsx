import { notFound } from "next/navigation";

import { ProjectWorkspace } from "@/components/projects/project-workspace";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("projects").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ?? "Projet" };
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireStaff();
  const supabase = await createClient();

  const { data: project } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (!project) notFound();

  const [
    { data: tasks },
    { data: documents },
    { data: comments },
    { data: members },
    { data: company },
    { data: contact },
    { data: deal },
  ] = await Promise.all([
    supabase.from("tasks").select("*").eq("project_id", id).order("position"),
    supabase.from("documents").select("*").eq("project_id", id).order("created_at", { ascending: false }),
    supabase.from("comments").select("*").eq("project_id", id).order("created_at", { ascending: true }),
    supabase.from("profiles").select("id, full_name, email, role").neq("role", "client"),
    project.company_id
      ? supabase.from("companies").select("*").eq("id", project.company_id).maybeSingle()
      : Promise.resolve({ data: null }),
    project.contact_id
      ? supabase.from("contacts").select("*").eq("id", project.contact_id).maybeSingle()
      : Promise.resolve({ data: null }),
    project.deal_id
      ? supabase.from("deals").select("*").eq("id", project.deal_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return (
    <ProjectWorkspace
      project={project}
      tasks={tasks ?? []}
      documents={documents ?? []}
      comments={comments ?? []}
      members={members ?? []}
      company={company}
      contact={contact}
      deal={deal}
      currentUser={profile}
    />
  );
}
