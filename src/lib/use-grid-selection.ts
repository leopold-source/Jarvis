"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Sélection de lignes à la souris, comme dans un tableur.
 *
 * La difficulté n'est pas de sélectionner : c'est de ne pas voler le clic
 * simple, qui doit continuer à ouvrir la fiche. D'où la règle retenue — un
 * appui seul ne sélectionne rien ; c'est le passage sur une deuxième ligne,
 * bouton enfoncé, qui transforme le geste en sélection. Tant que le curseur
 * n'a pas bougé, rien n'a changé et le clic fait ce qu'il a toujours fait.
 *
 * `suppressNextClick` porte le résultat de cet arbitrage jusqu'au gestionnaire
 * de clic, qui se déclenche après le relâchement.
 */
export type GridSelection = {
  selected: Set<string>;
  count: number;
  isSelected: (id: string) => boolean;
  clear: () => void;
  selectAll: (ids: string[]) => void;
  /** À poser sur la ligne : décide entre ouverture de fiche et sélection. */
  onRowMouseDown: (index: number, event: React.MouseEvent) => void;
  onRowMouseEnter: (index: number) => void;
  /** Vrai si le clic qui suit doit être ignoré : c'était un glissement. */
  consumeClickSuppression: () => boolean;
};

export function useGridSelection(ids: string[]): GridSelection {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anchor = useRef<number | null>(null);
  const drag = useRef<{ from: number; moved: boolean } | null>(null);
  const suppress = useRef(false);

  /*
    La sélection suit la liste, elle ne s'y perd pas.

    Élaguer plutôt que vider : le défilement infini agrandit la page à chaque
    palier, et repartir de zéro à ce moment-là effacerait une sélection que
    personne n'a défaite. Ce qui disparaît, en revanche — un filtre resserré,
    une recherche — doit sortir de la sélection : coller sur une ligne qu'on ne
    voit plus serait une modification à l'aveugle.
  */
  const signature = ids.join("|");
  useEffect(() => {
    setSelected((current) => {
      if (current.size === 0) return current;
      const present = new Set(ids);
      const next = new Set([...current].filter((id) => present.has(id)));
      return next.size === current.size ? current : next;
    });
    // `ids` est résumé par `signature` : le lister relancerait l'effet à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const range = useCallback(
    (from: number, to: number) => {
      const [start, end] = from <= to ? [from, to] : [to, from];
      return new Set(ids.slice(start, end + 1));
    },
    [ids],
  );

  useEffect(() => {
    function onMouseUp() {
      if (drag.current?.moved) suppress.current = true;
      drag.current = null;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSelected(new Set());
    }
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const onRowMouseDown = useCallback(
    (index: number, event: React.MouseEvent) => {
      if (event.button !== 0) return;

      // Un appui sur un champ, un menu ou un lien appartient à ce champ :
      // sélectionner du texte dans un commentaire ne doit pas sélectionner des
      // lignes au passage.
      if (
        event.target instanceof Element &&
        event.target.closest("input, select, textarea, button, a")
      ) {
        return;
      }

      if (event.shiftKey && anchor.current !== null) {
        event.preventDefault(); // sinon le navigateur sélectionne le texte
        setSelected(range(anchor.current, index));
        suppress.current = true;
        return;
      }

      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        setSelected((current) => {
          const next = new Set(current);
          next.has(ids[index]) ? next.delete(ids[index]) : next.add(ids[index]);
          return next;
        });
        anchor.current = index;
        suppress.current = true;
        return;
      }

      anchor.current = index;
      drag.current = { from: index, moved: false };
    },
    [ids, range],
  );

  const onRowMouseEnter = useCallback(
    (index: number) => {
      const current = drag.current;
      if (!current || index === current.from) return;
      current.moved = true;
      setSelected(range(current.from, index));
    },
    [range],
  );

  const consumeClickSuppression = useCallback(() => {
    const value = suppress.current;
    suppress.current = false;
    return value;
  }, []);

  return {
    selected,
    count: selected.size,
    isSelected: useCallback((id: string) => selected.has(id), [selected]),
    clear: useCallback(() => setSelected(new Set()), []),
    selectAll: useCallback((all: string[]) => setSelected(new Set(all)), []),
    onRowMouseDown,
    onRowMouseEnter,
    consumeClickSuppression,
  };
}
