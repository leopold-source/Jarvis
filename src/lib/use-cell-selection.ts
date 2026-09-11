"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Sélection de cellules, à la manière d'un tableur.
 *
 * La sélection porte sur une cellule, pas sur une ligne : surligner la ligne
 * entière pour copier un statut laisse croire que tout va être écrasé. Ici on
 * voit exactement ce qui est pris — une colonne, quelques lignes.
 *
 * Une plage reste dans une seule colonne. Coller une valeur dans deux colonnes
 * différentes n'a pas de sens ici : ce qu'on copie est un statut, une date ou
 * une note, jamais un mélange des trois.
 */
export type CellRef = { id: string; field: string; index: number };

export type CellSelection = {
  /** La colonne concernée, s'il y a une sélection. */
  field: string | null;
  /** Les lignes retenues, dans l'ordre du tableau. */
  ids: string[];
  count: number;
  /** La cellule d'où part la sélection : c'est elle que la copie prend. */
  anchor: CellRef | null;
  isSelected: (id: string, field: string) => boolean;
  /** Bords de la plage, pour dessiner un cadre et non une bouillie de cases. */
  edge: (id: string, field: string) => { first: boolean; last: boolean };
  clear: () => void;
  extendTo: (cell: CellRef) => void;
  onCellMouseDown: (cell: CellRef, event: React.MouseEvent) => void;
  onCellMouseEnter: (cell: CellRef) => void;
};

export function useCellSelection(visibleIds: string[]): CellSelection {
  const [anchor, setAnchor] = useState<CellRef | null>(null);
  const [focus, setFocus] = useState<CellRef | null>(null);
  const dragging = useRef(false);

  // Ce qui sort de la vue sort de la sélection : coller sur une ligne qu'on ne
  // voit plus serait une modification à l'aveugle.
  const signature = visibleIds.join("|");
  useEffect(() => {
    setAnchor((current) => (current && visibleIds.includes(current.id) ? current : null));
    setFocus((current) => (current && visibleIds.includes(current.id) ? current : null));
    // `visibleIds` est résumé par `signature`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  useEffect(() => {
    function onMouseUp() {
      dragging.current = false;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAnchor(null);
        setFocus(null);
      }
    }
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const bounds = anchor && focus && anchor.field === focus.field
    ? { field: anchor.field, from: Math.min(anchor.index, focus.index), to: Math.max(anchor.index, focus.index) }
    : anchor
      ? { field: anchor.field, from: anchor.index, to: anchor.index }
      : null;

  const ids = bounds ? visibleIds.slice(bounds.from, bounds.to + 1) : [];

  const isSelected = useCallback(
    (id: string, field: string) => {
      if (!bounds || bounds.field !== field) return false;
      const index = visibleIds.indexOf(id);
      return index >= bounds.from && index <= bounds.to;
    },
    [bounds, visibleIds],
  );

  const edge = useCallback(
    (id: string, field: string) => {
      if (!bounds || bounds.field !== field) return { first: false, last: false };
      const index = visibleIds.indexOf(id);
      return { first: index === bounds.from, last: index === bounds.to };
    },
    [bounds, visibleIds],
  );

  const onCellMouseDown = useCallback((cell: CellRef, event: React.MouseEvent) => {
    if (event.button !== 0) return;

    // Maj-clic prolonge depuis la cellule de départ, sans la déplacer.
    if (event.shiftKey) {
      event.preventDefault();
      setFocus((current) => (current?.field === cell.field || current === null ? cell : cell));
      return;
    }

    setAnchor(cell);
    setFocus(cell);
    dragging.current = true;
  }, []);

  const onCellMouseEnter = useCallback((cell: CellRef) => {
    // Le glissement ne franchit pas la colonne : sortir latéralement ne doit
    // pas emporter une colonne voisine par accident.
    if (!dragging.current) return;
    setFocus((current) => (current && current.field !== cell.field ? current : cell));
  }, []);

  return {
    field: bounds?.field ?? null,
    ids,
    count: ids.length,
    anchor,
    isSelected,
    edge,
    clear: useCallback(() => {
      setAnchor(null);
      setFocus(null);
    }, []),
    extendTo: useCallback((cell: CellRef) => setFocus(cell), []),
    onCellMouseDown,
    onCellMouseEnter,
  };
}
