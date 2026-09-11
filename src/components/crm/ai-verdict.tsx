"use client";

import { useState, useTransition } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";

import { Input, useToast } from "@/components/ui";
import type { AiKind } from "@/lib/database.types";
import { cn } from "@/lib/utils";
import { juger } from "@/app/(crm)/ia/feedback-actions";

/**
 * Deux pouces, discrets, à côté de ce que l'IA vient de produire.
 *
 * Placés là plutôt que dans un écran de réglages : un jugement porté à chaud,
 * devant la proposition, vaut infiniment mieux qu'un questionnaire rempli une
 * semaine plus tard. Le champ de raison n'apparaît qu'après un pouce vers le
 * bas — c'est le seul moment où l'on a vraiment quelque chose à dire.
 */
export function AiVerdict({
  kind,
  refId,
  className,
}: {
  kind: AiKind;
  refId: string | null;
  className?: string;
}) {
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [verdict, setVerdict] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  const [demandeRaison, setDemandeRaison] = useState(false);

  async function envoyer(utile: boolean, raison?: string) {
    setVerdict(utile);
    const resultat = await juger(kind, refId, utile, raison);
    if (!resultat.ok) {
      setVerdict(null);
      return toast(resultat.error, "error");
    }
    startTransition(() => {});
  }

  return (
    <span className={cn("flex flex-wrap items-center gap-1", className)}>
      <button
        type="button"
        title="Utile"
        aria-label="Utile"
        onClick={() => {
          setDemandeRaison(false);
          void envoyer(true);
        }}
        className={cn(
          "rounded-md p-1 transition-colors",
          verdict === true
            ? "bg-emerald-500/15 text-emerald-500"
            : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-emerald-500",
        )}
      >
        <ThumbsUp className="size-3.5" />
      </button>

      <button
        type="button"
        title="À côté de la plaque"
        aria-label="Pas utile"
        onClick={() => {
          setDemandeRaison(true);
          void envoyer(false);
        }}
        className={cn(
          "rounded-md p-1 transition-colors",
          verdict === false
            ? "bg-rose-500/15 text-rose-500"
            : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-rose-500",
        )}
      >
        <ThumbsDown className="size-3.5" />
      </button>

      {demandeRaison && verdict === false ? (
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => {
            if (!note.trim()) return;
            void envoyer(false, note);
            setDemandeRaison(false);
            toast("Noté.");
          }}
          placeholder="Pourquoi ? (facultatif)"
          className="h-7 w-52 text-[11.5px]"
          autoFocus
        />
      ) : null}
    </span>
  );
}
