"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  CircleDollarSign,
  FileText,
  Handshake,
  ListChecks,
  Mail,
  MessageSquare,
  Phone,
  User,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  ProgressBar,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";
import { DateField } from "@/components/ui/date-field";
import { PROJECT_HEALTH, PROJECT_STATUS, PROJECT_STATUS_ORDER } from "@/lib/constants";
import type {
  Comment,
  Company,
  Contact,
  Deal,
  DocumentRow,
  Profile,
  Project,
  ProjectStatus,
  Task,
} from "@/lib/database.types";
import { cn, daysUntil, formatDate, formatMoney } from "@/lib/utils";
import { updateProject } from "@/app/(crm)/projets/actions";
import { ProjectComments } from "@/components/projects/project-comments";
import { DealCalls } from "@/components/crm/deal-calls";
import { ProjectDocuments } from "@/components/projects/project-documents";
import { TaskBoard } from "@/components/projects/task-board";

type MemberLite = { id: string; full_name: string | null; email: string; role: string };
type Tab = "apercu" | "taches" | "documents" | "echanges";

export function ProjectWorkspace({
  project,
  tasks,
  documents,
  comments,
  members,
  company,
  contact,
  deal,
  currentUser,
}: {
  project: Project;
  tasks: Task[];
  documents: DocumentRow[];
  comments: Comment[];
  members: MemberLite[];
  company: Company | null;
  contact: Contact | null;
  deal: Deal | null;
  currentUser: Profile;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();

  const [tab, setTab] = useState<Tab>("apercu");
  const [editing, setEditing] = useState(false);

  const refresh = () => startTransition(() => router.refresh());

  const stats = useMemo(() => {
    const production = tasks.filter((task) => task.kind === "production");
    const milestones = tasks.filter((task) => task.kind === "jalon");
    const done = production.filter((task) => task.status === "termine").length;
    const overdue = tasks.filter(
      (task) => task.status !== "termine" && task.due_on && (daysUntil(task.due_on) ?? 0) < 0,
    ).length;
    return {
      production,
      milestones,
      done,
      overdue,
      pct: production.length === 0 ? 0 : Math.round((done / production.length) * 100),
      nextMilestone: milestones
        .filter((task) => task.status !== "termine" && task.due_on)
        .sort((a, b) => (a.due_on! < b.due_on! ? -1 : 1))[0],
    };
  }, [tasks]);

  async function setStatus(status: ProjectStatus) {
    const result = await updateProject(project.id, { status });
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast(`Projet passé en « ${PROJECT_STATUS[status].label} ».`);
    refresh();
  }

  const tabs: Array<{ key: Tab; label: string; icon: typeof ListChecks; count?: number }> = [
    { key: "apercu", label: "Aperçu", icon: Handshake },
    { key: "taches", label: "Tâches & jalons", icon: ListChecks, count: tasks.length },
    { key: "documents", label: "Documents", icon: FileText, count: documents.length },
    { key: "echanges", label: "Échanges", icon: MessageSquare, count: comments.length },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <Link
        href="/projets"
        className="inline-flex w-fit items-center gap-1.5 text-[12.5px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
      >
        <ArrowLeft className="size-3.5" />
        Tous les projets
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4 animate-fade-up">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight">{project.name}</h1>
            <Badge tone={PROJECT_STATUS[project.status].tone}>{PROJECT_STATUS[project.status].label}</Badge>
            {project.health && PROJECT_HEALTH[project.health] ? (
              <Badge tone={PROJECT_HEALTH[project.health].tone}>{PROJECT_HEALTH[project.health].label}</Badge>
            ) : null}
          </div>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            {project.code ?? "—"}
            {company ? ` · ${company.name}` : ""}
            {project.start_on ? ` · démarré le ${formatDate(project.start_on)}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={project.status}
            onChange={(event) => setStatus(event.target.value as ProjectStatus)}
            className="w-auto min-w-36"
            aria-label="Statut du projet"
          >
            {PROJECT_STATUS_ORDER.map((status) => (
              <option key={status} value={status}>
                {PROJECT_STATUS[status].label}
              </option>
            ))}
          </Select>
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Modifier
          </Button>
        </div>
      </header>

      <Card glow className="p-5">
        <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums">{stats.pct} %</span>
              <span className="text-[12.5px] text-[var(--text-muted)]">
                {stats.done} / {stats.production.length} tâches de production terminées
              </span>
            </div>
            <ProgressBar
              value={stats.pct}
              tone={stats.overdue > 0 ? "amber" : stats.pct === 100 ? "emerald" : "brand"}
              className="mt-3"
            />
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge tone="violet">
                {stats.milestones.filter((m) => m.status === "termine").length} / {stats.milestones.length} jalons
              </Badge>
              {stats.overdue > 0 ? <Badge tone="rose">{stats.overdue} en retard</Badge> : null}
              {project.budget ? <Badge tone="cyan">Budget {formatMoney(project.budget, true)}</Badge> : null}
            </div>
          </div>

          {stats.nextMilestone ? (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-linear-to-br from-brand-500/8 to-accent-500/5 px-4 py-3 sm:w-64">
              <p className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-muted)]">
                <CalendarClock className="size-3.5" />
                Prochain jalon
              </p>
              <p className="mt-1 text-[13.5px] font-medium">{stats.nextMilestone.title}</p>
              <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
                {formatDate(stats.nextMilestone.due_on, "long")}
              </p>
            </div>
          ) : null}
        </div>
      </Card>

      <nav className="flex gap-1 overflow-x-auto border-b border-[var(--border-subtle)]">
        {tabs.map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              "relative flex items-center gap-1.5 px-3.5 py-2.5 text-[13px] font-medium whitespace-nowrap transition-colors",
              tab === key ? "text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
            )}
          >
            <Icon className="size-3.5" />
            {label}
            {count != null ? (
              <span className="rounded-full bg-[var(--surface-hover)] px-1.5 text-[10.5px] tabular-nums">
                {count}
              </span>
            ) : null}
            {tab === key ? (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-linear-to-r from-brand-400 to-accent-400" />
            ) : null}
          </button>
        ))}
      </nav>

      {tab === "apercu" ? (
        <ProjectOverview project={project} company={company} contact={contact} deal={deal} members={members} />
      ) : null}

      {tab === "taches" ? (
        <TaskBoard project={project} tasks={tasks} members={members} onChanged={refresh} />
      ) : null}

      {tab === "documents" ? (
        <ProjectDocuments project={project} documents={documents} onChanged={refresh} />
      ) : null}

      {tab === "echanges" ? (
        <div className="space-y-5">
          {/* Les calls de production remontent ici : après la signature, les
              échanges relèvent du projet et non plus de l'affaire. */}
          <Card className="p-5">
            <DealCalls target={{ kind: "projet", id: project.id }} />
          </Card>

          <ProjectComments
            project={project}
            comments={comments}
            members={members}
            currentUser={currentUser}
            onChanged={refresh}
          />
        </div>
      ) : null}

      <EditProjectDialog
        open={editing}
        project={project}
        members={members}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          toast("Projet mis à jour.");
          refresh();
        }}
      />
    </div>
  );
}

function ProjectOverview({
  project,
  company,
  contact,
  deal,
  members,
}: {
  project: Project;
  company: Company | null;
  contact: Contact | null;
  deal: Deal | null;
  members: MemberLite[];
}) {
  const owner = members.find((member) => member.id === project.owner_id);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="p-5 lg:col-span-2">
        <h2 className="text-[15px] font-semibold tracking-tight">Contexte</h2>
        <p className="mt-2 text-[13.5px] leading-relaxed whitespace-pre-wrap text-[var(--text-secondary)]">
          {project.description?.trim() ||
            deal?.description?.trim() ||
            "Aucune description. Ajoutez le contexte du projet via « Modifier »."}
        </p>

        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          <Detail label="Chef de projet" value={owner?.full_name ?? owner?.email ?? "Non assigné"} icon={User} />
          <Detail label="Budget" value={formatMoney(project.budget)} icon={CircleDollarSign} />
          <Detail label="Démarrage" value={formatDate(project.start_on, "long")} icon={CalendarClock} />
          <Detail label="Échéance" value={formatDate(project.due_on, "long")} icon={CalendarClock} />
        </dl>
      </Card>

      <div className="flex flex-col gap-4">
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold tracking-tight">Client</h2>
          <div className="mt-3 space-y-2.5">
            {company ? (
              <Link
                href={`/entreprises?entreprise=${company.id}`}
                className="flex items-center gap-2 text-[13.5px] transition-colors hover:text-brand-300"
              >
                <Building2 className="size-4 text-[var(--text-muted)]" />
                {company.name}
              </Link>
            ) : (
              <p className="text-[13px] text-[var(--text-muted)]">Aucune entreprise liée.</p>
            )}

            {contact ? (
              <>
                <Link
                  href={`/contacts?contact=${contact.id}`}
                  className="flex items-center gap-2 text-[13.5px] transition-colors hover:text-brand-300"
                >
                  <User className="size-4 text-[var(--text-muted)]" />
                  {contact.full_name ?? "Contact"}
                </Link>
                {contact.email ? (
                  <a
                    href={`mailto:${contact.email}`}
                    className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)] transition-colors hover:text-brand-300"
                  >
                    <Mail className="size-4 text-[var(--text-muted)]" />
                    {contact.email}
                  </a>
                ) : null}
                {contact.phone ? (
                  <a
                    href={`tel:${contact.phone.replace(/\s/g, "")}`}
                    className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)] transition-colors hover:text-brand-300"
                  >
                    <Phone className="size-4 text-[var(--text-muted)]" />
                    {contact.phone}
                  </a>
                ) : null}
              </>
            ) : null}
          </div>
        </Card>

        {deal ? (
          <Card className="p-5">
            <h2 className="text-[15px] font-semibold tracking-tight">Affaire d&apos;origine</h2>
            <Link
              href={`/affaires?affaire=${deal.id}`}
              className="mt-3 flex items-center justify-between gap-3 rounded-[10px] border border-[var(--border-subtle)] px-3 py-2.5 text-[13px] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]/50"
            >
              <span className="truncate">{deal.name}</span>
              {deal.amount ? <Badge tone="cyan">{formatMoney(deal.amount, true)}</Badge> : null}
            </Link>
            {deal.won_at ? (
              <p className="mt-2 text-[11.5px] text-[var(--text-muted)]">
                Signée le {formatDate(deal.won_at, "long")}
              </p>
            ) : null}
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-base)]/50 px-3 py-2">
      <dt className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
        <Icon className="size-3" />
        {label}
      </dt>
      <dd className="mt-1 truncate text-[13px]">{value}</dd>
    </div>
  );
}

function EditProjectDialog({
  open,
  project,
  members,
  onClose,
  onSaved,
}: {
  open: boolean;
  project: Project;
  members: MemberLite[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: project.name,
    description: project.description ?? "",
    start_on: project.start_on ?? "",
    due_on: project.due_on ?? "",
    budget: project.budget != null ? String(project.budget) : "",
    owner_id: project.owner_id ?? "",
    health: project.health ?? "vert",
  });

  function set(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    const parsed = form.budget ? Number(form.budget.replace(",", ".")) : null;
    const result = await updateProject(project.id, {
      name: form.name.trim() || project.name,
      description: form.description || null,
      start_on: form.start_on || null,
      due_on: form.due_on || null,
      budget: Number.isFinite(parsed!) ? parsed : null,
      owner_id: form.owner_id || null,
      health: form.health,
    });
    setSaving(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Modifier le projet"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Nom" className="sm:col-span-2">
          <Input value={form.name} onChange={(event) => set("name", event.target.value)} />
        </Field>
        <Field label="Chef de projet">
          <Select value={form.owner_id} onChange={(event) => set("owner_id", event.target.value)}>
            <option value="">Non assigné</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.full_name ?? member.email}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Santé du projet">
          <Select value={form.health} onChange={(event) => set("health", event.target.value)}>
            <option value="vert">Sous contrôle</option>
            <option value="orange">Vigilance</option>
            <option value="rouge">En risque</option>
          </Select>
        </Field>
        <Field label="Démarrage">
          <DateField value={form.start_on || null} onChange={(value) => set("start_on", value ?? "")} className="w-full" />
        </Field>
        <Field label="Échéance">
          <DateField value={form.due_on || null} onChange={(value) => set("due_on", value ?? "")} className="w-full" />
        </Field>
        <Field label="Budget (€)" className="sm:col-span-2">
          <Input inputMode="decimal" value={form.budget} onChange={(event) => set("budget", event.target.value)} />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Textarea rows={5} value={form.description} onChange={(event) => set("description", event.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
