/**
 * La dernière action d'un lead, en mots.
 *
 * La base garde le geste brut — `statut` + `nrp:3` — et c'est ici qu'il
 * devient « NRP 3 ». Les intitulés viennent de `LEAD_STATUS`, comme partout
 * ailleurs : une seconde liste de libellés, dans le déclencheur SQL, aurait
 * fini par ne plus dire la même chose que la liste des statuts.
 */
import { LEAD_STATUS } from "@/lib/constants";
import type { LeadAction, LeadStatus } from "@/lib/database.types";
import { formatDate } from "@/lib/utils";

export type ActionLisible = {
  /** Le geste : « NRP 3 », « Note », « Relance le 02/10 »… */
  titre: string;
  /** Ce qui l'éclaire : l'extrait de la note, l'objet du mail. */
  precision: string | null;
};

function statutLisible(detail: string | null): string {
  if (!detail) return "Statut changé";
  const nrp = /^nrp:(\d+)$/.exec(detail);
  if (nrp) return `NRP ${nrp[1]}`;
  return LEAD_STATUS[detail as LeadStatus]?.label ?? detail;
}

export function libelleAction(
  action: LeadAction | null,
  detail: string | null,
): ActionLisible | null {
  if (!action) return null;
  switch (action) {
    case "statut":
      return { titre: `→ ${statutLisible(detail)}`, precision: null };
    case "nrp":
      return { titre: `NRP ${detail ?? ""}`.trim(), precision: "Appel sans réponse" };
    case "note":
      return { titre: "Note", precision: detail };
    case "relance":
      return { titre: detail ? `Relance le ${formatDate(detail)}` : "Relance planifiée", precision: null };
    case "mail": {
      // « envoye|Objet » ou « recu|Objet » : le sens d'abord, l'objet ensuite.
      const [sens, ...reste] = (detail ?? "").split("|");
      return {
        titre: sens === "recu" ? "Mail reçu" : "Mail envoyé",
        precision: reste.join("|") || null,
      };
    }
    case "conversion":
      return { titre: "Converti en affaire", precision: null };
  }
}
