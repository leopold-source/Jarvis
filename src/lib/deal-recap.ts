import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

import { anthropicClient, anthropicKey, describeAnthropicError, MISSING_KEY_ERROR } from "@/lib/anthropic";
import type { DealRecap } from "@/lib/database.types";
import { rejouerEvenementsClaap, tirerCallsRecents } from "@/lib/claap-rejeu";
import {
  assemblerCorps,
  choisirCall,
  choisirDestinataires,
  lireParticipants,
  type CallPourRecap,
} from "@/lib/recap-logique";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/utils";

type Admin = NonNullable<ReturnType<typeof createAdminClient>>;

/*
  Opus, et non Haiku comme le tri des mails.

  Le tri passe cent fois par jour sur des messages qu'on relit à peine ; ce
  mail part au client, sous le nom d'un associé, une fois par R2. C'est le seul
  texte de l'application qu'un prospect lira : la qualité s'y paie moins cher
  qu'une maladresse. L'effort reste moyen — rédiger n'est pas raisonner.
*/
const MODELE = "claude-opus-5";

/** Au-delà, un récap en attente de son call est abandonné : le moment est passé. */
const ATTENTE_MAX_MS = 48 * 3_600_000;

const Redaction = z.object({
  objet: z.string().describe("Objet du mail, court et factuel."),
  salutation: z.string().describe("« Bonjour Prénom, » — voir les règles."),
  recap: z.string().describe("Le récapitulatif du call, sans intertitre."),
  prochaines_etapes: z.array(z.string()).describe("Une étape par élément, sans tiret."),
  tutoiement: z.boolean().describe("Vrai si les interlocuteurs se sont tutoyés pendant le call."),
});

const CONSIGNES = `Tu rédiges, au nom d'un associé d'Antichaos — petite agence qui forme les PME et les bureaux d'études à l'IA et l'intègre dans leurs outils —, le mail qu'il envoie à son interlocuteur après un rendez-vous commercial.

Le mail a une structure fixe, que tu ne choisis pas : la salutation, la phrase « Merci pour cet échange. », le récapitulatif, les prochaines étapes, puis la signature. Tu ne rédiges que trois morceaux : la salutation, le récapitulatif et les prochaines étapes. N'écris ni la phrase de remerciement, ni les intertitres, ni formule finale, ni signature : ils sont ajoutés autour de ton texte.

Salutation. « Bonjour Prénom, » avec le prénom du destinataire. Deux ou trois destinataires : « Bonjour Prénom1, Prénom2, ». Au-delà : « Bonjour à tous, ». Jamais de nom de famille, jamais de civilité.

Tutoiement. Lis le transcript : si l'associé et ses interlocuteurs se sont tutoyés, tutoie ; sinon, vouvoie. En cas de doute, vouvoie. Tout le mail suit ce choix.

Récapitulatif. Ce qui compte pour la suite de l'affaire : le contexte et le besoin exprimés par le client, ce qu'Antichaos a proposé ou présenté, les points d'accord et ce qui reste ouvert. Quelques phrases courtes, ou une liste à tirets (« - ») si les points sont nombreux et distincts. Reprends les chiffres, les noms d'outils et les échéances tels qu'ils ont été dits. N'écris rien qui ne soit pas dans l'échange : un récap qui invente perd la confiance qu'il devait installer.

Prochaines étapes. Les engagements concrets, un par élément : qui fait quoi, et quand si une date a été dite. Écris-les du point de vue de l'associé (« je vous envoie… », « vous nous transmettez… »). S'il n'y en a aucune de claire, propose la plus naturelle — généralement un prochain échange.

Ton. Celui d'un associé qui écrit lui-même, entre deux rendez-vous : direct, précis, chaleureux sans familiarité. Pas de formule creuse (« n'hésitez pas », « je reste à votre disposition »), pas de superlatif, pas d'emoji. Phrases courtes.

Objet. Court et factuel, par exemple « Récap de notre échange du 21/09 ».`;

type Contexte = {
  recap: DealRecap;
  expediteur: { nom: string; email: string };
  affaire: { nom: string; entreprise: string | null };
  call: CallPourRecap & { title: string | null };
  destinataires: Array<{ email: string; prenom: string | null }>;
};

/** Le prénom d'un destinataire : la fiche contact d'abord, le nom donné par Claap ensuite. */
async function prenoms(admin: Admin, emails: string[], participants: ReturnType<typeof lireParticipants>) {
  if (!emails.length) return [];
  const { data } = await admin.from("contacts").select("email, first_name, full_name").in("email", emails);
  const fiches = new Map((data ?? []).map((c) => [c.email?.toLowerCase() ?? "", c]));

  return emails.map((email) => {
    const fiche = fiches.get(email);
    const nomClaap = participants.find((p) => p.email === email)?.name ?? null;
    const prenom = fiche?.first_name?.trim() || (fiche?.full_name ?? nomClaap)?.trim().split(/\s+/)[0] || null;
    return { email, prenom };
  });
}

/** Demande au modèle les trois morceaux du mail. */
async function rediger(contexte: Contexte) {
  const { call } = contexte;
  const transcript = call.transcript?.trim() ?? "";

  const entete = [
    `Associé qui écrit : ${contexte.expediteur.nom}`,
    `Destinataires : ${contexte.destinataires.map((d) => `${d.prenom ?? "?"} <${d.email}>`).join(", ") || "à confirmer"}`,
    `Entreprise : ${contexte.affaire.entreprise ?? "—"}`,
    `Affaire : ${contexte.affaire.nom}`,
    `Call : « ${call.title ?? "sans titre"} », le ${formatDate(call.started_at ?? call.occurred_on)}`,
  ].join("\n");

  const client = anthropicClient();
  const reponse = await client.beta.messages.parse({
    model: MODELE,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    // Un refus des filtres de sécurité sur un compte rendu commercial serait
    // un faux positif ; la bascule serveur le rattrape sans nouvel appel.
    fallbacks: "default",
    system: CONSIGNES,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: betaZodOutputFormat(Redaction) },
    messages: [
      {
        role: "user",
        content: [
          entete,
          call.summary ? `<resume_claap>\n${call.summary}\n</resume_claap>` : "",
          transcript
            ? `<transcript>\n${transcript}\n</transcript>`
            : "Le transcript n'est pas disponible : appuie-toi sur le résumé de Claap, sans le recopier.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
  });

  if (reponse.stop_reason === "refusal") throw new Error("Le modèle a refusé de rédiger ce récap.");
  if (reponse.stop_reason === "max_tokens") throw new Error("Rédaction interrompue : réponse trop longue.");
  const sortie = reponse.parsed_output;
  if (!sortie) throw new Error("Le modèle n'a pas renvoyé de brouillon exploitable.");
  return { sortie, modele: reponse.model };
}

/**
 * Fait avancer un récap aussi loin que possible.
 *
 * Il peut attendre son call, le trouver en cours de traitement chez Claap, ou
 * le trouver prêt — auquel cas il se rédige. Cette fonction est appelée au
 * passage en R2 puis à chaque call qui arrive pour l'affaire : elle ne fait
 * jamais deux fois le même travail, et ne rédige qu'une fois.
 */
export async function avancerRecap(recapId: string, options: { callId?: string } = {}): Promise<DealRecap | null> {
  const admin = createAdminClient();
  if (!admin) return null;

  const { data: recap } = await admin.from("deal_recaps").select("*").eq("id", recapId).maybeSingle();
  if (!recap || !["en_attente_call", "echec"].includes(recap.status)) return recap as DealRecap | null;

  if (!options.callId && Date.now() - Date.parse(recap.requested_at) > ATTENTE_MAX_MS) {
    const { data } = await admin
      .from("deal_recaps")
      .update({ status: "ecarte", error: "Aucun call reçu dans les 48 h suivant le passage en R2." })
      .eq("id", recapId)
      .select("*")
      .single();
    return data as DealRecap;
  }

  const { data: calls } = await admin
    .from("call_records")
    .select("id, title, started_at, occurred_on, transcript, summary, has_external, participants")
    .eq("deal_id", recap.deal_id)
    .order("occurred_on", { ascending: false })
    .limit(20);

  const liste = (calls ?? []) as Array<CallPourRecap & { title: string | null }>;
  let call: (CallPourRecap & { title: string | null }) | undefined;

  if (options.callId) {
    // Choisi à la main : l'utilisateur a vu qu'aucun call récent n'arrivait
    // et a désigné l'ancien. On ne discute pas.
    call = liste.find((c) => c.id === options.callId);
  } else {
    const choix = choisirCall(liste, recap.requested_at);
    if (choix.etat !== "pret") return recap as DealRecap;
    call = liste.find((c) => c.id === choix.call.id);
  }
  if (!call) return recap as DealRecap;

  /*
    Qui rédige, et une seule fois.

    Claap envoie chaque événement quatre ou cinq fois en quelques secondes :
    sans ce verrou, quatre rédactions partiraient en parallèle et seraient
    toutes facturées. La transition vers « redaction » ne réussit qu'une fois.
  */
  const { data: pris } = await admin
    .from("deal_recaps")
    .update({ status: "redaction", call_record_id: call.id, error: null })
    .eq("id", recapId)
    .in("status", ["en_attente_call", "echec"])
    .select("id");
  if (!pris?.length) return null;

  const echouer = async (message: string) => {
    const { data } = await admin
      .from("deal_recaps")
      .update({ status: "echec", error: message })
      .eq("id", recapId)
      .select("*")
      .single();
    return data as DealRecap;
  };

  if (!anthropicKey()) return echouer(MISSING_KEY_ERROR);

  const [{ data: deal }, { data: auteur }, { data: liens }] = await Promise.all([
    admin.from("deals").select("name, company_id").eq("id", recap.deal_id).maybeSingle(),
    recap.requested_by
      ? admin.from("profiles").select("full_name, email").eq("id", recap.requested_by).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("deal_contacts").select("contacts (email)").eq("deal_id", recap.deal_id),
  ]);

  const { data: entreprise } = deal?.company_id
    ? await admin.from("companies").select("name").eq("id", deal.company_id).maybeSingle()
    : { data: null };

  // Le compte Google de l'auteur : c'est de là que le mail partira.
  const { data: compte } = recap.requested_by
    ? await admin.from("google_accounts").select("email").eq("user_id", recap.requested_by).maybeSingle()
    : { data: null };

  const expediteurEmail = (compte?.email ?? auteur?.email ?? "").toLowerCase();
  const participants = lireParticipants(call.participants);
  const replis = ((liens ?? []) as unknown as Array<{ contacts: { email: string | null } | null }>)
    .map((l) => l.contacts?.email ?? "")
    .filter(Boolean);

  const { to, cc } = choisirDestinataires(participants, expediteurEmail, replis);

  try {
    const { sortie, modele } = await rediger({
      recap: recap as DealRecap,
      expediteur: { nom: auteur?.full_name ?? auteur?.email ?? "l'associé", email: expediteurEmail },
      affaire: { nom: deal?.name ?? "Affaire", entreprise: entreprise?.name ?? null },
      call,
      destinataires: await prenoms(admin, to, participants),
    });

    const { data } = await admin
      .from("deal_recaps")
      .update({
        status: "pret",
        subject: sortie.objet.trim(),
        body: assemblerCorps({
          salutation: sortie.salutation,
          recap: sortie.recap,
          prochaines_etapes: sortie.prochaines_etapes,
        }),
        to_emails: to,
        cc_emails: cc,
        tutoiement: sortie.tutoiement,
        model: modele,
        error: null,
      })
      .eq("id", recapId)
      .select("*")
      .single();
    return data as DealRecap;
  } catch (caught) {
    return echouer(caught instanceof Anthropic.APIError ? describeAnthropicError(caught) : caught instanceof Error ? caught.message : "Rédaction impossible.");
  }
}

/** Réveille les récaps d'une affaire qui attendaient leur call. */
export async function avancerRecapsDe(dealId: string | null): Promise<void> {
  if (!dealId) return;
  const admin = createAdminClient();
  if (!admin) return;
  const { data } = await admin
    .from("deal_recaps")
    .select("id")
    .eq("deal_id", dealId)
    .eq("status", "en_attente_call");
  for (const { id } of data ?? []) await avancerRecap(id);
}

/**
 * Le passage en R2 : on crée le récap, on va chercher le call, on rédige si
 * on peut.
 *
 * Tout cela tourne après la réponse, pour que la carte change de colonne sans
 * attendre ni Claap ni le modèle. Si le call n'est pas encore arrivé, le récap
 * reste en attente ; c'est le webhook de Claap qui le réveillera.
 */
export async function demanderRecap(dealId: string, requestedBy: string): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return;

  // Une demande encore vivante pour cette affaire suffit : un aller-retour
  // R2 → R1 → R2 ne doit pas rédiger deux fois.
  const { data: vivante } = await admin
    .from("deal_recaps")
    .select("id")
    .eq("deal_id", dealId)
    .in("status", ["en_attente_call", "redaction", "pret"])
    .limit(1)
    .maybeSingle();
  if (vivante) {
    await avancerRecap(vivante.id);
    return;
  }

  const { data: cree } = await admin
    .from("deal_recaps")
    .insert({ deal_id: dealId, requested_by: requestedBy })
    .select("id")
    .single();
  if (!cree) return;

  /*
    « Déclencher la synchro Claap ».

    Le call vient souvent d'avoir lieu : son événement est peut-être déjà
    arrivé et resté dans le journal, ou pas encore parti. On rejoue le journal
    des dernières heures, puis on interroge l'API si une clé est configurée.
    Les deux sont sans effet quand il n'y a rien de nouveau.
  */
  await rejouerEvenementsClaap({ depuis: new Date(Date.now() - 48 * 3_600_000).toISOString() });
  await tirerCallsRecents();

  await avancerRecap(cree.id);
}
