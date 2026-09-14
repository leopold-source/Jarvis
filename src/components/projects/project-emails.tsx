"use client";

import { useEffect, useState } from "react";

import { FilEmails } from "@/components/crm/fil-emails";
import type { EmailMessage } from "@/lib/database.types";
import { fetchProjectEmails } from "@/app/(crm)/projets/email-actions";

type Etat =
  | { statut: "chargement" }
  | { statut: "pret"; messages: EmailMessage[]; connecte: boolean; avantProjet: number }
  | { statut: "erreur"; erreur: string };

/**
 * Les échanges e-mail du projet.
 *
 * Chargé quand l'onglet s'ouvre, pas avec la page : on consulte un projet dix
 * fois pour une fois qu'on relit sa correspondance, et trois requêtes payées à
 * chaque affichage pour rien seraient trois de trop.
 */
export function ProjectEmails({ projectId }: { projectId: string }) {
  const [etat, setEtat] = useState<Etat>({ statut: "chargement" });

  useEffect(() => {
    let vivant = true;
    setEtat({ statut: "chargement" });
    void fetchProjectEmails(projectId).then((resultat) => {
      if (!vivant) return;
      setEtat(
        resultat.ok
          ? {
              statut: "pret",
              messages: resultat.messages,
              connecte: resultat.connected,
              avantProjet: resultat.avantProjet,
            }
          : { statut: "erreur", erreur: resultat.error },
      );
    });
    return () => {
      vivant = false;
    };
  }, [projectId]);

  const pret = etat.statut === "pret" ? etat : null;

  return (
    <FilEmails
      titre="Échanges e-mail"
      messages={pret?.messages ?? []}
      chargement={etat.statut === "chargement"}
      erreur={etat.statut === "erreur" ? etat.erreur : null}
      connecte={pret?.connecte}
      vide="Aucun échange rattaché à ce projet ni à son entreprise."
      /*
        Dire ce qui précède le projet plutôt que de le masquer.

        Les messages de la phase commerciale sont la trace de ce qu'on a promis
        avant de signer, et c'est souvent ce qu'on vient chercher en cours de
        chantier. Les écarter appauvrirait l'historique ; les mêler sans le dire
        laisserait croire que le projet a commencé plus tôt.
      */
      note={
        pret && pret.avantProjet > 0
          ? `${pret.avantProjet} message${pret.avantProjet > 1 ? "s" : ""} ${
              pret.avantProjet > 1 ? "datent" : "date"
            } d'avant le début du projet.`
          : null
      }
    />
  );
}
