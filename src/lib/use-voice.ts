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
 * Ensuite l'amplitude, qui décide de la qualité de l'animation :
 *
 * - Quand l'utilisateur parle, on ouvre le micro et on lit le signal réel.
 *   L'orbe suit vraiment sa voix.
 * - Quand la synthèse parle, il n'y a aucun flux audio à analyser. On se rabat
 *   sur l'événement `boundary`, émis à chaque mot : l'orbe pulse au rythme réel
 *   des mots prononcés. C'est une approximation, mais une approximation
 *   corrélée à la parole — pas un mouvement décoratif.
 */

type Etat = "repos" | "ecoute" | "reflexion" | "parole";

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

  const demarrerEcoute = useCallback(async () => {
    const Constructeur = constructeurReconnaissance();
    if (!Constructeur) {
      setErreur("La dictée vocale n'existe pas dans ce navigateur. Chrome ou Edge la proposent.");
      return;
    }

    setErreur(null);
    setTranscription("");
    window.speechSynthesis?.cancel();
    await ouvrirMicro();

    const instance = new Constructeur();
    instance.lang = "fr-FR";
    instance.continuous = false;
    instance.interimResults = true;

    instance.onresult = (event) => {
      let phrase = "";
      let definitif = false;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        phrase += event.results[i][0].transcript;
        if (event.results[i].isFinal) definitif = true;
      }
      setTranscription(phrase);
      if (definitif && phrase.trim()) {
        arreterEcoute();
        phraseRef.current(phrase.trim());
      }
    };

    instance.onerror = (event) => {
      if (event.error !== "aborted" && event.error !== "no-speech") {
        setErreur("Je n'ai pas réussi à t'entendre.");
      }
      arreterEcoute();
    };

    instance.onend = () => {
      setEcoute(false);
      fermerMicro();
    };

    reco.current = instance;
    instance.start();
    setEcoute(true);
    onEtat?.("ecoute");
  }, [arreterEcoute, fermerMicro, onEtat, ouvrirMicro]);

  /* --- Parole ------------------------------------------------------------ */

  const taire = useCallback(() => {
    window.speechSynthesis?.cancel();
    if (pulse.current) clearTimeout(pulse.current);
    setParle(false);
    setAmplitude(0);
  }, []);

  const dire = useCallback(
    (texte: string) =>
      new Promise<void>((resoudre) => {
        if (typeof window === "undefined" || !window.speechSynthesis) return resoudre();

        window.speechSynthesis.cancel();
        const enonce = new SpeechSynthesisUtterance(texte);
        enonce.lang = "fr-FR";
        enonce.rate = 1.05;
        enonce.pitch = 1;

        // La meilleure voix française disponible, à défaut celle par défaut.
        const voix = window.speechSynthesis
          .getVoices()
          .filter((v) => v.lang.startsWith("fr"))
          .sort((a, b) => Number(b.localService) - Number(a.localService))[0];
        if (voix) enonce.voice = voix;

        enonce.onstart = () => {
          setParle(true);
          onEtat?.("parole");
        };

        // Un mot prononcé, une impulsion : l'orbe respire au rythme du débit
        // plutôt qu'au hasard. Faute de flux audio, c'est le signal le plus
        // proche de la parole que le navigateur nous donne.
        enonce.onboundary = () => {
          setAmplitude(0.55 + Math.random() * 0.35);
          if (pulse.current) clearTimeout(pulse.current);
          pulse.current = setTimeout(() => setAmplitude(0.2), 110);
        };

        const finir = () => {
          if (pulse.current) clearTimeout(pulse.current);
          setParle(false);
          setAmplitude(0);
          resoudre();
        };
        enonce.onend = finir;
        enonce.onerror = finir;

        window.speechSynthesis.speak(enonce);
      }),
    [onEtat],
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
    ecoute,
    parle,
    transcription,
    amplitude,
    erreur,
    demarrerEcoute,
    arreterEcoute,
    dire,
    taire,
  };
}
