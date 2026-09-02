"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Info, RefreshCw, Sparkles, Target } from "lucide-react";

import { Badge, Button, Modal, useToast } from "@/components/ui";
import type { PipelineInsight as InsightRow } from "@/lib/database.types";
import { analysePipeline, type PipelinePriority } from "@/app/(crm)/insights-actions";
import { cn, formatRelative } from "@/lib/utils";

const SEVERITY = {
  critique: { label: "Critique", tone: "red" as const },
  important: { label: "Important", tone: "orange" as const },
  surveiller: { label: "À surveiller", tone: "amber" as const },
};

/**
 * Encart d'analyse du pipeline.
 *
 * Une seule ligne sur le tableau de bord — le focus du moment — et tout le
 * détail derrière le « i » : les trois axes, leurs cibles chiffrées, et le
 * raisonnement qui a conduit à ce classement.
 */
export function PipelineInsight({ insight }: { insight: InsightRow | null }) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);

  const priorities = (insight?.priorities ?? []) as unknown as PipelinePriority[];

  async function run() {
    setRunning(true);
    const result = await analysePipeline();
    setRunning(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast("Analyse mise à jour.");
    startTransition(() => router.refresh());
  }

  return (
    <>
      <div
        className={cn(
          "edge-glow flex items-center gap-3 rounded-xl px-4 py-2.5",
          "border border-brand-500/25 bg-linear-to-r from-brand-500/10 via-accent-500/5 to-transparent",
        )}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand-500/20 text-brand-500 dark:text-brand-300">
          <Target className="size-3.5" />
        </span>

        <p className="min-w-0 flex-1 truncate text-[13.5px]">
          {insight ? (
            <>
              <span className="font-medium">{insight.headline}</span>
              <span className="ml-2 text-[11.5px] text-[var(--text-muted)]">
                sur {insight.horizon_days} jours · {formatRelative(insight.created_at)}
              </span>
            </>
          ) : (
            <span className="text-[var(--text-muted)]">
              Aucune analyse du pipeline pour l&apos;instant.
            </span>
          )}
        </p>

        {insight ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Voir le détail de l'analyse"
            title="Voir le détail"
            className="grid size-7 shrink-0 place-items-center rounded-full text-[var(--text-muted)] ring-1 ring-[var(--border-strong)] transition-colors hover:bg-brand-500/15 hover:text-brand-500 dark:hover:text-brand-300"
          >
            <Info className="size-3.5" />
          </button>
        ) : (
          <Button size="sm" variant="secondary" loading={running} onClick={run}>
            <Sparkles className="size-3.5" />
            Analyser
          </Button>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title="Où concentrer l'effort"
        description={
          insight
            ? `Analyse du ${new Date(insight.created_at).toLocaleDateString("fr-FR", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })} · horizon ${insight.horizon_days} jours`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Fermer
            </Button>
            <Button variant="primary" loading={running} onClick={run}>
              <RefreshCw className="size-3.5" />
              Relancer l&apos;analyse
            </Button>
          </>
        }
      >
        <ol className="space-y-3">
          {priorities.map((priority, index) => {
            const severity = SEVERITY[priority.severity] ?? SEVERITY.surveiller;
            return (
              <li
                key={index}
                style={{ ["--i" as string]: index }}
                className="stagger rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-base)]/50 p-3 sm:p-4"
              >
                <div className="flex items-start gap-2.5 sm:gap-3">
                  <span
                    className={cn(
                      "grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold",
                      index === 0
                        ? "bg-linear-to-br from-brand-500 to-brand-600 text-white"
                        : "bg-[var(--surface-hover)] text-[var(--text-secondary)]",
                    )}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[13.5px] font-medium sm:text-[14px]">{priority.title}</p>
                      <Badge tone={severity.tone}>{severity.label}</Badge>
                    </div>
                    <p className="mt-1.5 text-[13px] text-[var(--text-secondary)]">
                      {priority.observation}
                    </p>
                    <p className="mt-1.5 text-[13px] text-[var(--text-secondary)]">
                      <span className="text-[var(--text-muted)]">Action — </span>
                      {priority.action}
                    </p>
                    <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-emerald-500/10 px-2 py-1.5 text-[12.5px] text-emerald-600 dark:text-emerald-300">
                      <Target className="mt-0.5 size-3 shrink-0" />
                      <span>{priority.target}</span>
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {insight?.reasoning ? (
          <div className="mt-4 rounded-xl border border-[var(--border-subtle)] p-4">
            <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--text-secondary)]">
              <Sparkles className="size-3.5 text-brand-500 dark:text-brand-300" />
              Pourquoi ce classement
            </p>
            <p className="mt-2 text-[13px] leading-relaxed whitespace-pre-wrap text-[var(--text-secondary)]">
              {insight.reasoning}
            </p>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
