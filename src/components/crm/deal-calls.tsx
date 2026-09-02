"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Video } from "lucide-react";

import { Badge } from "@/components/ui";
import { CALL_KIND, CALL_KIND_ORDER } from "@/lib/constants";
import type { CallKind, CallRecord } from "@/lib/database.types";
import { cn, formatDate } from "@/lib/utils";
import { fetchDealCalls, setCallKind } from "@/app/(crm)/affaires/call-actions";

/**
 * Historique des calls d'une affaire.
 *
 * Le compteur en tête vaut autant que la liste : « 3 calls, dont 2 R2 » dit
 * en un coup d'œil si l'affaire avance ou si elle tourne en rond.
 */
export function DealCalls({ dealId }: { dealId: string }) {
  const [calls, setCalls] = useState<CallRecord[] | null>(null);

  useEffect(() => {
    let active = true;
    setCalls(null);
    fetchDealCalls(dealId).then((result) => {
      if (active) setCalls(result.ok ? result.calls : []);
    });
    return () => {
      active = false;
    };
  }, [dealId]);

  async function requalify(callId: string, kind: CallKind | null) {
    setCalls((current) =>
      current?.map((call) => (call.id === callId ? { ...call, kind } : call)) ?? current,
    );
    await setCallKind(callId, kind);
  }

  const counts = (calls ?? []).reduce<Record<string, number>>((acc, call) => {
    if (call.kind) acc[call.kind] = (acc[call.kind] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <section>
      <h3 className="flex flex-wrap items-center gap-2 text-[12.5px] font-medium text-[var(--text-secondary)]">
        <Video className="size-3.5 text-brand-500 dark:text-brand-300" />
        Calls Claap
        {calls && calls.length > 0 ? (
          <>
            <span className="text-[11px] text-[var(--text-muted)]">({calls.length})</span>
            {CALL_KIND_ORDER.filter((kind) => counts[kind]).map((kind) => (
              <Badge key={kind} tone={CALL_KIND[kind].tone}>
                {counts[kind]} × {CALL_KIND[kind].label}
              </Badge>
            ))}
          </>
        ) : null}
      </h3>

      {calls === null ? (
        <p className="mt-2 flex items-center gap-2 text-[12.5px] text-[var(--text-muted)]">
          <Loader2 className="size-3.5 animate-spin" />
          Chargement…
        </p>
      ) : calls.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-[var(--text-muted)]">
          Aucun call rattaché à cette affaire.
        </p>
      ) : (
        <ol className="mt-2 space-y-1.5">
          {calls.map((call) => (
            <li
              key={call.id}
              className="flex items-center gap-2 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-base)]/50 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium">{call.title ?? "Call"}</p>
                <p className="text-[11px] text-[var(--text-muted)]">
                  {call.occurred_on ? formatDate(call.occurred_on) : "—"}
                  {call.duration_minutes ? ` · ${call.duration_minutes} min` : ""}
                </p>
              </div>

              <select
                value={call.kind ?? ""}
                onChange={(event) => requalify(call.id, (event.target.value || null) as CallKind | null)}
                aria-label="Qualifier le call"
                className={cn(
                  "cursor-pointer appearance-none rounded-full border-0 px-2 py-0.5 text-[11px] font-medium",
                  "ring-1 ring-inset outline-none transition-colors",
                  call.kind
                    ? "bg-brand-500/12 text-brand-600 ring-brand-500/30 dark:text-brand-300"
                    : "text-[var(--text-muted)] ring-[var(--border-strong)]",
                )}
              >
                <option value="">À qualifier</option>
                {CALL_KIND_ORDER.map((kind) => (
                  <option key={kind} value={kind} className="bg-[var(--surface-overlay)] text-[var(--text-primary)]">
                    {CALL_KIND[kind].label}
                  </option>
                ))}
              </select>

              {call.url ? (
                <a
                  href={call.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Ouvrir dans Claap"
                  className="shrink-0 rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-brand-500 dark:hover:text-brand-300"
                >
                  <ExternalLink className="size-3.5" />
                </a>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
