import { Fragment, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Le résumé Claap, lisible sans Claap.
 *
 * Claap écrit en Markdown réduit : intertitres, listes, gras. Un moteur
 * Markdown complet serait disproportionné, et injecter du HTML produit
 * ailleurs dans la page serait imprudent. Ce rendu ne connaît que ces trois
 * formes, et ne produit que des éléments React — rien n'est interprété.
 */
function enLigne(texte: string): ReactNode[] {
  // Le gras seulement : c'est la seule emphase qu'emploie Claap.
  return texte.split(/(\*\*[^*]+\*\*)/g).map((morceau, index) =>
    /^\*\*[^*]+\*\*$/.test(morceau) ? (
      <strong key={index} className="font-semibold text-[var(--text-primary)]">
        {morceau.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={index}>{morceau}</Fragment>
    ),
  );
}

export function TexteClaap({ texte, className }: { texte: string; className?: string }) {
  const lignes = texte.replace(/\r\n/g, "\n").split("\n");
  const blocs: ReactNode[] = [];
  let liste: string[] = [];

  const viderListe = (cle: string) => {
    if (!liste.length) return;
    blocs.push(
      <ul key={cle} className="my-1.5 list-disc space-y-1 pl-4 marker:text-[var(--text-muted)]">
        {liste.map((item, index) => (
          <li key={index}>{enLigne(item)}</li>
        ))}
      </ul>,
    );
    liste = [];
  };

  lignes.forEach((brute, index) => {
    const ligne = brute.trim();
    const puce = /^(?:[-*•]|\d+\.)\s+(.*)$/.exec(ligne);
    if (puce) {
      liste.push(puce[1]);
      return;
    }
    viderListe(`l${index}`);
    if (!ligne) return;

    const titre = /^(#{1,4})\s+(.*)$/.exec(ligne);
    if (titre) {
      blocs.push(
        <p
          key={index}
          className={cn(
            "font-semibold text-[var(--text-primary)]",
            titre[1].length <= 2 ? "mt-3 text-[12.5px] first:mt-0" : "mt-2 text-[12px]",
          )}
        >
          {enLigne(titre[2])}
        </p>,
      );
      return;
    }
    blocs.push(
      <p key={index} className="my-1">
        {enLigne(ligne)}
      </p>,
    );
  });
  viderListe("fin");

  return <div className={cn("text-[12.5px] leading-relaxed text-[var(--text-secondary)]", className)}>{blocs}</div>;
}
