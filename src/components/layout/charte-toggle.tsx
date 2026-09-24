"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

const STORAGE_KEY = "antichaos-charte";

type Charte = "atelier" | "classique";

const CHARTES: Array<{ valeur: Charte; libelle: string; detail: string }> = [
  { valeur: "atelier", libelle: "Atelier", detail: "Noir et papier, tiré du logo" },
  { valeur: "classique", libelle: "Classique", detail: "Orange et halos, la version d'avant" },
];

/**
 * Le choix de charte, à un clic.
 *
 * La bascule est immédiate : la charte n'est qu'un attribut sur la racine du
 * document, que la feuille de style lit. Pas de rechargement, pas de
 * requête — on compare les deux sur l'écran qu'on a sous les yeux. Le choix
 * reste dans ce navigateur, comme le thème clair ou sombre.
 */
export function CharteToggle() {
  const [charte, setCharte] = useState<Charte>("atelier");

  useEffect(() => {
    setCharte(document.documentElement.getAttribute("data-charte") === "classique" ? "classique" : "atelier");
  }, []);

  function choisir(valeur: Charte) {
    document.documentElement.setAttribute("data-charte", valeur);
    try {
      localStorage.setItem(STORAGE_KEY, valeur);
    } catch {
      // Navigation privée : le choix vaut pour la session, c'est déjà ça.
    }
    setCharte(valeur);
  }

  return (
    <div className="px-3.5 py-2.5">
      <p className="mb-1.5 text-[10.5px] tracking-wide text-[var(--text-muted)] uppercase">Charte</p>
      <div role="radiogroup" aria-label="Charte graphique" className="grid grid-cols-2 gap-1 rounded-[10px] bg-[var(--surface-hover)] p-1">
        {CHARTES.map(({ valeur, libelle, detail }) => (
          <button
            key={valeur}
            type="button"
            role="radio"
            aria-checked={charte === valeur}
            title={detail}
            onClick={() => choisir(valeur)}
            className={cn(
              "rounded-lg px-2 py-1.5 text-[12.5px] font-medium transition-colors",
              charte === valeur
                ? "bg-[var(--surface-overlay)] text-[var(--text-primary)] shadow-[var(--shadow-card)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
            )}
          >
            {libelle}
          </button>
        ))}
      </div>
    </div>
  );
}
