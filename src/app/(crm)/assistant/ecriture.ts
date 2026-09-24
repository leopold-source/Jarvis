"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { requireStaff } from "@/lib/auth";
import { LEAD_STATUS, DEAL_STAGE } from "@/lib/constants";
import type { DealStage, LeadStatus } from "@/lib/database.types";
import { demanderRecap } from "@/lib/deal-recap";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";

/**
 * Ce que l'assistant a le droit d'écrire, et comment il l'obtient.
 *
 * Le modèle ne rédige jamais de requête : il remplit un formulaire fermé, que
 * cette couche exécute. Deux conséquences qui font tout l'intérêt du procédé —
 * la liste des types ci-dessous est la liste exhaustive de ce qui peut arriver
 * à la base, et la confirmation ne coûte pas un jeton puisqu'elle se joue
 * entre l'écran et ici, sans repasser par le modèle.
 *
 * Rien de destructif. Ni suppression, ni « perdu », ni clôture : une phrase mal
 * entendue doit pouvoir se rattraper en deux clics.
 */

export type ActionType =
  | "creer_tache"
  | "planifier_relance"
  | "changer_statut_lead"
  | "changer_etape_affaire"
  | "ajouter_note_lead"
  | "assigner_lead"
  | "creer_chantier";

export type ActionProposee = {
  type: ActionType;
  /** Identifiant de la fiche visée, tel que renvoyé par la recherche. */
  cible_id?: string | null;
  /** Ce qu'on écrit : un statut, une étape, une date, un titre, un texte. */
  valeur?: string | null;
  detail?: string | null;
  /** La phrase lue à voix haute avant d'appuyer. Écrite par le modèle. */
  resume: string;
};

export type ActionResultat = { ok: true; message: string } | { ok: false; error: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function executerAction(action: ActionProposee): Promise<ActionResultat> {
  const profile = await requireStaff();
  const supabase = await createClient();

  const valeur = action.valeur?.trim() ?? "";
  const detail = action.detail?.trim() ?? "";

  switch (action.type) {
    case "planifier_relance": {
      if (!action.cible_id) return { ok: false, error: "Je ne sais pas quel lead relancer." };
      if (!ISO.test(valeur)) return { ok: false, error: "La date de relance est illisible." };

      const { error } = await supabase
        .from("leads")
        .update({ follow_up_on: valeur })
        .eq("id", action.cible_id);
      if (error) return { ok: false, error: error.message };

      revalidatePath("/leads");
      return { ok: true, message: `Relance planifiée au ${valeur}.` };
    }

    case "changer_statut_lead": {
      if (!action.cible_id) return { ok: false, error: "Je ne sais pas quel lead modifier." };
      if (!(valeur in LEAD_STATUS)) return { ok: false, error: `Statut inconnu : ${valeur}.` };
      // « Call pris » crée une entreprise, un contact et une affaire : cela se
      // fait depuis la fiche, où l'on voit ce qui va être créé.
      if (valeur === "call_pris") {
        return { ok: false, error: "Un call pris se convertit depuis la fiche, pas à la voix." };
      }

      const { error } = await supabase
        .from("leads")
        .update({ status: valeur as LeadStatus })
        .eq("id", action.cible_id);
      if (error) return { ok: false, error: error.message };

      revalidatePath("/leads");
      return { ok: true, message: `Statut passé à « ${LEAD_STATUS[valeur as LeadStatus].label} ».` };
    }

    case "ajouter_note_lead": {
      if (!action.cible_id) return { ok: false, error: "Je ne sais pas quel lead annoter." };
      if (!detail) return { ok: false, error: "La note est vide." };

      const { data: existant } = await supabase
        .from("leads")
        .select("comment")
        .eq("id", action.cible_id)
        .maybeSingle();

      // On ajoute, on ne remplace pas : une note dictée ne doit pas effacer ce
      // qu'un appel précédent avait appris.
      const horodatee = `${formatDate(new Date().toISOString())} : ${detail}`;
      const corps = existant?.comment ? `${existant.comment}\n${horodatee}` : horodatee;

      const { error } = await supabase
        .from("leads")
        .update({ comment: corps })
        .eq("id", action.cible_id);
      if (error) return { ok: false, error: error.message };

      revalidatePath("/leads");
      return { ok: true, message: "Note ajoutée." };
    }

    case "assigner_lead": {
      if (!action.cible_id) return { ok: false, error: "Je ne sais pas quel lead assigner." };

      const { data: membre } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .neq("role", "client")
        .or(`full_name.ilike.%${valeur.replace(/[,()*%\\"']/g, " ")}%,email.ilike.%${valeur.replace(/[,()*%\\"']/g, " ")}%`)
        .maybeSingle();

      if (!membre) return { ok: false, error: `Je ne trouve pas « ${valeur} » dans l'équipe.` };

      const { error } = await supabase
        .from("leads")
        .update({ owner_id: membre.id, owner_name: membre.full_name ?? membre.email })
        .eq("id", action.cible_id);
      if (error) return { ok: false, error: error.message };

      revalidatePath("/leads");
      return { ok: true, message: `Assigné à ${membre.full_name ?? membre.email}.` };
    }

    case "changer_etape_affaire": {
      if (!action.cible_id) return { ok: false, error: "Je ne sais pas quelle affaire modifier." };
      if (!(valeur in DEAL_STAGE)) return { ok: false, error: `Étape inconnue : ${valeur}.` };
      // Gagné déclenche la création d'un projet et d'un dossier ; perdu ferme
      // l'affaire. Ni l'un ni l'autre ne se décide sur un « oui » entendu.
      if (["gagne", "perdu", "non_qualifie"].includes(valeur)) {
        return {
          ok: false,
          error: "Gagner ou perdre une affaire se fait depuis le pipeline, pas à la voix.",
        };
      }

      const { data: avant } = await supabase
        .from("deals")
        .select("stage")
        .eq("id", action.cible_id)
        .maybeSingle();

      const { error } = await supabase
        .from("deals")
        .update({ stage: valeur as DealStage, stage_changed_at: new Date().toISOString() })
        .eq("id", action.cible_id);
      if (error) return { ok: false, error: error.message };

      // Le même récap qu'au glisser-déposer : l'étape change de la même façon,
      // elle doit produire la même chose.
      const recap = avant?.stage === "r1" && valeur === "r2";
      if (recap) {
        const dealId = action.cible_id;
        after(() => demanderRecap(dealId, profile.id));
      }

      revalidatePath("/affaires");
      return {
        ok: true,
        message: `Affaire passée en « ${DEAL_STAGE[valeur as DealStage].label} ».${
          recap ? " Je prépare le récap du call." : ""
        }`,
      };
    }

    case "creer_tache": {
      if (!action.cible_id) return { ok: false, error: "Je ne sais pas sur quel projet créer la tâche." };
      if (!valeur) return { ok: false, error: "La tâche n'a pas d'intitulé." };

      const { error } = await supabase.from("tasks").insert({
        project_id: action.cible_id,
        title: valeur,
        description: detail || null,
        kind: "production",
        created_by: profile.id,
        // Créée à la voix, donc non partagée par défaut : ce qui s'affiche chez
        // un client ne se décide pas en passant.
        is_client_visible: false,
      });
      if (error) return { ok: false, error: error.message };

      revalidatePath("/projets");
      return { ok: true, message: `Tâche « ${valeur} » créée.` };
    }

    case "creer_chantier": {
      if (!valeur) return { ok: false, error: "Le chantier n'a pas de titre." };

      const { error } = await supabase.from("chantiers").insert({
        title: valeur,
        intention: detail || null,
        owner_id: profile.id,
        created_by: profile.id,
      });
      if (error) return { ok: false, error: error.message };

      revalidatePath("/chantiers");
      return { ok: true, message: `Chantier « ${valeur} » créé.` };
    }

    default:
      return { ok: false, error: "Action inconnue." };
  }
}
