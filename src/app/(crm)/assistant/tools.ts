import "server-only";

import { DEAL_STAGE, LEAD_STATUS } from "@/lib/constants";
import type { DealStage } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

/**
 * Ce que l'assistant a le droit de regarder.
 *
 * Chaque outil renvoie un objet compact plutôt que des lignes brutes : le
 * modèle doit répondre à voix haute, donc il a besoin de chiffres déjà
 * agrégés, pas d'un tableau de 432 fiches qu'il résumerait mal et qui
 * coûterait dix fois le prix. La règle tient en une phrase — la base compte,
 * le modèle formule.
 *
 * Aucun outil n'écrit. C'est délibéré pour cette première version : entre une
 * phrase mal entendue et une donnée modifiée, il n'y aurait rien pour rattraper.
 */

export type ToolResult = Record<string, unknown>;

export const READ_TOOLS = [
  {
    name: "resume_prospection",
    description:
      "État de la prospection téléphonique : combien de leads sont à rappeler aujourd'hui, " +
      "combien sont en retard, combien n'ont jamais été appelés, et la répartition par statut. " +
      "À utiliser pour « qu'est-ce que j'ai à faire », « où j'en suis en prospection ».",
    input_schema: { type: "object" as const, properties: {}, additionalProperties: false },
  },
  {
    name: "resume_pipeline",
    description:
      "État commercial : montant du pipeline actif, montant en sommeil (affaires sans mouvement " +
      "depuis le délai fixé), affaires gagnées, taux de conversion, répartition par étape. " +
      "À utiliser pour « où en est le pipeline », « combien on a signé », « qu'est-ce qui dort ».",
    input_schema: { type: "object" as const, properties: {}, additionalProperties: false },
  },
  {
    name: "chercher",
    description:
      "Recherche une personne ou une entreprise dans les leads, contacts, entreprises et affaires. " +
      "À utiliser dès qu'un nom propre est prononcé : « où en est Verdi », « c'est qui Nicolas de BM2S ».",
    input_schema: {
      type: "object" as const,
      properties: {
        terme: { type: "string", description: "Nom de personne ou d'entreprise, tel qu'entendu" },
      },
      required: ["terme"],
      additionalProperties: false,
    },
  },
  {
    name: "a_rappeler",
    description:
      "La liste nominative des prochains appels à passer, dans l'ordre de la file de prospection. " +
      "À utiliser pour « qui je dois appeler », « donne-moi les trois premiers ».",
    input_schema: {
      type: "object" as const,
      properties: {
        limite: { type: "integer", description: "Combien de fiches renvoyer, 1 à 10. Défaut 5." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "etat_chantiers",
    description:
      "Les chantiers en cours et l'avancement de leurs objectifs chiffrés. " +
      "À utiliser pour « où en sont nos chantiers », « on est à combien sur l'objectif ».",
    input_schema: { type: "object" as const, properties: {}, additionalProperties: false },
  },
  {
    name: "resume_mails",
    description:
      "Le bilan du dernier tri de la boîte mail : combien de mails reçus, combien de spams " +
      "écartés, quelles réponses ont été préparées et par qui, et ce que le tri n'a pas su " +
      "traiter. À utiliser pour « tu as trié mes mails », « quoi de neuf dans ma boîte », " +
      "et systématiquement quand on te demande un récapitulatif du matin.",
    input_schema: { type: "object" as const, properties: {}, additionalProperties: false },
  },
  {
    name: "echeances",
    description:
      "Ce qui arrive dans les prochains jours : relances planifiées, tâches et jalons de projet, " +
      "factures à émettre ou en retard de paiement. À utiliser pour « c'est quoi mes échéances ».",
    input_schema: {
      type: "object" as const,
      properties: {
        jours: { type: "integer", description: "Horizon en jours, 1 à 60. Défaut 14." },
      },
      additionalProperties: false,
    },
  },
] as const;

export type ToolName = (typeof READ_TOOLS)[number]["name"];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function dateDans(jours: number) {
  return new Date(Date.now() + jours * 86_400_000).toISOString().slice(0, 10);
}

/** Exécute un outil. Le nom vient du modèle : tout ce qui n'est pas reconnu est refusé. */
export async function runReadTool(name: string, input: Record<string, unknown>): Promise<ToolResult> {
  const supabase = await createClient();

  switch (name) {
    case "resume_prospection": {
      const { data } = await supabase
        .from("leads")
        .select("status, follow_up_on, phone, phone_standard");
      const leads = data ?? [];
      const jour = today();

      const parStatut: Record<string, number> = {};
      for (const lead of leads) {
        const label = LEAD_STATUS[lead.status]?.label ?? lead.status;
        parStatut[label] = (parStatut[label] ?? 0) + 1;
      }

      return {
        total: leads.length,
        en_retard: leads.filter((l) => l.follow_up_on && l.follow_up_on < jour).length,
        aujourd_hui: leads.filter((l) => l.follow_up_on === jour).length,
        jamais_appeles: leads.filter((l) => l.status === "a_contacter").length,
        sans_telephone: leads.filter((l) => !l.phone && !l.phone_standard).length,
        par_statut: parStatut,
      };
    }

    case "resume_pipeline": {
      const [{ data: deals }, { data: sante }] = await Promise.all([
        supabase.from("deals").select("id, stage, amount"),
        supabase.from("deal_health").select("deal_id, sante, jours_dans_etape"),
      ]);

      const health = new Map((sante ?? []).map((row) => [row.deal_id, row]));
      const all = deals ?? [];
      const ouvertes = all.filter(
        (d) => !["gagne", "perdu", "non_qualifie"].includes(d.stage),
      );
      const dormantes = ouvertes.filter((d) => health.get(d.id)?.sante === "dormant");
      const actives = ouvertes.filter((d) => health.get(d.id)?.sante !== "dormant");
      const gagnees = all.filter((d) => d.stage === "gagne");
      const cloturees = all.filter((d) => ["gagne", "perdu"].includes(d.stage));

      const somme = (liste: typeof all) => liste.reduce((t, d) => t + (d.amount ?? 0), 0);
      const parEtape: Record<string, number> = {};
      for (const deal of all) {
        const label = DEAL_STAGE[deal.stage as DealStage]?.label ?? deal.stage;
        parEtape[label] = (parEtape[label] ?? 0) + 1;
      }

      return {
        pipeline_actif_euros: somme(actives),
        affaires_actives: actives.length,
        pipeline_dormant_euros: somme(dormantes),
        affaires_dormantes: dormantes.length,
        signe_euros: somme(gagnees),
        affaires_gagnees: gagnees.length,
        taux_conversion_pct:
          cloturees.length > 0 ? Math.round((gagnees.length / cloturees.length) * 100) : null,
        // Beaucoup d'affaires n'ont pas de montant : le dire évite que le
        // modèle présente un total partiel comme le chiffre d'affaires réel.
        affaires_sans_montant: all.filter((d) => d.amount == null).length,
        par_etape: parEtape,
      };
    }

    case "chercher": {
      const terme = String(input.terme ?? "").trim();
      if (terme.length < 2) return { erreur: "Terme de recherche trop court." };

      /*
        Le terme est assaini avant de rejoindre un filtre `or`.

        Dans `or(...)`, PostgREST sépare les clauses par des virgules et les
        groupe par des parenthèses : une valeur qui en contient ne « casse »
        pas seulement la requête, elle peut y ajouter des conditions. Le terme
        vient ici du modèle, qui l'a lui-même tiré d'une phrase dictée — donc
        d'une source qu'on ne maîtrise pas. On ne garde que ce qui a un sens
        dans un nom propre, et les jokers SQL sont retirés pour qu'une
        recherche reste une recherche.

        Le point, lui, est conservé : il n'a aucun pouvoir structurant dans une
        valeur, et le retirer aurait cassé toute recherche par e-mail — ce que
        le premier jet de ce correctif faisait, sans que rien ne le signale.
      */
      const propre = terme.replace(/[,()*%\\"']/g, " ").replace(/\s+/g, " ").trim();
      if (propre.length < 2) return { erreur: "Terme de recherche inexploitable." };
      const motif = `%${propre}%`;

      const [{ data: leads }, { data: deals }, { data: companies }] = await Promise.all([
        supabase
          .from("leads")
          .select("full_name, company_name, job_title, status, phone, phone_standard, email, follow_up_on, comment")
          .or(`full_name.ilike.${motif},company_name.ilike.${motif},email.ilike.${motif}`)
          .limit(6),
        supabase
          .from("deals")
          .select("name, stage, amount, expected_close_on, next_step")
          .ilike("name", motif)
          .limit(6),
        supabase.from("companies").select("name, sector, region").ilike("name", motif).limit(4),
      ]);

      return {
        leads: (leads ?? []).map((l) => ({
          nom: l.full_name,
          entreprise: l.company_name,
          poste: l.job_title,
          statut: LEAD_STATUS[l.status]?.label ?? l.status,
          telephone: l.phone ?? l.phone_standard,
          email: l.email,
          relance: l.follow_up_on,
          note: l.comment,
        })),
        affaires: (deals ?? []).map((d) => ({
          nom: d.name,
          etape: DEAL_STAGE[d.stage as DealStage]?.label ?? d.stage,
          montant: d.amount,
          cloture_prevue: d.expected_close_on,
          prochaine_etape: d.next_step,
        })),
        entreprises: companies ?? [],
      };
    }

    case "a_rappeler": {
      const limite = Math.min(10, Math.max(1, Number(input.limite) || 5));
      const jour = today();

      const colonnes =
        "full_name, company_name, job_title, status, phone, phone_standard, follow_up_on, comment";

      /*
        Deux requêtes plutôt qu'un filtre composé.

        La file d'appel obéit à une règle simple — les relances dues d'abord,
        les fiches sans date ensuite — mais l'exprimer en un seul filtre
        PostgREST demande d'imbriquer un `and(...)` avec une liste entre
        parenthèses dans un `or(...)`. C'est exactement le genre de chaîne qui
        échoue à l'exécution sans que rien ne l'ait signalé avant. Deux appels
        lisibles coûtent un aller-retour et se vérifient à l'œil.
      */
      const [{ data: dues }, { data: sansDate }] = await Promise.all([
        supabase
          .from("leads")
          .select(colonnes)
          .not("follow_up_on", "is", null)
          .lte("follow_up_on", jour)
          .order("follow_up_on", { ascending: true })
          .limit(limite),
        supabase
          .from("leads")
          .select(colonnes)
          .is("follow_up_on", null)
          .in("status", ["nrp", "nrp2", "nrp3", "a_recontacter", "a_contacter"])
          .order("status_changed_at", { ascending: true })
          .limit(limite),
      ]);

      const file = [...(dues ?? []), ...(sansDate ?? [])].slice(0, limite);

      return {
        appels: file.map((l) => ({
          nom: l.full_name,
          entreprise: l.company_name,
          poste: l.job_title,
          statut: LEAD_STATUS[l.status]?.label ?? l.status,
          telephone: l.phone ?? l.phone_standard,
          relance_prevue: l.follow_up_on,
          note: l.comment,
        })),
      };
    }

    case "etat_chantiers": {
      const [{ data: chantiers }, { data: objectifs }] = await Promise.all([
        supabase.from("chantiers").select("id, title, intention, status").neq("status", "termine"),
        supabase.from("objectifs").select("chantier_id, title, target_value, current_value, unit, due_on"),
      ]);

      return {
        chantiers: (chantiers ?? []).map((c) => ({
          titre: c.title,
          intention: c.intention,
          statut: c.status,
          objectifs: (objectifs ?? [])
            .filter((o) => o.chantier_id === c.id)
            .map((o) => ({
              titre: o.title,
              cible: Number(o.target_value),
              atteint: Number(o.current_value),
              unite: o.unit,
              echeance: o.due_on,
            })),
        })),
      };
    }

    case "echeances": {
      const jours = Math.min(60, Math.max(1, Number(input.jours) || 14));
      const jour = today();
      const limite = dateDans(jours);

      const [{ data: relances }, { data: taches }, { data: factures }] = await Promise.all([
        supabase
          .from("leads")
          .select("full_name, company_name, follow_up_on")
          .not("follow_up_on", "is", null)
          .lte("follow_up_on", limite)
          .order("follow_up_on")
          .limit(10),
        supabase
          .from("tasks")
          .select("title, due_on, kind, status")
          .neq("status", "termine")
          .not("due_on", "is", null)
          .lte("due_on", limite)
          .order("due_on")
          .limit(10),
        supabase
          .from("invoices")
          .select("label, amount_ttc, due_on, status")
          .in("status", ["prevue", "emise"])
          .not("due_on", "is", null)
          .lte("due_on", limite)
          .order("due_on")
          .limit(10),
      ]);

      return {
        aujourd_hui: jour,
        relances: (relances ?? []).map((l) => ({
          qui: l.full_name,
          entreprise: l.company_name,
          date: l.follow_up_on,
          en_retard: Boolean(l.follow_up_on && l.follow_up_on < jour),
        })),
        taches: (taches ?? []).map((t) => ({
          titre: t.title,
          date: t.due_on,
          type: t.kind,
          en_retard: Boolean(t.due_on && t.due_on < jour),
        })),
        factures: (factures ?? []).map((f) => ({
          libelle: f.label,
          montant_ttc: Number(f.amount_ttc),
          echeance: f.due_on,
          statut: f.status,
          en_retard: Boolean(f.due_on && f.due_on < jour && f.status === "emise"),
        })),
      };
    }

    case "resume_mails": {
      const [{ data: passages }, { data: attente }] = await Promise.all([
        supabase
          .from("mail_runs")
          .select("*")
          .order("started_at", { ascending: false })
          .limit(1),
        supabase
          .from("mail_triage")
          .select("from_name, from_email, subject, category, action, draft_blocked_reason")
          .eq("review", "en_attente")
          .order("received_at", { ascending: false })
          .limit(12),
      ]);

      const passage = (passages ?? [])[0];
      if (!passage) return { jamais_execute: true };

      const enAttente = attente ?? [];

      return {
        date_du_tri: passage.started_at,
        mails_lus: passage.lus,
        spams_ecartes: passage.spams,
        factures: passage.factures,
        reponses_pretes: passage.brouillons,
        pour_toi: passage.a_traiter,
        erreur: passage.erreur,
        // Nominatif : c'est ce qui rend l'annonce utile à l'oral. « Nicolas de
        // BM2S t'a écrit » vaut mieux que « trois mails attendent ».
        reponses_preparees: enAttente
          .filter((m) => m.action === "brouillon_pret")
          .map((m) => ({ de: m.from_name ?? m.from_email, objet: m.subject })),
        sans_reponse: enAttente
          .filter((m) => m.action !== "brouillon_pret")
          .map((m) => ({
            de: m.from_name ?? m.from_email,
            objet: m.subject,
            pourquoi: m.draft_blocked_reason,
          })),
      };
    }

    default:
      return { erreur: `Outil inconnu : ${name}` };
  }
}
