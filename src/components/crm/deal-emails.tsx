"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Loader2, Mail, MailPlus } from "lucide-react";

import { Badge } from "@/components/ui";
import type { EmailMessage } from "@/lib/database.types";
import { cn, formatRelative } from "@/lib/utils";
import { fetchDealEmails } from "@/app/(crm)/affaires/email-actions";

/**
 * Fil des échanges rattachés à l'affaire.
 *
 * Chargé à l'ouverture du tiroir plutôt qu'avec la liste des affaires : la
 * plupart des consultations n'ouvrent aucune fiche, autant ne rien payer pour
 * celles-là.
 */
export function DealEmails({ dealId }: { dealId: string }) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; messages: EmailMessage[]; connected: boolean } | { status: "error"; error: string }
  >({ status: "loading" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    fetchDealEmails(dealId).then((result) => {
      if (!active) return;
      setState(
        result.ok
          ? { status: "ready", messages: result.messages, connected: result.connected }
          : { status: "error", error: result.error },
      );
    });
    return () => {
      active = false;
    };
  }, [dealId]);

  return (
    <section>
      <h3 className="flex items-center gap-2 text-[12.5px] font-medium text-[var(--text-secondary)]">
        <Mail className="size-3.5 text-brand-500 dark:text-brand-300" />
        Échanges e-mail
        {state.status === "ready" && state.messages.length > 0 ? (
          <span className="text-[11px] text-[var(--text-muted)]">({state.messages.length})</span>
        ) : null}
      </h3>

      {state.status === "loading" ? (
        <p className="mt-2 flex items-center gap-2 text-[12.5px] text-[var(--text-muted)]">
          <Loader2 className="size-3.5 animate-spin" />
          Chargement…
        </p>
      ) : state.status === "error" ? (
        <p className="mt-2 text-[12.5px] text-red-500">{state.error}</p>
      ) : state.messages.length === 0 ? (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[12.5px] text-[var(--text-muted)]">
          <MailPlus className="size-3.5" />
          {state.connected
            ? "Aucun échange rattaché pour l'instant."
            : "Connectez votre boîte Gmail pour voir les échanges ici."}
          {!state.connected ? (
            <Link href="/parametres" className="text-brand-500 hover:underline dark:text-brand-300">
              Réglages
            </Link>
          ) : null}
        </p>
      ) : (
        <ol className="mt-2 space-y-1.5">
          {state.messages.map((message) => {
            const outbound = message.direction === "outbound";
            return (
              <li
                key={message.id}
                className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-base)]/50 px-3 py-2"
              >
                <div className="flex items-start gap-2">
                  <span
                    className={cn(
                      "mt-0.5 grid size-5 shrink-0 place-items-center rounded-md",
                      outbound
                        ? "bg-brand-500/15 text-brand-500 dark:text-brand-300"
                        : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
                    )}
                    title={outbound ? "Message envoyé" : "Message reçu"}
                  >
                    {outbound ? <ArrowUpRight className="size-3" /> : <ArrowDownLeft className="size-3" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <p className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                        {message.subject || "(sans objet)"}
                      </p>
                      <span className="text-[11px] text-[var(--text-muted)]">
                        {message.sent_at ? formatRelative(message.sent_at) : "—"}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11.5px] text-[var(--text-muted)]">
                      {message.from_email}
                    </p>
                    {message.snippet ? (
                      <p className="mt-1 line-clamp-2 text-[12px] text-[var(--text-secondary)]">
                        {message.snippet}
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {state.status === "ready" && state.messages.length > 0 ? (
        <p className="mt-2 text-[11px] text-[var(--text-muted)]">
          <Badge tone="stone">Lecture seule</Badge>{" "}
          <span className="align-middle">Objet, date et extrait uniquement — le corps reste dans Gmail.</span>
        </p>
      ) : null}
    </section>
  );
}
