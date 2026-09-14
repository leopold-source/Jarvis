"use client";

import { useEffect, useState } from "react";

import { FilEmails } from "@/components/crm/fil-emails";
import type { EmailMessage } from "@/lib/database.types";
import { fetchDealEmails } from "@/app/(crm)/affaires/email-actions";

type Etat =
  | { statut: "chargement" }
  | { statut: "pret"; messages: EmailMessage[]; connecte: boolean }
  | { statut: "erreur"; erreur: string };

/**
 * Fil des échanges rattachés à l'affaire.
 *
 * Chargé à l'ouverture du tiroir plutôt qu'avec la liste des affaires : la
 * plupart des consultations n'ouvrent aucune fiche, autant ne rien payer pour
 * celles-là.
 *
 * Le rendu est celui de `FilEmails`, partagé avec les projets — les deux
 * montrent la même chose et ne diffèrent que par la façon de la chercher.
 */
export function DealEmails({ dealId }: { dealId: string }) {
  const [etat, setEtat] = useState<Etat>({ statut: "chargement" });

  useEffect(() => {
    let vivant = true;
    setEtat({ statut: "chargement" });
    void fetchDealEmails(dealId).then((resultat) => {
      if (!vivant) return;
      setEtat(
        resultat.ok
          ? { statut: "pret", messages: resultat.messages, connecte: resultat.connected }
          : { statut: "erreur", erreur: resultat.error },
      );
    });
    return () => {
      vivant = false;
    };
  }, [dealId]);

  const pret = etat.statut === "pret" ? etat : null;

  return (
    <FilEmails
      titre="Échanges e-mail"
      messages={pret?.messages ?? []}
      chargement={etat.statut === "chargement"}
      erreur={etat.statut === "erreur" ? etat.erreur : null}
      connecte={pret?.connecte}
      vide="Aucun échange rattaché pour l'instant."
    />
  );
}
