"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AudioLines, Check, Mic, MicOff, Send, Sparkles, Square, X } from "lucide-react";

import { Orb, type OrbeEtat } from "@/components/assistant/orb";
import { Button, Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useVoice } from "@/lib/use-voice";
import { demanderAssistant, type AssistantTurn } from "@/app/(crm)/assistant/actions";
import { executerAction, type ActionProposee } from "@/app/(crm)/assistant/ecriture";

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
  const router = useRouter();
  const [etat, setEtat] = useState<OrbeEtat>("repos");
  const [reponse, setReponse] = useState("");
  const [historique, setHistorique] = useState<AssistantTurn[]>([]);
  const [saisie, setSaisie] = useState("");
  const [souci, setSouci] = useState<string | null>(null);
  const [cout, setCout] = useState(0);
  const [action, setAction] = useState<ActionProposee | null>(null);
  const [applique, setApplique] = useState(false);
  const occupe = useRef(false);

  /*
    L'accord ou le refus se reconnaissent sur place.

    Renvoyer « oui » au modèle pour qu'il le comprenne coûterait un appel
    complet là où une comparaison de chaînes suffit. La validation est donc
    gratuite, et surtout instantanée — ce qui compte quand on parle.
  */
  const OUI = /^(oui|ouais|ok|okay|d'accord|daccord|vas[- ]y|valide|confirme|c'est bon|parfait|go)\b/i;
  const NON = /^(non|nan|annule|laisse|surtout pas|pas maintenant|stop)\b/i;

  /*
    « Oui mais attends, c'est quel Verdi ? » commence par oui et n'en est pas un.

    L'asymétrie commande la sévérité : un refus mal compris ne fait rien, un
    accord mal compris écrit en base. Toute marque d'hésitation, et toute
    question, annulent donc l'accord — la phrase repart alors vers le modèle,
    qui saura quoi en faire.
  */
  const HESITE = /\b(mais|attends?|par contre|sauf|plut[oô]t|enfin|quel|quelle)\b|\?/i;
  const estAccord = (phrase: string) => OUI.test(phrase) && !HESITE.test(phrase);

  const valider = useCallback(async (proposee: ActionProposee) => {
    setEtat("reflexion");

    let resultat;
    try {
      resultat = await executerAction(proposee);
    } catch {
      setSouci("L'action n'a pas abouti. Vérifie ta connexion et réessaie.");
      setEtat("repos");
      return;
    }

    setAction(null);

    if (!resultat.ok) {
      setSouci(resultat.error);
      setEtat("repos");
      return;
    }
    setApplique(true);
    setReponse(resultat.message);
    await direRef.current(resultat.message).catch(() => {});
    setEtat("repos");
    routerRef.current.refresh();
  }, []);

  const traiter = useCallback(async (phrase: string) => {
    if (occupe.current) return;

    // Une proposition attend : « oui » l'exécute, « non » l'écarte. Ni l'un ni
    // l'autre ne repasse par le modèle.
    if (action) {
      if (estAccord(phrase.trim())) return void valider(action);
      if (NON.test(phrase.trim())) {
        setAction(null);
        setReponse("D'accord, je ne touche à rien.");
        void direRef.current("D'accord, je ne touche à rien.");
        return;
      }
      // Autre chose : la proposition tombe, la phrase redevient une question.
      setAction(null);
    }

    occupe.current = true;
    setSouci(null);
    setEtat("reflexion");
    setReponse("");
    setApplique(false);

    /*
      Un appel qui échoue doit rendre la main, toujours.

      Sans ce `finally`, un refus de la requête — une connexion mobile qui
      décroche, l'application mise en arrière-plan — laissait deux verrous
      fermés : `occupe` restait vrai, donc plus rien n'était traité, et l'état
      restait « réflexion », or c'est cet état qui désactive l'orbe. L'assistant
      devenait alors entièrement muet et inerte, sans un mot d'explication, et
      seul un rechargement de la page le débloquait. Sur un téléphone, où la
      connexion tombe pour un rien, c'est la panne qu'on rencontre en premier.
    */
    let resultat;
    try {
      resultat = await demanderAssistant(phrase, historique);
    } catch {
      setSouci("La demande n'a pas abouti. Vérifie ta connexion et réessaie.");
      setEtat("repos");
      return;
    } finally {
      occupe.current = false;
    }

    if (!resultat.ok) {
      setSouci(resultat.error);
      setEtat("repos");
      return;
    }

    setReponse(resultat.texte);
    setAction(resultat.action ?? null);
    setCout((total) => total + resultat.cout_centimes);
    setHistorique((tours) => [
      ...tours.slice(-4),
      { role: "user", content: phrase },
      { role: "assistant", content: resultat.texte },
    ]);

    // Une synthèse qui échoue ne doit pas geler l'état non plus.
    await direRef.current(resultat.texte).catch(() => {});
    setEtat("repos");

    /*
      Rendre la parole quand elle est attendue.

      Une question posée ou une validation demandée appellent une réponse : se
      taire et attendre un clic casserait la conversation. On ne relance
      l'écoute que dans ces deux cas — le faire systématiquement ferait tourner
      le micro pour rien.
    */
    const attendUneReponse =
      Boolean(resultat.action) || /\?\s*$/.test(resultat.texte.trim());
    if (attendUneReponse && ecouteRef.current.supporte) {
      void ecouteRef.current.demarrer();
    }
    // `historique` est lu à l'appel ; le lister relancerait la fonction à
    // chaque échange et couperait la dictée en cours.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historique, action, valider]);

  const voix = useVoice({ onPhrase: traiter, onEtat: setEtat });

  // La synthèse et l'écoute sont appelées depuis `traiter`, défini avant elles.
  const direRef = useRef(voix.dire);
  direRef.current = voix.dire;
  const ecouteRef = useRef({ supporte: voix.supporte, demarrer: voix.demarrerEcoute });
  ecouteRef.current = { supporte: voix.supporte, demarrer: voix.demarrerEcoute };
  const routerRef = useRef(router);
  routerRef.current = router;

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
    /*
      Centré tant que ça tient, défilant dès que ça déborde.

      Un `justify-center` seul rogne le haut du contenu au lieu de le rendre
      atteignable : sur un téléphone, l'orbe, la réponse et la proposition
      d'action dépassent vite la hauteur utile, et le clavier logiciel en
      reprend encore la moitié. Le conteneur défile donc, et c'est la colonne
      intérieure qui se centre quand elle en a la place.
    */
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-[var(--surface-base)]/92 backdrop-blur-xl animate-fade-in">
      <button
        type="button"
        onClick={onClose}
        aria-label="Fermer"
        className="absolute top-[calc(1rem+env(safe-area-inset-top))] right-4 z-10 grid size-10 place-items-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] sm:top-5 sm:right-5"
      >
        <X className="size-5" />
      </button>

      <div className="flex min-h-full flex-col items-center justify-center px-5 py-16 pb-[calc(4rem+env(safe-area-inset-bottom))]">

      {/*
        L'orbe reste touchable pendant la recherche, et l'appui annule.

        Elle était désactivée dans cet état, ce qui paraissait juste — on
        n'interrompt pas une requête en cours. Mais un bouton désactivé ne dit
        rien quand on appuie dessus, et c'est le seul de l'écran : le jour où
        l'état restait bloqué, l'assistant devenait une image. Une sortie qui
        existe toujours vaut mieux qu'un verrou qu'on croit sûr.
      */}
      <button
        type="button"
        onClick={() => {
          if (enCours) {
            occupe.current = false;
            setEtat("repos");
            setSouci("Recherche annulée.");
            return;
          }
          return voix.ecoute ? voix.arreterEcoute() : voix.demarrerEcoute();
        }}
        className="rounded-full transition-transform duration-200 hover:scale-[1.03]"
        aria-label={enCours ? "Annuler la recherche" : voix.ecoute ? "Arrêter l'écoute" : "Parler"}
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

      {/*
        La proposition, écrite noir sur blanc.

        Elle est lue à voix haute, mais un « oui » se donne sur ce qu'on voit :
        entendre « Verdi » et lire « Verdi Nord de France » n'est pas la même
        chose, et c'est exactement là que se logent les erreurs qu'on ne
        rattrape pas.
      */}
      {action ? (
        <div className="mt-5 w-full max-w-xl animate-fade-up rounded-2xl border border-brand-500/35 bg-brand-500/8 p-4">
          <p className="text-[13.5px] leading-relaxed">{action.resume}</p>
          <p className="mt-1 text-[11.5px] text-[var(--text-muted)]">
            Rien n&apos;est encore modifié. Dis « oui » ou appuie.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => void valider(action)}>
              <Check className="size-3.5" />
              Valider
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAction(null);
                setReponse("D'accord, je ne touche à rien.");
              }}
            >
              Laisser tomber
            </Button>
          </div>
        </div>
      ) : null}

      {applique ? (
        <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-emerald-600 dark:text-emerald-400">
          <Check className="size-3.5" />
          Enregistré.
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

      {/* Choix de la voix. Les navigateurs en proposent plusieurs, de qualité
          très inégale : la meilleure ne se devine pas, elle s'écoute. */}
      {voix.voixDisponibles.length > 1 ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <AudioLines className="size-3.5 text-[var(--text-muted)]" />
          <select
            value={voix.voixChoisie ?? ""}
            onChange={(event) => {
              voix.choisirVoix(event.target.value);
              // Un essai immédiat : c'est le seul moyen de comparer.
              window.setTimeout(() => void voix.dire("Salut, c'est moi. Ça te va, cette voix ?"), 60);
            }}
            className="rounded-full border border-[var(--border-subtle)] bg-transparent px-2.5 py-1 text-[11.5px] text-[var(--text-muted)] outline-none"
            aria-label="Choisir la voix"
          >
            {voix.voixDisponibles.map((disponible) => (
              <option key={disponible.name} value={disponible.name}>
                {disponible.name.replace(/\s*\(.*\)$/, "")}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap justify-center gap-1.5">
        {[
          "Fais-moi le point",
          "J'ai quoi cet après-midi ?",
          "Qui je dois rappeler ?",
          "Où en est BM2S ?",
        ].map((exemple) => (
          <button
            key={exemple}
            type="button"
            disabled={enCours}
            onClick={() => void traiter(exemple)}
            className="rounded-full border border-[var(--border-subtle)] px-3 py-2 text-[12px] text-[var(--text-muted)] transition-colors hover:border-brand-500/50 hover:text-[var(--text-secondary)] disabled:opacity-40 sm:py-1 sm:text-[11.5px]"
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
          // Au-dessus de la barre d'onglets sur téléphone : posé à 5 unités du
          // bas, le bouton recouvrait « Affaires » et « Plus ».
          "fixed right-4 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 sm:right-5 lg:bottom-5",
          "grid size-13 place-items-center rounded-full",
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
