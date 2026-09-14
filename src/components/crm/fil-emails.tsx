"use client";

import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Loader2, Mail, MailPlus } from "lucide-react";

import { Badge } from "@/components/ui";
import type { EmailMessage } from "@/lib/database.types";
import { cn, formatRelative } from "@/lib/utils";

/**
 * Le rendu d'un fil d'échanges, sans savoir à quoi il est rattaché.
 *
 * Les affaires et les projets montrent la même chose et la chargent
 * différemment : l'une part de l'affaire, l'autre croise trois sources. Séparer
 * ce qui s'affiche de ce qui se cherche évite le pire des deux mondes — deux
 * fils qui divergeraient lentement, et qu'on croirait montrer la même chose.
 */
export function FilEmails({
  titre,
  messages,
  chargement,
  erreur,
  connecte,
  vide,
  note,
}: {
  titre: string;
  messages: EmailMessage[];
  chargement?: boolean;
  erreur?: string | null;
  connecte?: boolean;
  /** Ce qu'on dit quand il n'y a rien, la boîte étant connectée. */
  vide: string;
  /** Une précision sous la liste, quand le contexte en demande une. */
  note?: string | null;
}) {
  return (
    <section>
      <h3 className="flex items-center gap-2 text-[12.5px] font-medium text-[var(--text-secondary)]">
        <Mail className="size-3.5 text-brand-500 dark:text-brand-300" />
        {titre}
        {!chargement && !erreur && messages.length > 0 ? (
          <span className="text-[11px] text-[var(--text-muted)]">({messages.length})</span>
        ) : null}
      </h3>

      {chargement ? (
        <p className="mt-2 flex items-center gap-2 text-[12.5px] text-[var(--text-muted)]">
          <Loader2 className="size-3.5 animate-spin" />
          Chargement…
        </p>
      ) : erreur ? (
        <p className="mt-2 text-[12.5px] text-red-500">{erreur}</p>
      ) : messages.length === 0 ? (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[12.5px] text-[var(--text-muted)]">
          <MailPlus className="size-3.5" />
          {connecte ? vide : "Connectez votre boîte Gmail pour voir les échanges ici."}
          {!connecte ? (
            <Link href="/parametres" className="text-brand-500 hover:underline dark:text-brand-300">
              Réglages
            </Link>
          ) : null}
        </p>
      ) : (
        <ol className="mt-2 space-y-1.5">
          {messages.map((message) => {
            const sortant = message.direction === "outbound";
            return (
              <li
                key={message.id}
                className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-base)]/50 px-3 py-2"
              >
                <div className="flex items-start gap-2">
                  <span
                    className={cn(
                      "mt-0.5 grid size-5 shrink-0 place-items-center rounded-md",
                      sortant
                        ? "bg-brand-500/15 text-brand-500 dark:text-brand-300"
                        : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
                    )}
                    title={sortant ? "Message envoyé" : "Message reçu"}
                  >
                    {sortant ? <ArrowUpRight className="size-3" /> : <ArrowDownLeft className="size-3" />}
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

      {!chargement && !erreur && messages.length > 0 ? (
        <p className="mt-2 text-[11px] text-[var(--text-muted)]">
          <Badge tone="stone">Lecture seule</Badge>{" "}
          <span className="align-middle">
            Objet, date et extrait uniquement — le corps reste dans Gmail.
            {note ? ` ${note}` : ""}
          </span>
        </p>
      ) : null}
    </section>
  );
}
