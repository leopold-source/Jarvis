import { Check, Circle, Clock } from "lucide-react";

import { Badge, Card, EmptyState } from "@/components/ui";
import { TASK_STATUS } from "@/lib/constants";
import type { Task } from "@/lib/database.types";
import { cn, daysUntil, formatDate } from "@/lib/utils";

/**
 * Timeline verticale des jalons et tâches partagés avec le client.
 * La RLS ne renvoie ici que les éléments marqués « visible client ».
 */
export function PortalTimeline({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Clock className="size-5" />}
          title="Le planning arrive"
          description="Les jalons de votre projet apparaîtront ici dès qu'ils seront posés par l'équipe."
        />
      </Card>
    );
  }

  const ordered = [...tasks].sort((a, b) => {
    if (a.due_on && b.due_on && a.due_on !== b.due_on) return a.due_on < b.due_on ? -1 : 1;
    if (a.due_on && !b.due_on) return -1;
    if (!a.due_on && b.due_on) return 1;
    return a.position - b.position;
  });

  return (
    <Card className="p-5">
      <ol className="relative">
        {/* Filet vertical qui relie les étapes. */}
        <span
          aria-hidden
          className="absolute top-2 bottom-2 left-[11px] w-px bg-linear-to-b from-brand-500/40 via-[var(--border-subtle)] to-transparent"
        />

        {ordered.map((task, index) => {
          const done = task.status === "termine";
          const late = !done && task.due_on && (daysUntil(task.due_on) ?? 0) < 0;
          const isMilestone = task.kind === "jalon";

          return (
            <li
              key={task.id}
              style={{ ["--i" as string]: index }}
              className="stagger relative flex gap-4 pb-6 last:pb-0"
            >
              <span
                className={cn(
                  "relative z-10 mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border",
                  done
                    ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-400"
                    : isMilestone
                      ? "border-brand-400/50 bg-[var(--surface-raised)] text-brand-400 shadow-[0_0_14px_-4px_var(--glow-brand)]"
                      : "border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-muted)]",
                )}
              >
                {done ? <Check className="size-3" /> : <Circle className="size-2 fill-current" />}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={cn("text-[14px] font-medium", done && "text-[var(--text-muted)]")}>
                    {task.title}
                  </p>
                  {isMilestone ? <Badge tone="violet">Jalon</Badge> : null}
                  {done ? (
                    <Badge tone="emerald">Terminé</Badge>
                  ) : late ? (
                    <Badge tone="amber">En cours de rattrapage</Badge>
                  ) : (
                    <Badge tone={TASK_STATUS[task.status].tone}>{TASK_STATUS[task.status].label}</Badge>
                  )}
                </div>

                {task.description ? (
                  <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                    {task.description}
                  </p>
                ) : null}

                <p className="mt-1 text-[11.5px] text-[var(--text-muted)]">
                  {done && task.completed_at
                    ? `Terminé le ${formatDate(task.completed_at, "long")}`
                    : task.due_on
                      ? `Prévu pour le ${formatDate(task.due_on, "long")}`
                      : "Date à confirmer"}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
