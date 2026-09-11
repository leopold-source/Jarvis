"use client";

import { cn } from "@/lib/utils";

export type OrbeEtat = "repos" | "ecoute" | "reflexion" | "parole";

/**
 * L'orbe.
 *
 * Ce qui fait la qualité perçue n'est pas la beauté de la forme mais la
 * lisibilité des états : on doit savoir sans lire si l'assistant attend,
 * écoute, cherche ou parle. Chaque état a donc sa couleur, son rythme et sa
 * densité, et aucun ne ressemble à son voisin.
 *
 * `amplitude` vaut de 0 à 1. À l'écoute elle vient du micro et suit la voix
 * réellement ; à la parole elle suit le découpage en mots de la synthèse, qui
 * est le seul signal que le navigateur expose. Rien ici n'est décoratif : si
 * l'orbe bouge, c'est que quelque chose se passe.
 */
export function Orb({
  etat,
  amplitude = 0,
  taille = 208,
}: {
  etat: OrbeEtat;
  amplitude?: number;
  taille?: number;
}) {
  const niveau = Math.min(1, Math.max(0, amplitude));
  // L'échelle ne part jamais de zéro : un orbe qui s'effondre au silence
  // donnerait l'impression que l'application a décroché.
  const echelle = etat === "ecoute" || etat === "parole" ? 1 + niveau * 0.22 : 1;

  const teintes: Record<OrbeEtat, { de: string; vers: string; halo: string }> = {
    repos: { de: "#6366f1", vers: "#8b5cf6", halo: "rgba(99,102,241,0.35)" },
    ecoute: { de: "#06b6d4", vers: "#3b82f6", halo: "rgba(6,182,212,0.55)" },
    reflexion: { de: "#a855f7", vers: "#ec4899", halo: "rgba(168,85,247,0.5)" },
    parole: { de: "#10b981", vers: "#06b6d4", halo: "rgba(16,185,129,0.55)" },
  };
  const teinte = teintes[etat];

  return (
    <div
      className="relative grid place-items-center"
      style={{ width: taille, height: taille }}
      role="img"
      aria-label={
        {
          repos: "Assistant en veille",
          ecoute: "Assistant à l'écoute",
          reflexion: "Assistant en recherche",
          parole: "Assistant en train de parler",
        }[etat]
      }
    >
      {/* Halo diffus : il donne la couleur de l'état au reste de l'écran. */}
      <span
        aria-hidden
        className="absolute inset-0 rounded-full blur-3xl transition-all duration-500"
        style={{
          background: teinte.halo,
          transform: `scale(${0.9 + niveau * 0.5})`,
          opacity: etat === "repos" ? 0.4 : 0.75,
        }}
      />

      {/* Anneaux : au repos ils respirent lentement ; en écoute ils s'écartent
          au rythme de la voix ; en recherche ils tournent. */}
      {[0, 1, 2].map((rang) => (
        <span
          key={rang}
          aria-hidden
          className={cn(
            "absolute rounded-full border transition-all",
            etat === "reflexion" ? "animate-spin" : "animate-[pulse_2.8s_ease-in-out_infinite]",
          )}
          style={{
            inset: 6 + rang * 14,
            borderColor: teinte.de,
            borderWidth: etat === "reflexion" && rang === 1 ? 2 : 1,
            borderStyle: etat === "reflexion" && rang === 1 ? "dashed" : "solid",
            opacity: 0.3 - rang * 0.07 + niveau * 0.3,
            transform: `scale(${1 + niveau * (0.06 + rang * 0.05)})`,
            animationDuration: etat === "reflexion" ? `${5 + rang * 3}s` : `${2.4 + rang * 0.6}s`,
            animationDirection: rang % 2 ? "reverse" : "normal",
            transitionDuration: "120ms",
          }}
        />
      ))}

      {/* Le cœur. Le dégradé tourne lentement pour que la sphère ne paraisse
          jamais figée, même quand personne ne parle. */}
      <span
        aria-hidden
        className="relative rounded-full transition-transform duration-100 ease-out"
        style={{
          width: taille * 0.52,
          height: taille * 0.52,
          transform: `scale(${echelle})`,
          background: `radial-gradient(circle at 32% 28%, ${teinte.de}, ${teinte.vers} 62%, ${teinte.vers}00 100%)`,
          boxShadow: `0 0 ${28 + niveau * 60}px ${teinte.halo}, inset 0 0 ${taille * 0.18}px rgba(255,255,255,0.28)`,
        }}
      >
        <span
          aria-hidden
          className="absolute inset-0 rounded-full opacity-60 mix-blend-screen animate-[spin_9s_linear_infinite]"
          style={{
            background: `conic-gradient(from 0deg, transparent, ${teinte.de}88, transparent 58%)`,
          }}
        />
      </span>
    </div>
  );
}
