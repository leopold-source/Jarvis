"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoonStar, X } from "lucide-react";

import { Badge, Button, Card, Input, SectionTitle, useToast } from "@/components/ui";
import { DEAL_STAGE, DEAL_STAGE_ORDER } from "@/lib/constants";
import type { DealActivityRule, DealStage } from "@/lib/database.types";
import { setDormancyRule } from "@/app/(crm)/parametres/dormancy-actions";

const CLOSED: DealStage[] = ["gagne", "perdu", "non_qualifie"];

/**
 * Le réglage de ce qu'on appelle « dormant ».
 *
 * Chaque ligne montre le seuil et, à côté, combien d'affaires y basculent
 * aujourd'hui : un seuil se juge à ce qu'il produit, pas dans l'abstrait.
 */
export function DormancySettings({
  rules,
  dormants,
  isAdmin,
}: {
  rules: DealActivityRule[];
  dormants: Record<string, number>;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  const current = new Map(rules.map((rule) => [rule.stage, rule]));
  const stages = DEAL_STAGE_ORDER.filter((stage) => !CLOSED.includes(stage));

  async function save(stage: DealStage, value: number | null) {
    setBusy(true);
    const result = await setDormancyRule(stage, value);
    setBusy(false);
    if (!result.ok) return toast(result.error, "error");
    startTransition(() => router.refresh());
  }

  return (
    <Card className="p-5">
      <SectionTitle
        title="Affaires dormantes"
        description="Au bout de combien de jours sans mouvement une affaire cesse de compter dans le prévisionnel"
      />

      <p className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-base)]/50 p-3 text-[12px] leading-relaxed text-[var(--text-muted)]">
        Une affaire dormante n&apos;est pas perdue : elle n&apos;a simplement plus bougé. Elle reste
        dans son étape, on ne la déclare pas morte — mais elle sort du pipeline actif et du
        prévisionnel pondéré, pour que ces deux chiffres disent la vérité. Une étape sans seuil ne
        dort jamais.
      </p>

      <ul className="mt-4 space-y-1.5">
        {stages.map((stage) => (
          <RuleRow
            key={stage}
            stage={stage}
            rule={current.get(stage) ?? null}
            dormants={dormants[stage] ?? 0}
            busy={busy}
            isAdmin={isAdmin}
            onSave={(value) => save(stage, value)}
          />
        ))}
      </ul>
    </Card>
  );
}

function RuleRow({
  stage,
  rule,
  dormants,
  busy,
  isAdmin,
  onSave,
}: {
  stage: DealStage;
  rule: DealActivityRule | null;
  dormants: number;
  busy: boolean;
  isAdmin: boolean;
  onSave: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(rule ? String(rule.max_days_active) : "");
  const meta = DEAL_STAGE[stage];

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[var(--border-subtle)] px-3 py-2">
      <span className="min-w-32 flex-1 text-[12.5px]">{meta.label}</span>

      {dormants > 0 ? (
        <Badge tone="amber">
          <MoonStar className="mr-1 inline size-3" />
          {dormants} dormante(s)
        </Badge>
      ) : null}

      {rule ? null : (
        <span className="text-[11.5px] text-[var(--text-muted)]">ne dort jamais</span>
      )}

      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const value = draft.trim();
          if (value === "") return;
          if (Number(value) !== rule?.max_days_active) onSave(Number(value) || 0);
        }}
        disabled={!isAdmin || busy}
        inputMode="numeric"
        placeholder="—"
        className="h-7 w-16 text-right text-[12.5px]"
        aria-label={`Seuil pour ${meta.label}`}
      />
      <span className="text-[11.5px] text-[var(--text-muted)]">jours</span>

      {isAdmin && rule ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setDraft("");
            onSave(null);
          }}
          title="Cette étape ne dort jamais"
          aria-label={`Retirer le seuil de ${meta.label}`}
          className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-rose-500 disabled:opacity-40"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </li>
  );
}
