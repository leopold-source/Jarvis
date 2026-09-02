"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Check,
  ListChecks,
  Phone,
  RefreshCw,
  Scale,
  Send,
  Sparkles,
} from "lucide-react";

import { Badge, Button, Card, SectionTitle, useToast } from "@/components/ui";
import type { SuggestionItemType } from "@/app/(crm)/suggestions-actions";
import { generateSuggestions, toggleSuggestion } from "@/app/(crm)/suggestions-actions";
import { cn } from "@/lib/utils";

const KIND = {
  appel: { icon: Phone, label: "Appel" },
  relance: { icon: Send, label: "Relance" },
  decision: { icon: Scale, label: "Décision" },
  administratif: { icon: ListChecks, label: "Admin" },
};

/**
 * La liste d'actions du matin.
 *
 * Le cochage est optimiste et local à l'utilisateur : on ne recharge pas la
 * page pour une case, et ce que l'un traite reste visible pour l'autre.
 */
export function DailySuggestions({
  focus,
  items,
  done,
  generatedAt,
}: {
  focus: string | null;
  items: SuggestionItemType[];
  done: string[];
  generatedAt: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [checked, setChecked] = useState<Set<string>>(new Set(done));
  const [running, setRunning] = useState(false);

  async function regenerate() {
    setRunning(true);
    const result = await generateSuggestions(true);
    setRunning(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    setChecked(new Set());
    startTransition(() => router.refresh());
  }

  async function toggle(key: string) {
    const next = new Set(checked);
    const willBeDone = !next.has(key);
    if (willBeDone) next.add(key);
    else next.delete(key);
    setChecked(next);

    const result = await toggleSuggestion(key, willBeDone);
    if (!result.ok) {
      // On rend la case à son état d'origine : mieux vaut une coche qui
      // revient qu'une tâche crue faite alors qu'elle n'a pas été notée.
      setChecked(new Set(checked));
      toast(result.error, "error");
    }
  }

  const remaining = items.filter((item) => !checked.has(item.key)).length;

  return (
    <Card glow className="p-5">
      <SectionTitle
        title={
          <span className="flex items-center gap-2">
            <ListChecks className="size-4 text-brand-500 dark:text-brand-300" />
            Suggestions du jour
          </span>
        }
        description={focus ?? "Les gestes à faire aujourd'hui, tirés de l'état du CRM."}
        action={
          <span className="flex items-center gap-2">
            {items.length > 0 ? (
              <Badge tone={remaining === 0 ? "emerald" : "orange"}>
                {remaining === 0 ? "Tout est fait" : `${remaining} à faire`}
              </Badge>
            ) : null}
            <Button variant="ghost" size="sm" loading={running} onClick={regenerate}>
              <RefreshCw className="size-3.5" />
              <span className="hidden sm:inline">Régénérer</span>
            </Button>
          </span>
        }
      />

      {items.length === 0 ? (
        <div className="mt-4 flex flex-col items-start gap-3 rounded-xl border border-dashed border-[var(--border-strong)] p-4">
          <p className="text-[13px] text-[var(--text-muted)]">
            Aucune suggestion pour aujourd&apos;hui. Elles sont préparées chaque matin
            automatiquement.
          </p>
          <Button variant="secondary" size="sm" loading={running} onClick={regenerate}>
            <Sparkles className="size-3.5" />
            Préparer maintenant
          </Button>
        </div>
      ) : (
        <ol className="mt-4 space-y-1.5">
          {items.map((item, index) => {
            const isDone = checked.has(item.key);
            const kind = KIND[item.kind] ?? KIND.administratif;
            const Icon = kind.icon;

            return (
              <li
                key={item.key}
                style={{ ["--i" as string]: index }}
                className={cn(
                  "stagger group flex items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-all duration-200",
                  isDone
                    ? "border-transparent bg-[var(--surface-hover)]/40 opacity-55"
                    : "border-[var(--border-subtle)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]/40",
                )}
              >
                <button
                  type="button"
                  onClick={() => toggle(item.key)}
                  aria-pressed={isDone}
                  aria-label={isDone ? "Marquer à refaire" : "Marquer comme fait"}
                  className={cn(
                    "mt-0.5 grid size-4.5 shrink-0 place-items-center rounded-[6px] border transition-all duration-200",
                    isDone
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-[var(--border-strong)] hover:border-brand-400 hover:bg-brand-500/10",
                  )}
                >
                  <Check
                    className={cn(
                      "size-3 transition-transform duration-200",
                      isDone ? "scale-100" : "scale-0",
                    )}
                  />
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p
                      className={cn(
                        "text-[13px] font-medium",
                        isDone && "line-through decoration-[var(--text-muted)]",
                      )}
                    >
                      {item.title}
                    </p>
                    {item.urgency === "haute" && !isDone ? (
                      <Badge tone="red">Urgent</Badge>
                    ) : null}
                  </div>
                  <p className="mt-0.5 flex items-start gap-1.5 text-[12px] text-[var(--text-muted)]">
                    <Icon className="mt-0.5 size-3 shrink-0" />
                    <span>{item.detail}</span>
                  </p>
                </div>

                <Link
                  href={item.href}
                  prefetch={false}
                  aria-label="Ouvrir la fiche"
                  className={cn(
                    "mt-0.5 shrink-0 rounded-md p-1 text-[var(--text-muted)] transition-all duration-200",
                    "opacity-0 group-hover:opacity-100 hover:bg-[var(--surface-hover)] hover:text-brand-500",
                    "focus-visible:opacity-100 dark:hover:text-brand-300",
                  )}
                >
                  <ArrowUpRight className="size-3.5" />
                </Link>
              </li>
            );
          })}
        </ol>
      )}

      {generatedAt ? (
        <p className="mt-3 text-[11px] text-[var(--text-muted)]">
          Préparé le{" "}
          {new Date(generatedAt).toLocaleString("fr-FR", {
            day: "numeric",
            month: "long",
            hour: "2-digit",
            minute: "2-digit",
          })}
          .
        </p>
      ) : null}
    </Card>
  );
}
