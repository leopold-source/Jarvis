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
/**
 * Assombrit une couleur hexadécimale d'un facteur donné.
 *
 * Le volume d'une sphère tient à l'écart entre sa face éclairée et sa face
 * d'ombre. Plutôt que d'inventer une seconde teinte à la main pour chaque
 * état — quatre états, donc quatre teintes à tenir cohérentes — on dérive
 * l'ombre de la couleur qu'on a déjà.
 */
function assombrir(hex: string, facteur: number): string {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  const composante = (decalage: number) =>
    Math.round(((n >> decalage) & 255) * (1 - facteur));
  return `rgb(${composante(16)}, ${composante(8)}, ${composante(0)})`;
}

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
    /*
      `role="img"` a été retiré, et ce n'est pas cosmétique.

      iOS traite ce qu'il croit être une image comme une image : un appui
      maintenu fait apparaître le rectangle de sélection bleu et le menu
      « copier / partager », par-dessus l'orbe. Or ce n'est pas une image mais
      la surface d'un bouton, et ce bouton porte déjà le libellé accessible qui
      dit ce qui se passe. L'annoncer deux fois nuisait aux deux.
    */
    <div
      aria-hidden
      className="relative grid touch-manipulation place-items-center select-none"
      style={{ width: taille, height: taille }}
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

      {/*
        Le cœur, monté comme une sphère et non comme un disque.

        Une seule teinte à plat se lit comme une pastille. Ce qui donne le
        volume, ce sont quatre couches qui disent chacune où se trouve la
        lumière : le corps sombre par en bas, l'éclairement diffus en haut à
        gauche, la lumière rasante qui souligne le bord opposé, et le reflet
        spéculaire, petit et net, qui fixe la position de la source. L'ordre
        compte autant que les couleurs — c'est l'empilement qui creuse.
      */}
      <span
        aria-hidden
        className="relative rounded-full transition-transform duration-100 ease-out"
        style={{
          width: taille * 0.52,
          height: taille * 0.52,
          transform: `scale(${echelle})`,
          // Le corps : plus clair vers la source, franchement plus sombre à
          // l'opposé. Sans cette bascule, la sphère reste un rond coloré.
          background: `radial-gradient(circle at 34% 26%, ${teinte.de} 0%, ${teinte.vers} 52%, ${assombrir(teinte.vers, 0.55)} 88%, ${assombrir(teinte.vers, 0.72)} 100%)`,
          boxShadow: [
            // Le halo projeté, qui suit la voix.
            `0 0 ${28 + niveau * 60}px ${teinte.halo}`,
            // L'ombre portée : elle pose la sphère au lieu de la laisser flotter.
            `0 ${taille * 0.06}px ${taille * 0.12}px -${taille * 0.04}px rgba(0,0,0,0.5)`,
            // Le terminateur, à l'intérieur et en bas à droite.
            `inset -${taille * 0.05}px -${taille * 0.07}px ${taille * 0.14}px rgba(0,0,0,0.45)`,
            // La lumière rasante qui ourle le bord éclairé.
            `inset ${taille * 0.03}px ${taille * 0.04}px ${taille * 0.09}px rgba(255,255,255,0.35)`,
          ].join(", "),
        }}
      >
        {/* Le voile qui tourne : il donne à la surface une matière, et il
            empêche la sphère de paraître figée quand personne ne parle. */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full opacity-45 mix-blend-screen animate-[spin_9s_linear_infinite]"
          style={{
            background: `conic-gradient(from 0deg, transparent, ${teinte.de}88, transparent 58%)`,
          }}
        />

        {/* La lumière rasante du bas : le rebond du sol, sans lequel une
            sphère éclairée d'un seul côté paraît découpée. */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{
            background: `radial-gradient(circle at 70% 88%, ${teinte.de}55 0%, transparent 42%)`,
          }}
        />

        {/* Le reflet spéculaire. Petit, net, décentré : c'est lui qui dit d'où
            vient la lumière, et il grossit à peine quand la voix monte. */}
        <span
          aria-hidden
          className="absolute rounded-full blur-[2px] transition-all duration-150"
          style={{
            top: "12%",
            left: "20%",
            width: `${26 + niveau * 6}%`,
            height: `${18 + niveau * 4}%`,
            background:
              "radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.92), rgba(255,255,255,0.22) 55%, transparent 72%)",
            transform: "rotate(-18deg)",
          }}
        />

        {/* Un second reflet, minuscule et bas : la marque d'une surface
            vernie plutôt que mate. */}
        <span
          aria-hidden
          className="absolute rounded-full blur-[1px]"
          style={{
            bottom: "16%",
            right: "22%",
            width: "9%",
            height: "7%",
            background: "rgba(255,255,255,0.5)",
          }}
        />
      </span>

    </div>
  );
}
