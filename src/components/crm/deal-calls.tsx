"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ExternalLink, FileText, Loader2, Video } from "lucide-react";

import { Badge } from "@/components/ui";
import { TexteClaap } from "@/components/crm/texte-claap";
import { CALL_KIND, CALL_KIND_ORDER } from "@/lib/constants";
import type { CallKind } from "@/lib/database.types";
import { cn, formatDate, formatDateHeure } from "@/lib/utils";
import { fetchCalls, setCallKind, type CallAffiche, type CallTarget } from "@/app/(crm)/affaires/call-actions";

/** Au-delà, le résumé du dernier call se replie : la fiche ne doit pas devenir un compte rendu. */
const REPLI_CARACTERES = 900;

function quand(call: CallAffiche): string {
  return call.started_at ? formatDateHeure(call.started_at, { avecAnnee: true }) : formatDate(call.occurred_on);
}

/**
 * Historique des calls d'une affaire, et ce qui s'y est dit.
 *
 * Le résumé du dernier call est posé en tête, ouvert : c'est ce qu'on vient
 * relire avant de rappeler, et l'obtenir demandait d'ouvrir Claap. Les calls
 * précédents gardent le leur à un clic.
 *
 * Le compteur vaut autant que la liste : « 3 calls, dont 2 R2 » dit en un
 * coup d'œil si l'affaire avance ou si elle tourne en rond.
 */
export function DealCalls({ target }: { target: CallTarget }) {
  const [calls, setCalls] = useState<CallAffiche[] | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [toutLire, setToutLire] = useState(false);

  useEffect(() => {
    let active = true;
    setCalls(null);
    setToutLire(false);
    fetchCalls(target).then((result) => {
      if (active) setCalls(result.ok ? result.calls : []);
    });
    return () => {
      active = false;
    };
    // La cible est un objet recréé à chaque rendu : on dépend de ses champs.
  }, [target.kind, target.id]);

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

  // Le plus récent qui ait un résumé — pas forcément le plus récent tout court :
  // Claap met quelques minutes à produire le sien.
  const dernier = (calls ?? []).find((call) => call.summary?.trim());
  const long = (dernier?.summary?.length ?? 0) > REPLI_CARACTERES;

  return (
    <section className="space-y-3">
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

      {dernier ? (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-base)]/60 p-3.5">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] tracking-wide text-[var(--text-muted)] uppercase">
            <FileText className="size-3" />
            Récap Claap
            <span className="normal-case tracking-normal">
              · {dernier.title ?? "Call"} · {quand(dernier)}
            </span>
          </p>
          <div className={cn("relative mt-2", long && !toutLire && "max-h-64 overflow-hidden")}>
            <TexteClaap texte={dernier.summary!} />
            {long && !toutLire ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-[var(--surface-overlay)] to-transparent" />
            ) : null}
          </div>
          {long ? (
            <button
              type="button"
              onClick={() => setToutLire((v) => !v)}
              className="mt-2 text-[11.5px] font-medium text-brand-500 hover:underline dark:text-brand-300"
            >
              {toutLire ? "Replier" : "Tout lire"}
            </button>
          ) : null}
        </div>
      ) : null}

      {calls === null ? (
        <p className="flex items-center gap-2 text-[12.5px] text-[var(--text-muted)]">
          <Loader2 className="size-3.5 animate-spin" />
          Chargement…
        </p>
      ) : calls.length === 0 ? (
        <p className="text-[12.5px] text-[var(--text-muted)]">
          Aucun call rattaché à {target.kind === "affaire" ? "cette affaire" : "ce projet"}.
        </p>
      ) : (
        <ol className="space-y-1.5">
          {calls.map((call) => {
            const deplie = ouvert === call.id;
            const resume = call.summary?.trim();
            return (
              <li
                key={call.id}
                className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-base)]/50"
              >
                <div className="flex items-center gap-2 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setOuvert(deplie ? null : call.id)}
                    disabled={!resume}
                    aria-expanded={deplie}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
                  >
                    <ChevronDown
                      className={cn(
                        "size-3.5 shrink-0 text-[var(--text-muted)] transition-transform",
                        deplie && "rotate-180",
                        !resume && "opacity-0",
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium">{call.title ?? "Call"}</span>
                      <span className="block text-[11px] text-[var(--text-muted)]">
                        {quand(call)}
                        {call.duration_minutes ? ` · ${call.duration_minutes} min` : ""}
                        {resume ? " · résumé" : " · pas encore de résumé"}
                        {call.has_transcript ? " · transcript" : ""}
                      </span>
                    </span>
                  </button>

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
                </div>

                {deplie && resume ? (
                  <div className="border-t border-[var(--border-subtle)] px-3 py-2.5">
                    <TexteClaap texte={resume} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
