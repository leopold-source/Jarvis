"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send, Sparkles, Square, X } from "lucide-react";

import { Orb, type OrbeEtat } from "@/components/assistant/orb";
import { Button, Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useVoice } from "@/lib/use-voice";
import { demanderAssistant, type AssistantTurn } from "@/app/(crm)/assistant/actions";

/**
 * Le mode vocal.
 *
 * Une seule chose à l'écran : l'orbe. Tout le reste — la transcription, la
 * réponse, le clavier de secours — s'efface autour. C'est voulu : on ne
 * consulte pas cet écran, on lui parle.
 *
 * Le clavier n'est pas une concession, c'est un filet. La dictée n'existe que
 * sur Chrome et Edge, les micros se font refuser, et les environnements
 * bruyants existent. Sans champ de saisie, la fonctionnalité serait
 * inaccessible un jour sur deux.
 */
export function AssistantOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [etat, setEtat] = useState<OrbeEtat>("repos");
  const [reponse, setReponse] = useState("");
  const [historique, setHistorique] = useState<AssistantTurn[]>([]);
  const [saisie, setSaisie] = useState("");
  const [souci, setSouci] = useState<string | null>(null);
  const [cout, setCout] = useState(0);
  const occupe = useRef(false);

  const traiter = useCallback(async (phrase: string) => {
    if (occupe.current) return;
    occupe.current = true;
    setSouci(null);
    setEtat("reflexion");
    setReponse("");

    const resultat = await demanderAssistant(phrase, historique);
    occupe.current = false;

    if (!resultat.ok) {
      setSouci(resultat.error);
      setEtat("repos");
      return;
    }

    setReponse(resultat.texte);
    setCout((total) => total + resultat.cout_centimes);
    setHistorique((tours) => [
      ...tours.slice(-4),
      { role: "user", content: phrase },
      { role: "assistant", content: resultat.texte },
    ]);

    await direRef.current(resultat.texte);
    setEtat("repos");
    // `historique` est lu à l'appel ; le lister relancerait la fonction à
    // chaque échange et couperait la dictée en cours.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historique]);

  const voix = useVoice({ onPhrase: traiter, onEtat: setEtat });

  // La synthèse est appelée depuis `traiter`, qui est défini avant elle.
  const direRef = useRef(voix.dire);
  direRef.current = voix.dire;

  // Échap ferme, et coupe la parole en cours : rester coincé à écouter une
  // réponse qu'on ne veut plus entendre est le premier réflexe d'agacement.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        voix.taire();
        voix.arreterEcoute();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, voix]);

  useEffect(() => {
    if (!open) {
      voix.taire();
      voix.arreterEcoute();
    }
    // Fermer doit faire taire, sans dépendre de l'identité des fonctions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const message = souci ?? voix.erreur;
  const enCours = etat === "reflexion";

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[var(--surface-base)]/92 px-5 backdrop-blur-xl animate-fade-in">
      <button
        type="button"
        onClick={onClose}
        aria-label="Fermer"
        className="absolute top-5 right-5 rounded-full p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
      >
        <X className="size-5" />
      </button>

      <button
        type="button"
        onClick={() => (voix.ecoute ? voix.arreterEcoute() : voix.demarrerEcoute())}
        disabled={enCours}
        className="rounded-full transition-transform duration-200 hover:scale-[1.03] disabled:cursor-wait"
        aria-label={voix.ecoute ? "Arrêter l'écoute" : "Parler"}
      >
        <Orb etat={etat} amplitude={voix.amplitude} />
      </button>

      <p className="mt-7 min-h-6 text-center text-[13px] text-[var(--text-muted)]">
        {
          {
            repos: voix.supporte ? "Appuie sur l'orbe et parle" : "Écris ta question ci-dessous",
            ecoute: "Je t'écoute…",
            reflexion: "Je cherche…",
            parole: "",
          }[etat]
        }
      </p>

      {/* Ce qu'on a entendu, puis ce qu'on répond. Les deux ne cohabitent
          jamais : la transcription disparaît dès que la réponse arrive. */}
      <p className="mt-1 min-h-7 max-w-2xl text-center text-[15px] text-[var(--text-secondary)] italic">
        {etat === "ecoute" ? voix.transcription : ""}
      </p>

      {reponse && etat !== "ecoute" ? (
        <p className="mt-2 max-w-2xl text-center text-[17px] leading-relaxed animate-fade-up">
          {reponse}
        </p>
      ) : null}

      {message ? (
        <p className="mt-4 max-w-md rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-center text-[12.5px] text-amber-700 dark:text-amber-300">
          {message}
        </p>
      ) : null}

      {/* Saisie de secours. */}
      <form
        className="mt-8 flex w-full max-w-xl items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const texte = saisie.trim();
          if (!texte) return;
          setSaisie("");
          void traiter(texte);
        }}
      >
        <Input
          value={saisie}
          onChange={(event) => setSaisie(event.target.value)}
          placeholder="ou écris ta question…"
          disabled={enCours}
          className="flex-1"
        />
        <Button type="submit" variant="secondary" disabled={enCours || !saisie.trim()}>
          <Send className="size-4" />
        </Button>
        {voix.supporte ? (
          <Button
            type="button"
            variant={voix.ecoute ? "primary" : "ghost"}
            onClick={() => (voix.ecoute ? voix.arreterEcoute() : voix.demarrerEcoute())}
            disabled={enCours}
            aria-label={voix.ecoute ? "Arrêter l'écoute" : "Parler"}
          >
            {voix.ecoute ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          </Button>
        ) : null}
        {voix.parle ? (
          <Button type="button" variant="ghost" onClick={voix.taire} aria-label="Couper la voix">
            <Square className="size-4" />
          </Button>
        ) : null}
      </form>

      <div className="mt-5 flex flex-wrap justify-center gap-1.5">
        {[
          "Qu'est-ce que j'ai à faire aujourd'hui ?",
          "Où en est le pipeline ?",
          "Qui je dois rappeler ?",
          "Où en sont nos chantiers ?",
        ].map((exemple) => (
          <button
            key={exemple}
            type="button"
            disabled={enCours}
            onClick={() => void traiter(exemple)}
            className="rounded-full border border-[var(--border-subtle)] px-3 py-1 text-[11.5px] text-[var(--text-muted)] transition-colors hover:border-brand-500/50 hover:text-[var(--text-secondary)] disabled:opacity-40"
          >
            {exemple}
          </button>
        ))}
      </div>

      {cout > 0 ? (
        <p className="mt-4 text-[10.5px] text-[var(--text-muted)] tabular-nums">
          {cout.toFixed(2)} centime(s) sur cette session
        </p>
      ) : null}
    </div>
  );
}

/** Le bouton qui ouvre le mode vocal, présent sur tout le CRM. */
export function AssistantButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Parler à Antichaos"
        aria-label="Parler à Antichaos"
        className={cn(
          "fixed right-5 bottom-5 z-30 grid size-13 place-items-center rounded-full",
          "bg-linear-to-br from-brand-500 to-accent-500 text-white shadow-lg",
          "transition-transform duration-200 hover:scale-105 active:scale-95",
        )}
      >
        <Sparkles className="size-5" />
        <span
          aria-hidden
          className="absolute inset-0 -z-10 rounded-full bg-brand-500/40 blur-xl"
        />
      </button>

      <AssistantOverlay open={open} onClose={() => setOpen(false)} />
    </>
  );
}
