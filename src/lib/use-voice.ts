"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Écoute et parole, côté navigateur.
 *
 * Ni l'une ni l'autre ne viennent d'Anthropic : l'API Claude n'a pas
 * d'endpoint audio. On s'appuie donc sur le navigateur, ce qui a deux
 * conséquences qu'il vaut mieux connaître que découvrir.
 *
 * D'abord la disponibilité : la reconnaissance vocale est une API préfixée,
 * présente sur Chrome et Edge, absente ailleurs. Tout est donc derrière un
 * `supporte` que l'interface doit respecter.
 *
 * Ensuite l'amplitude, qui décide de la qualité de l'animation. Aucune source
 * ne sert partout, et le choix a des conséquences :
 *
 * - Sur ordinateur, on ouvre un second flux micro et on lit le signal réel.
 *   L'orbe suit vraiment la voix.
 * - Sur téléphone, non : le micro n'y appartient qu'à un seul client, et le
 *   prendre pour l'animer revient à le retirer à la dictée. Les mots reconnus
 *   font alors battre l'orbe à leur arrivée.
 * - Quand la synthèse parle, il n'y a aucun flux audio à analyser. On se rabat
 *   sur l'événement `boundary`, émis à chaque mot : l'orbe pulse au rythme réel
 *   des mots prononcés.
 *
 * Les trois sont des approximations de la même chose, toutes corrélées à la
 * parole — jamais un mouvement décoratif.
 */

type Etat = "repos" | "ecoute" | "reflexion" | "parole";

const VOIX_STORAGE_KEY = "antichaos.assistant.voix";

type Reconnaissance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionLikeEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionLikeEvent = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};

function constructeurReconnaissance(): (new () => Reconnaissance) | null {
  if (typeof window === "undefined") return null;
  const global = window as unknown as {
    SpeechRecognition?: new () => Reconnaissance;
    webkitSpeechRecognition?: new () => Reconnaissance;
  };
  return global.SpeechRecognition ?? global.webkitSpeechRecognition ?? null;
}

/**
 * Le micro est-il réellement accordé à ce site ?
 *
 * `not-allowed` ne dit pas *ce* qui a été refusé. Le micro peut être parfait et
 * la dictée refusée quand même — c'est le cas sur iPhone hors de Safari, où
 * Apple n'ouvre pas la reconnaissance vocale aux navigateurs tiers. Envoyer
 * alors quelqu'un vérifier une autorisation déjà correcte lui fait perdre son
 * temps et lui laisse croire que la faute vient de chez lui.
 *
 * Ouvrir puis refermer un flux tranche la question en une seconde. On mesure
 * au lieu de deviner, et le message qui suit peut être affirmatif.
 */
async function micAutorise(): Promise<boolean> {
  try {
    const flux = await navigator.mediaDevices.getUserMedia({ audio: true });
    flux.getTracks().forEach((piste) => piste.stop());
    return true;
  } catch {
    return false;
  }
}

/**
 * Vrai sur un navigateur tiers d'iPhone, où la dictée ne peut pas fonctionner.
 *
 * Chrome, Firefox et Edge sur iOS sont des habillages de WebKit : l'API de
 * dictée y existe, elle répond, et elle répond toujours non — Apple la réserve
 * à Safari. Aucun réglage n'y changera rien, et c'est précisément ce qu'il faut
 * dire plutôt que de laisser chercher.
 *
 * Reconnaître l'agent utilisateur ne sert ici qu'à formuler une phrase, jamais
 * à décider d'un comportement : se tromper ne coûte qu'un conseil inutile.
 */
function navigateurTiersSurIphone(): boolean {
  if (typeof navigator === "undefined") return false;
  return /\b(CriOS|FxiOS|EdgiOS|OPiOS|GSA)\//.test(navigator.userAgent);
}

/**
 * Vrai là où un second client peut lire le micro pendant la dictée.
 *
 * Il n'existe pas de test de capacité pour cela, et renifler l'agent
 * utilisateur vieillit mal. La présence d'un pointeur fin est le meilleur
 * substitut disponible : elle désigne un ordinateur, où les deux cohabitent,
 * et exclut téléphones et tablettes, où le micro appartient à un seul.
 *
 * Se tromper ne coûte qu'une orbe moins vivante, jamais une dictée muette.
 */
function micPartageable(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(pointer: fine)").matches;
}

export function useVoice({
  onPhrase,
  onEtat,
}: {
  onPhrase: (phrase: string) => void;
  onEtat?: (etat: Etat) => void;
}) {
  const [supporte, setSupporte] = useState(false);
  const [ecoute, setEcoute] = useState(false);
  const [parle, setParle] = useState(false);
  const [transcription, setTranscription] = useState("");
  const [amplitude, setAmplitude] = useState(0);
  const [erreur, setErreur] = useState<string | null>(null);
  /*
    La dictée a été refusée par le système, pas par l'utilisateur.

    Distinct de `supporte` : l'API existe, elle répond, et elle répond non.
    C'est le cas des navigateurs tiers sur iPhone, d'une application ajoutée à
    l'écran d'accueil, ou d'une dictée système éteinte — trois situations où
    réessayer ne servira jamais à rien. L'écran doit alors cesser de proposer
    l'orbe et passer la main à l'écrit, plutôt que d'inviter à un geste dont on
    sait déjà qu'il échouera.
  */
  const [dicteeHorsService, setDicteeHorsService] = useState(false);

  const reco = useRef<Reconnaissance | null>(null);
  const audio = useRef<{ ctx: AudioContext; flux: MediaStream; analyse: AnalyserNode } | null>(null);
  const boucle = useRef<number | null>(null);
  const pulse = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Le rappel change à chaque rendu ; le garder dans une référence évite de
  // reconstruire la reconnaissance vocale, qui coupe l'écoute en cours.
  const phraseRef = useRef(onPhrase);
  phraseRef.current = onPhrase;

  useEffect(() => {
    setSupporte(Boolean(constructeurReconnaissance()) && typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  /* --- Amplitude réelle du micro ---------------------------------------- */

  const fermerMicro = useCallback(() => {
    if (boucle.current !== null) cancelAnimationFrame(boucle.current);
    boucle.current = null;
    audio.current?.flux.getTracks().forEach((piste) => piste.stop());
    void audio.current?.ctx.close().catch(() => {});
    audio.current = null;
    setAmplitude(0);
  }, []);

  const ouvrirMicro = useCallback(async () => {
    if (audio.current) return;
    try {
      const flux = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const analyse = ctx.createAnalyser();
      analyse.fftSize = 512;
      ctx.createMediaStreamSource(flux).connect(analyse);
      audio.current = { ctx, flux, analyse };

      const donnees = new Uint8Array(analyse.frequencyBinCount);
      const lire = () => {
        analyse.getByteTimeDomainData(donnees);
        // Valeur efficace du signal : la moyenne quadratique de l'écart au
        // silence. Plus stable à l'œil qu'un pic, qui ferait sauter l'orbe.
        let somme = 0;
        for (const valeur of donnees) {
          const ecart = (valeur - 128) / 128;
          somme += ecart * ecart;
        }
        const rms = Math.sqrt(somme / donnees.length);
        setAmplitude(Math.min(1, rms * 4));
        boucle.current = requestAnimationFrame(lire);
      };
      lire();
    } catch {
      // Micro refusé : la dictée ne marchera pas, l'orbe reste au repos.
      setErreur("Micro refusé. Autorise-le dans la barre d'adresse.");
    }
  }, []);

  /* --- Écoute ------------------------------------------------------------ */

  const arreterEcoute = useCallback(() => {
    reco.current?.stop();
    reco.current = null;
    setEcoute(false);
    fermerMicro();
  }, [fermerMicro]);

  /*
    La reconnaissance démarre en premier, et sans `await` avant elle.

    Deux défauts se cachaient dans l'ordre des deux lignes, et tous deux
    donnaient le même symptôme sur téléphone : l'orbe s'allume, le micro
    s'ouvre, et rien n'est jamais reconnu.

    Le premier est l'exclusivité du micro. Ouvrir un flux `getUserMedia` pour
    mesurer l'amplitude prend le microphone ; sur iOS, la reconnaissance n'en
    obtient alors plus rien. L'animation marchait donc parfaitement — c'est
    elle qui tenait le micro — pendant que la dictée écoutait le silence.

    Le second est le geste utilisateur. `await` rend la main au navigateur, et
    ce qui suit n'appartient plus au clic : Safari refuse d'y démarrer une
    dictée. Deux causes indépendantes, un seul remède — appeler `start()` tout
    de suite, dans le geste, et ne rien ouvrir d'autre avant.
  */
  const demarrerEcoute = useCallback(async () => {
    const Constructeur = constructeurReconnaissance();
    if (!Constructeur) {
      setErreur("La dictée vocale n'existe pas dans ce navigateur. Chrome ou Edge la proposent.");
      return;
    }

    setErreur(null);
    setTranscription("");
    window.speechSynthesis?.cancel();

    const instance = new Constructeur();
    instance.lang = "fr-FR";
    instance.continuous = false;
    instance.interimResults = true;

    let entendu = false;

    instance.onresult = (event) => {
      let phrase = "";
      let definitif = false;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        phrase += event.results[i][0].transcript;
        if (event.results[i].isFinal) definitif = true;
      }
      entendu = true;
      setTranscription(phrase);
      // Faute de flux audio à analyser, les mots qui arrivent font battre
      // l'orbe : plus grossier que l'amplitude réelle, mais vraiment corrélé
      // à la parole — et ça marche là où le micro n'est pas partageable.
      if (!audio.current) {
        setAmplitude(0.45 + Math.random() * 0.4);
        if (pulse.current) clearTimeout(pulse.current);
        pulse.current = setTimeout(() => setAmplitude(0.15), 160);
      }
      if (definitif && phrase.trim()) {
        arreterEcoute();
        phraseRef.current(phrase.trim());
      }
    };

    instance.onerror = (event) => {
      if (event.error === "not-allowed") {
        setDicteeHorsService(true);
        setErreur("Dictée refusée (not-allowed). Je vérifie le micro…");
        // La réponse arrive en une seconde : on la préfère à une hypothèse.
        void micAutorise().then((ok) => {
          if (!ok) {
            setErreur(
              "Le micro est refusé pour ce site (not-allowed). Autorise-le dans les " +
                "réglages du navigateur, puis recharge la page.",
            );
          } else if (navigateurTiersSurIphone()) {
            setErreur(
              "Le micro est bien autorisé : c'est la dictée qui est refusée. Sur iPhone, " +
                "seul Safari sait dicter — Chrome, Firefox et Edge y sont des habillages " +
                "de Safari sans cette permission. Ouvre le site dans Safari, ou écris-moi " +
                "ta question ici.",
            );
          } else {
            setErreur(
              "Le micro est bien autorisé, c'est la dictée du navigateur qui refuse " +
                "(not-allowed). Elle ne fonctionne pas depuis une application ajoutée à " +
                "l'écran d'accueil, ni dans une fenêtre privée. Écris-moi ta question en " +
                "attendant.",
            );
          }
        });
      } else if (event.error === "service-not-allowed") {
        /*
          Distinct du refus de micro, et le confondre coûte un quart d'heure.

          Sur iPhone, la dictée du navigateur passe par le service de Siri :
          si « Activer la dictée » est éteint dans les réglages du clavier, le
          micro est bel et bien autorisé, la reconnaissance démarre — et
          n'entend jamais rien. Le réglage à toucher n'est pas dans le
          navigateur.
        */
        setDicteeHorsService(true);
        setErreur(
          "Le service de dictée n'est pas disponible (service-not-allowed). Sur iPhone : " +
            "Réglages › Général › Clavier › Activer la dictée, et ouvre le site dans Safari. " +
            "Écris-moi ta question en attendant.",
        );
      } else if (event.error === "no-speech") {
        // Le dire plutôt que de le taire : sans message, on ne sait pas si
        // c'est le micro, le réseau ou soi qui n'a pas parlé assez fort.
        setErreur("Je n'ai rien entendu. Réessaie en parlant juste après avoir touché l'orbe.");
      } else if (event.error !== "aborted") {
        // Le code brut entre parenthèses : il ne gêne personne et il est la
        // seule chose qui permette de trancher à distance entre un micro, un
        // réseau et un service de dictée.
        setErreur(`Je n'ai pas réussi à t'entendre. (${event.error})`);
      }
      arreterEcoute();
    };

    instance.onend = () => {
      setEcoute(false);
      fermerMicro();
      if (!entendu) {
        setErreur((actuelle) =>
          actuelle ?? "Je n'ai rien entendu. Vérifie que le micro est autorisé pour ce site.",
        );
      }
    };

    reco.current = instance;
    try {
      instance.start();
    } catch {
      // Une instance déjà démarrée lève plutôt que d'ignorer : deux appuis
      // rapprochés sur l'orbe ne doivent pas casser l'écoute en cours.
      return;
    }
    setEcoute(true);
    onEtat?.("ecoute");

    // L'amplitude réelle, seulement là où le micro se partage. Elle est plus
    // belle, elle n'est pas indispensable, et sur téléphone elle empêche la
    // dictée de fonctionner : l'ordre des priorités ne se discute pas.
    if (micPartageable()) void ouvrirMicro();
  }, [arreterEcoute, fermerMicro, onEtat, ouvrirMicro]);

  /* --- Parole ------------------------------------------------------------ */

  const taire = useCallback(() => {
    window.speechSynthesis?.cancel();
    if (pulse.current) clearTimeout(pulse.current);
    setParle(false);
    setAmplitude(0);
  }, []);

  /*
    Choix de la voix.

    Le premier jet préférait les voix locales — c'était l'erreur : ce sont
    justement les plus robotiques. Les voix réseau de Google et les voix
    « Premium » ou « Enhanced » d'Apple sont d'une tout autre qualité, et
    gratuites ; elles sont simplement plus loin dans la liste que le navigateur
    renvoie, et la première venue est presque toujours la moins bonne.

    On classe donc explicitement, et on retient le choix : c'est une préférence
    d'oreille, pas une décision à reprendre chaque matin.
  */
  const classerVoix = useCallback((voix: SpeechSynthesisVoice[]) => {
    const note = (v: SpeechSynthesisVoice) => {
      const nom = v.name.toLowerCase();
      // Les voix « Natural » de Microsoft sont des voix neuronales servies en
      // ligne : de loin les meilleures du lot gratuit, et disponibles sur Edge
      // sous Windows. Elles passent donc devant tout le reste.
      if (nom.includes("natural")) return 7;
      if (nom.includes("online")) return 6;
      if (nom.includes("google")) return 5;
      if (nom.includes("premium") || nom.includes("enhanced")) return 4;
      if (nom.includes("siri")) return 4;
      // Les voix « compact » d'Apple sont les plus métalliques du lot.
      if (nom.includes("compact")) return 0;
      return v.localService ? 1 : 3;
    };
    return [...voix]
      .filter((v) => v.lang.toLowerCase().startsWith("fr"))
      .sort((a, b) => note(b) - note(a));
  }, []);

  const [voixDisponibles, setVoixDisponibles] = useState<SpeechSynthesisVoice[]>([]);
  const [voixChoisie, setVoixChoisie] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    // La liste arrive de façon asynchrone sur Chrome : elle est vide au premier
    // appel, d'où l'écoute de `voiceschanged` en plus de la lecture directe.
    const charger = () => {
      const triees = classerVoix(window.speechSynthesis.getVoices());
      if (triees.length === 0) return;
      setVoixDisponibles(triees);
      setVoixChoisie((actuelle) => {
        if (actuelle && triees.some((v) => v.name === actuelle)) return actuelle;
        const retenue = window.localStorage.getItem(VOIX_STORAGE_KEY);
        if (retenue && triees.some((v) => v.name === retenue)) return retenue;
        return triees[0].name;
      });
    };

    charger();
    window.speechSynthesis.addEventListener("voiceschanged", charger);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", charger);
  }, [classerVoix]);

  const choisirVoix = useCallback((nom: string) => {
    setVoixChoisie(nom);
    window.localStorage.setItem(VOIX_STORAGE_KEY, nom);
  }, []);

  const dire = useCallback(
    (texte: string) =>
      new Promise<void>((resoudre) => {
        if (typeof window === "undefined" || !window.speechSynthesis) return resoudre();

        window.speechSynthesis.cancel();

        const voix = window.speechSynthesis
          .getVoices()
          .find((v) => v.name === voixChoisie) ?? classerVoix(window.speechSynthesis.getVoices())[0];

        /*
          Découpage en phrases, pour deux raisons.

          La première est un défaut connu de Chrome : au-delà d'une quinzaine de
          secondes, une énonciation est coupée net, sans erreur. La seconde est
          d'oreille — une suite de phrases courtes respire, là où un bloc unique
          est débité d'un trait.
        */
        const phrases = texte
          .split(/(?<=[.!?…])\s+/)
          .map((phrase) => phrase.trim())
          .filter(Boolean);
        if (phrases.length === 0) return resoudre();

        setParle(true);
        onEtat?.("parole");

        let index = 0;
        const enoncerSuivante = () => {
          if (index >= phrases.length) {
            if (pulse.current) clearTimeout(pulse.current);
            setParle(false);
            setAmplitude(0);
            return resoudre();
          }

          const enonce = new SpeechSynthesisUtterance(phrases[index]);
          index += 1;
          enonce.lang = "fr-FR";
          // Légèrement en dessous de la vitesse par défaut : les voix de
          // synthèse françaises avalent les liaisons quand on les presse.
          enonce.rate = 0.98;
          enonce.pitch = 1.02;
          if (voix) enonce.voice = voix;

          // Un mot prononcé, une impulsion : l'orbe respire au rythme du débit
          // plutôt qu'au hasard. Faute de flux audio, c'est le signal le plus
          // proche de la parole que le navigateur nous donne.
          enonce.onboundary = () => {
            setAmplitude(0.55 + Math.random() * 0.35);
            if (pulse.current) clearTimeout(pulse.current);
            pulse.current = setTimeout(() => setAmplitude(0.2), 110);
          };

          enonce.onend = enoncerSuivante;
          // Une phrase qui échoue ne doit pas emporter les suivantes.
          enonce.onerror = enoncerSuivante;

          window.speechSynthesis.speak(enonce);
        };

        enoncerSuivante();
      }),
    [classerVoix, onEtat, voixChoisie],
  );

  useEffect(() => {
    return () => {
      reco.current?.abort();
      window.speechSynthesis?.cancel();
      if (boucle.current !== null) cancelAnimationFrame(boucle.current);
      if (pulse.current) clearTimeout(pulse.current);
      audio.current?.flux.getTracks().forEach((piste) => piste.stop());
    };
  }, []);

  return {
    supporte,
    dicteeHorsService,
    ecoute,
    parle,
    transcription,
    amplitude,
    erreur,
    demarrerEcoute,
    arreterEcoute,
    dire,
    taire,
    voixDisponibles,
    voixChoisie,
    choisirVoix,
  };
}
