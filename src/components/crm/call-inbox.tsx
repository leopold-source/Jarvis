"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ExternalLink, Users, X } from "lucide-react";

import { Badge, Button, Card, SectionTitle, Select, useToast } from "@/components/ui";
import type { CallInbox as CallInboxRow } from "@/lib/database.types";
import { formatDate } from "@/lib/utils";
import { dismissPendingCall, resolvePendingCall } from "@/app/(crm)/affaires/call-actions";

type TargetLite = { id: string; name: string };

/**
 * Calls que le rattachement automatique n'a pas su placer.
 *
 * On ne devine pas : on montre qui était dans l'appel et on laisse trancher.
 * Un call écarté disparaît de la file sans rien créer — beaucoup d'échanges
 * n'ont aucune raison d'entrer dans le CRM.
 */
export function CallInbox({
  pending,
  deals,
  projects,
}: {
  pending: CallInboxRow[];
  deals: TargetLite[];
  projects: TargetLite[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  if (pending.length === 0) return null;

  async function attach(row: CallInboxRow) {
    const choice = choices[row.id];
    if (!choice) {
      toast("Choisissez une affaire ou un projet.", "error");
      return;
    }
    // La valeur porte son type : « affaire:uuid » ou « projet:uuid ».
    const [kind, id] = choice.split(":");
    setBusy(row.id);
    const result = await resolvePendingCall(row.id, {
      kind: kind as "affaire" | "projet",
      id,
    });
    setBusy(null);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast("Call rattaché.");
    startTransition(() => router.refresh());
  }

  async function dismiss(row: CallInboxRow) {
    setBusy(row.id);
    const result = await dismissPendingCall(row.id);
    setBusy(null);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <Card glow className="p-4">
      <SectionTitle
        title={
          <span className="flex items-center gap-2">
            <AlertCircle className="size-4 text-amber-500" />
            Calls à rattacher
          </span>
        }
        description="Aucun participant ne correspond à un contact du CRM. Rattachez à une affaire ou à un projet, ou écartez."
        action={<Badge tone="amber">{pending.length}</Badge>}
      />

      <ul className="mt-3 space-y-1.5">
        {pending.map((row, index) => {
          const emails = (row.participants as Array<{ email?: string }> | null) ?? [];
          return (
            <li
              key={row.id}
              style={{ ["--i" as string]: index }}
              className="stagger flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-subtle)] px-3 py-2"
            >
              <div className="min-w-40 flex-1">
                <p className="truncate text-[12.5px] font-medium">{row.title ?? "Call"}</p>
                <p className="flex items-center gap-1.5 truncate text-[11px] text-[var(--text-muted)]">
                  <Users className="size-3 shrink-0" />
                  {emails.map((person) => person.email).filter(Boolean).join(", ") || "participants inconnus"}
                  {row.occurred_on ? ` · ${formatDate(row.occurred_on)}` : ""}
                </p>
              </div>

              <Select
                value={choices[row.id] ?? ""}
                onChange={(event) =>
                  setChoices((current) => ({ ...current, [row.id]: event.target.value }))
                }
                aria-label="Affaire ou projet à rattacher"
                className="w-auto min-w-48"
              >
                <option value="">Choisir une destination…</option>
                {deals.length > 0 ? (
                  <optgroup label="Affaires">
                    {deals.map((deal) => (
                      <option key={deal.id} value={`affaire:${deal.id}`}>
                        {deal.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {projects.length > 0 ? (
                  <optgroup label="Projets">
                    {projects.map((project) => (
                      <option key={project.id} value={`projet:${project.id}`}>
                        {project.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </Select>

              <Button
                size="sm"
                variant="primary"
                loading={busy === row.id}
                onClick={() => attach(row)}
              >
                Rattacher
              </Button>

              {row.url ? (
                <a
                  href={row.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Ouvrir dans Claap"
                  className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-brand-500 dark:hover:text-brand-300"
                >
                  <ExternalLink className="size-3.5" />
                </a>
              ) : null}

              <button
                type="button"
                onClick={() => dismiss(row)}
                title="Écarter ce call"
                aria-label="Écarter ce call"
                className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-rose-500"
              >
                <X className="size-3.5" />
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
