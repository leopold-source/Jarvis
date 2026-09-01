"use client";

import { useMemo, useState } from "react";
import {
  Check,
  Diamond,
  Eye,
  EyeOff,
  Flag,
  ListChecks,
  Plus,
  Trash2,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";
import { TASK_PRIORITY, TASK_STATUS, TASK_STATUS_ORDER } from "@/lib/constants";
import type { Project, Task, TaskKind, TaskPriority, TaskStatus } from "@/lib/database.types";
import { cn, daysUntil, formatDate } from "@/lib/utils";
import { createTask, deleteTask, updateTask } from "@/app/(crm)/projets/actions";

type MemberLite = { id: string; full_name: string | null; email: string; role: string };

/**
 * Plan de charge du projet.
 *
 * Les jalons structurent le projet en phases : chaque tâche de production peut
 * être rattachée à un jalon, ce qui donne une lecture chronologique côté équipe
 * et une timeline lisible côté client sans exposer le détail opérationnel.
 */
export function TaskBoard({
  project,
  tasks,
  members,
  onChanged,
}: {
  project: Project;
  tasks: Task[];
  members: MemberLite[];
  onChanged: () => void;
}) {
  const toast = useToast();
  const [creating, setCreating] = useState<TaskKind | null>(null);
  const [editing, setEditing] = useState<Task | null>(null);

  const milestones = useMemo(
    () => tasks.filter((task) => task.kind === "jalon").sort(byDueThenPosition),
    [tasks],
  );

  const groups = useMemo(() => {
    const production = tasks.filter((task) => task.kind === "production");
    return [
      ...milestones.map((milestone) => ({
        milestone,
        items: production.filter((task) => task.milestone_id === milestone.id).sort(byDueThenPosition),
      })),
      {
        milestone: null,
        items: production.filter((task) => !task.milestone_id).sort(byDueThenPosition),
      },
    ].filter((group) => group.milestone !== null || group.items.length > 0);
  }, [tasks, milestones]);

  async function toggleDone(task: Task) {
    const next: TaskStatus = task.status === "termine" ? "a_faire" : "termine";
    const result = await updateTask(task.id, project.id, { status: next });
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    onChanged();
  }

  if (tasks.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<ListChecks className="size-5" />}
          title="Aucune tâche"
          description="Structurez le projet : posez des jalons pour les moments clés, des tâches de production pour le travail au quotidien."
          action={
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={() => setCreating("jalon")}>
                <Diamond className="size-3.5" />
                Ajouter un jalon
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setCreating("production")}>
                <Plus className="size-3.5" />
                Ajouter une tâche
              </Button>
            </div>
          }
        />
        <TaskDialog
          open={creating !== null}
          kind={creating ?? "production"}
          project={project}
          milestones={milestones}
          members={members}
          onClose={() => setCreating(null)}
          onSaved={() => {
            setCreating(null);
            onChanged();
          }}
        />
      </Card>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" onClick={() => setCreating("production")}>
          <Plus className="size-3.5" />
          Nouvelle tâche
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setCreating("jalon")}>
          <Diamond className="size-3.5" />
          Nouveau jalon
        </Button>
        <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-[var(--text-muted)]">
          <Eye className="size-3.5" />
          L&apos;œil indique ce que le client voit dans son portail.
        </span>
      </div>

      <div className="flex flex-col gap-4">
        {groups.map((group, groupIndex) => (
          <Card key={group.milestone?.id ?? "sans-jalon"} className="overflow-hidden">
            {group.milestone ? (
              <MilestoneHeader
                milestone={group.milestone}
                doneCount={group.items.filter((task) => task.status === "termine").length}
                total={group.items.length}
                onToggle={() => toggleDone(group.milestone!)}
                onEdit={() => setEditing(group.milestone!)}
              />
            ) : (
              <div className="border-b border-[var(--border-subtle)] px-4 py-3">
                <p className="text-[13px] font-medium text-[var(--text-secondary)]">Hors jalon</p>
              </div>
            )}

            {group.items.length === 0 ? (
              <p className="px-4 py-5 text-[12.5px] text-[var(--text-muted)]">
                Aucune tâche rattachée à ce jalon.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)]">
                {group.items.map((task, index) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    index={groupIndex * 5 + index}
                    assignee={members.find((member) => member.id === task.assignee_id)}
                    onToggle={() => toggleDone(task)}
                    onEdit={() => setEditing(task)}
                  />
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>

      <TaskDialog
        open={creating !== null}
        kind={creating ?? "production"}
        project={project}
        milestones={milestones}
        members={members}
        onClose={() => setCreating(null)}
        onSaved={() => {
          setCreating(null);
          onChanged();
        }}
      />

      <TaskDialog
        open={editing !== null}
        task={editing ?? undefined}
        kind={editing?.kind ?? "production"}
        project={project}
        milestones={milestones.filter((milestone) => milestone.id !== editing?.id)}
        members={members}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          onChanged();
        }}
      />
    </>
  );
}

function byDueThenPosition(a: Task, b: Task) {
  if (a.due_on && b.due_on && a.due_on !== b.due_on) return a.due_on < b.due_on ? -1 : 1;
  if (a.due_on && !b.due_on) return -1;
  if (!a.due_on && b.due_on) return 1;
  return a.position - b.position;
}

function MilestoneHeader({
  milestone,
  doneCount,
  total,
  onToggle,
  onEdit,
}: {
  milestone: Task;
  doneCount: number;
  total: number;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const done = milestone.status === "termine";
  const late = !done && milestone.due_on && (daysUntil(milestone.due_on) ?? 0) < 0;

  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3",
        done ? "bg-emerald-500/5" : "bg-linear-to-r from-brand-500/8 to-transparent",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={done ? "Rouvrir le jalon" : "Marquer le jalon atteint"}
        className={cn(
          "grid size-6 shrink-0 rotate-45 place-items-center rounded-[4px] border transition-all duration-200",
          done
            ? "border-emerald-400/60 bg-emerald-500/25 text-emerald-300"
            : "border-brand-400/50 bg-brand-500/15 text-brand-300 hover:bg-brand-500/25",
        )}
      >
        {done ? <Check className="size-3 -rotate-45" /> : <Flag className="size-3 -rotate-45" />}
      </button>

      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
        <p className={cn("truncate text-[14px] font-medium", done && "text-[var(--text-muted)] line-through")}>
          {milestone.title}
        </p>
        <p className="mt-0.5 text-[11.5px] text-[var(--text-muted)]">
          {milestone.due_on ? formatDate(milestone.due_on, "long") : "Sans échéance"} · {doneCount}/{total} tâche(s)
        </p>
      </button>

      <span className="flex shrink-0 items-center gap-1.5">
        {milestone.is_client_visible ? (
          <Eye className="size-3.5 text-brand-400" aria-label="Visible par le client" />
        ) : (
          <EyeOff className="size-3.5 text-[var(--text-muted)]" aria-label="Interne" />
        )}
        {late ? <Badge tone="rose">En retard</Badge> : null}
        {done ? <Badge tone="emerald">Atteint</Badge> : null}
      </span>
    </div>
  );
}

function TaskRow({
  task,
  index,
  assignee,
  onToggle,
  onEdit,
}: {
  task: Task;
  index: number;
  assignee?: MemberLite;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const done = task.status === "termine";
  const remaining = daysUntil(task.due_on);
  const late = !done && remaining != null && remaining < 0;

  return (
    <li
      style={{ ["--i" as string]: index }}
      className="stagger flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--surface-hover)]/50"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={done ? "Rouvrir la tâche" : "Terminer la tâche"}
        className={cn(
          "grid size-4.5 shrink-0 place-items-center rounded-full border transition-all duration-200",
          done
            ? "border-emerald-400/60 bg-emerald-500/25 text-emerald-300"
            : "border-[var(--border-strong)] hover:border-brand-400 hover:bg-brand-500/10",
        )}
      >
        {done ? <Check className="size-2.5" /> : null}
      </button>

      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
        <p className={cn("truncate text-[13.5px]", done && "text-[var(--text-muted)] line-through")}>
          {task.title}
        </p>
        {assignee ? (
          <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
            {assignee.full_name ?? assignee.email}
          </p>
        ) : null}
      </button>

      <span className="flex shrink-0 items-center gap-1.5">
        {task.is_client_visible ? <Eye className="size-3.5 text-brand-400" aria-label="Visible par le client" /> : null}
        {task.priority !== "normale" ? (
          <Badge tone={TASK_PRIORITY[task.priority].tone}>{TASK_PRIORITY[task.priority].label}</Badge>
        ) : null}
        {!done ? <Badge tone={TASK_STATUS[task.status].tone}>{TASK_STATUS[task.status].label}</Badge> : null}
        {task.due_on ? (
          <span className={cn("text-[11.5px] tabular-nums", late ? "text-rose-400" : "text-[var(--text-muted)]")}>
            {formatDate(task.due_on)}
          </span>
        ) : null}
      </span>
    </li>
  );
}

function TaskDialog({
  open,
  task,
  kind,
  project,
  milestones,
  members,
  onClose,
  onSaved,
}: {
  open: boolean;
  task?: Task;
  kind: TaskKind;
  project: Project;
  milestones: Task[];
  members: MemberLite[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    kind,
    status: "a_faire" as TaskStatus,
    priority: "normale" as TaskPriority,
    due_on: "",
    assignee_id: "",
    milestone_id: "",
    is_client_visible: kind === "jalon",
  });
  const [key, setKey] = useState("");

  // Réinitialise le formulaire à chaque ouverture / changement de tâche.
  const signature = `${open}-${task?.id ?? "nouveau"}-${kind}`;
  if (signature !== key) {
    setKey(signature);
    setForm({
      title: task?.title ?? "",
      description: task?.description ?? "",
      kind: task?.kind ?? kind,
      status: task?.status ?? "a_faire",
      priority: task?.priority ?? "normale",
      due_on: task?.due_on ?? "",
      assignee_id: task?.assignee_id ?? "",
      milestone_id: task?.milestone_id ?? "",
      is_client_visible: task?.is_client_visible ?? kind === "jalon",
    });
  }

  function set<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function save() {
    if (!form.title.trim()) {
      toast("Donnez un titre à la tâche.", "error");
      return;
    }
    setSaving(true);

    const payload = {
      title: form.title.trim(),
      description: form.description || null,
      kind: form.kind,
      status: form.status,
      priority: form.priority,
      due_on: form.due_on || null,
      assignee_id: form.assignee_id || null,
      milestone_id: form.kind === "jalon" ? null : form.milestone_id || null,
      is_client_visible: form.is_client_visible,
    };

    const result = task
      ? await updateTask(task.id, project.id, payload)
      : await createTask({ project_id: project.id, ...payload });

    setSaving(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast(task ? "Tâche mise à jour." : "Tâche ajoutée.");
    onSaved();
  }

  async function remove() {
    if (!task) return;
    if (!window.confirm("Supprimer cette tâche ?")) return;
    const result = await deleteTask(task.id, project.id);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast("Tâche supprimée.");
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task ? "Modifier" : form.kind === "jalon" ? "Nouveau jalon" : "Nouvelle tâche"}
      description={
        form.kind === "jalon"
          ? "Un jalon marque un moment clé du projet et sert de repère au client."
          : "Une tâche de production suit le travail au quotidien."
      }
      footer={
        <>
          {task ? (
            <Button variant="ghost" onClick={remove} className="mr-auto text-rose-400 hover:text-rose-300">
              <Trash2 className="size-4" />
              Supprimer
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            {task ? "Enregistrer" : "Ajouter"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Titre" className="sm:col-span-2">
          <Input
            value={form.title}
            onChange={(event) => set("title", event.target.value)}
            placeholder={form.kind === "jalon" ? "Cadrage validé" : "Rédiger la spécification"}
            autoFocus
          />
        </Field>

        <Field label="Nature">
          <Select value={form.kind} onChange={(event) => set("kind", event.target.value as TaskKind)}>
            <option value="production">Tâche de production</option>
            <option value="jalon">Jalon</option>
          </Select>
        </Field>

        <Field label="Statut">
          <Select value={form.status} onChange={(event) => set("status", event.target.value as TaskStatus)}>
            {TASK_STATUS_ORDER.map((status) => (
              <option key={status} value={status}>
                {TASK_STATUS[status].label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Échéance">
          <Input type="date" value={form.due_on} onChange={(event) => set("due_on", event.target.value)} />
        </Field>

        <Field label="Priorité">
          <Select value={form.priority} onChange={(event) => set("priority", event.target.value as TaskPriority)}>
            {(Object.keys(TASK_PRIORITY) as TaskPriority[]).map((priority) => (
              <option key={priority} value={priority}>
                {TASK_PRIORITY[priority].label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Responsable">
          <Select value={form.assignee_id} onChange={(event) => set("assignee_id", event.target.value)}>
            <option value="">Non assignée</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.full_name ?? member.email}
              </option>
            ))}
          </Select>
        </Field>

        {form.kind === "production" ? (
          <Field label="Rattachée au jalon">
            <Select value={form.milestone_id} onChange={(event) => set("milestone_id", event.target.value)}>
              <option value="">Aucun</option>
              {milestones.map((milestone) => (
                <option key={milestone.id} value={milestone.id}>
                  {milestone.title}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <Field label="Description" className="sm:col-span-2">
          <Textarea
            rows={4}
            value={form.description}
            onChange={(event) => set("description", event.target.value)}
          />
        </Field>
      </div>

      <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-[var(--border-subtle)] px-3 py-2.5">
        <input
          type="checkbox"
          checked={form.is_client_visible}
          onChange={(event) => set("is_client_visible", event.target.checked)}
          className="mt-0.5 size-4 accent-[var(--color-brand-500)]"
        />
        <span>
          <span className="block text-[13px] font-medium">Visible dans le portail client</span>
          <span className="block text-[11.5px] text-[var(--text-muted)]">
            Le client verra le titre, le statut et l&apos;échéance — pas les commentaires internes.
          </span>
        </span>
      </label>
    </Modal>
  );
}
