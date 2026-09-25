import "server-only";

import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { anthropicClient } from "@/lib/anthropic";
import { DEAL_STAGE, LEAD_STATUS } from "@/lib/constants";
import type { DealStage, LeadStatus } from "@/lib/database.types";
import { htmlEnTexte } from "@/lib/notes-logique";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate, formatDateHeure } from "@/lib/utils";

/*
  Sonnet, à la demande seulement.

  La synthèse ne part chez personne : elle sert à se remettre une affaire en
  tête en trente secondes. Un modèle intermédiaire y suffit, et comme elle ne
  se régénère que sur un clic, elle ne coûte que quand on s'en sert.
*/
const MODELE = "claude-sonnet-5";

export const Synthese = z.object({
  situation: z.string().describe("Où en est l'affaire, en deux ou trois phrases."),
  besoin: z.string().describe("Le besoin et l'enjeu du client, tels qu'exprimés."),
  interlocuteurs: z.array(z.string()).describe("« Prénom Nom — rôle, posture » pour chaque interlocuteur connu."),
  jalons: z
    .array(z.object({ date: z.string().describe("JJ/MM/AAAA"), fait: z.string() }))
    .describe("Les moments qui comptent, du plus ancien au plus récent."),
  points_ouverts: z.array(z.string()).describe("Objections, risques, questions sans réponse."),
  prochaine_action: z.string().describe("Le geste le plus utile maintenant, concret et daté si possible."),
});

export type SyntheseAffaire = z.infer<typeof Synthese>;

const CONSIGNES = `Tu fais la synthèse d'une affaire commerciale d'Antichaos — petite agence qui forme les PME et bureaux d'études à l'IA et l'intègre dans leurs outils — pour l'un des deux associés, qui veut se la remettre en tête en trente secondes.

On te donne tout ce que le CRM sait : la fiche, l'historique du lead, les notes de rendez-vous, les résumés de calls, les mails échangés, les devis.

Règles :
- N'écris rien qui ne soit pas dans les données. Si une information manque (budget, décideur), dis-le dans les points ouverts plutôt que de la supposer.
- Reprends les chiffres, noms et dates tels qu'ils apparaissent.
- Style télégraphique et précis, sans formule creuse. Pas d'emoji.
- Les jalons : les moments qui ont fait avancer ou reculer l'affaire, pas chaque mail.
- La prochaine action : celle que l'associé devrait faire, pas une généralité.`;

type Admin = NonNullable<ReturnType<typeof createAdminClient>>;

/** Tout ce que le CRM sait de l'affaire, mis en texte et plafonné. */
async function dossier(admin: Admin, dealId: string): Promise<string | null> {
  const { data: deal } = await admin.from("deals").select("*").eq("id", dealId).maybeSingle();
  if (!deal) return null;

  const [entreprise, liens, lead, evenements, calls, mails, devis, recaps] = await Promise.all([
    deal.company_id
      ? admin.from("companies").select("name, sector, activity, headcount, region").eq("id", deal.company_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("deal_contacts").select("role, contacts (full_name, email, job_title)").eq("deal_id", dealId),
    deal.source_lead_id
      ? admin.from("leads").select("comment, status, created_at, converted_at, source").eq("id", deal.source_lead_id).maybeSingle()
      : Promise.resolve({ data: null }),
    deal.source_lead_id
      ? admin
          .from("lead_events")
          .select("kind, from_status, to_status, note, created_at")
          .eq("lead_id", deal.source_lead_id)
          .order("created_at")
          .limit(40)
      : Promise.resolve({ data: [] }),
    admin
      .from("call_records")
      .select("title, started_at, occurred_on, summary")
      .eq("deal_id", dealId)
      .order("occurred_on")
      .limit(10),
    admin
      .from("email_messages")
      .select("direction, from_email, subject, snippet, sent_at")
      .eq("deal_id", dealId)
      .order("sent_at", { ascending: false })
      .limit(30),
    admin.from("devis_pennylane").select("numero, statut, montant_ht, emis_le").eq("deal_id", dealId),
    admin.from("deal_recaps").select("status, sent_at, body").eq("deal_id", dealId).eq("status", "envoye"),
  ]);

  const e = entreprise.data;
  const blocs: string[] = [
    [
      `Affaire : ${deal.name}`,
      `Étape : ${DEAL_STAGE[deal.stage as DealStage]?.label ?? deal.stage} depuis le ${formatDate(deal.stage_changed_at)}`,
      `Montant : ${deal.amount ?? "—"} € HT`,
      `Créée le ${formatDate(deal.created_at)}`,
      deal.next_step ? `Prochaine étape notée : ${deal.next_step}${deal.next_step_on ? ` (le ${formatDate(deal.next_step_on)})` : ""}` : "",
      e ? `Entreprise : ${e.name} — ${[e.sector, e.activity, e.headcount, e.region].filter(Boolean).join(", ")}` : "",
      deal.description ? `Notes libres : ${deal.description}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  ];

  const interlocuteurs = ((liens.data ?? []) as unknown as Array<{
    role: string | null;
    contacts: { full_name: string | null; email: string | null; job_title: string | null } | null;
  }>).map((l) => `- ${l.contacts?.full_name ?? l.contacts?.email} — ${[l.contacts?.job_title, l.role].filter(Boolean).join(", ") || "rôle inconnu"}`);
  if (interlocuteurs.length) blocs.push(`<interlocuteurs>\n${interlocuteurs.join("\n")}\n</interlocuteurs>`);

  if (lead.data) {
    const hist = (evenements.data ?? []).map(
      (ev) =>
        `- ${formatDate(ev.created_at)} : ${ev.to_status ? LEAD_STATUS[ev.to_status as LeadStatus]?.label ?? ev.to_status : ev.kind}${ev.note ? ` — ${ev.note}` : ""}`,
    );
    blocs.push(
      `<prospection>\nLead créé le ${formatDate(lead.data.created_at)}${lead.data.comment ? `\nCommentaire : ${lead.data.comment}` : ""}\n${hist.join("\n")}\n</prospection>`,
    );
  }

  if (deal.note_r1) blocs.push(`<note_r1>\n${htmlEnTexte(deal.note_r1).slice(0, 6000)}\n</note_r1>`);
  if (deal.note_r2) blocs.push(`<note_r2>\n${htmlEnTexte(deal.note_r2).slice(0, 6000)}\n</note_r2>`);

  for (const c of calls.data ?? []) {
    blocs.push(
      `<call titre="${c.title ?? "sans titre"}" date="${formatDateHeure(c.started_at ?? c.occurred_on, { avecAnnee: true })}">\n${(c.summary ?? "pas de résumé").slice(0, 4000)}\n</call>`,
    );
  }

  const fil = (mails.data ?? [])
    .reverse()
    .map((m) => `- ${formatDate(m.sent_at)} ${m.direction === "outbound" ? "→ envoyé" : "← reçu"} « ${m.subject ?? ""} » : ${(m.snippet ?? "").slice(0, 200)}`);
  if (fil.length) blocs.push(`<mails>\n${fil.join("\n")}\n</mails>`);

  const d = (devis.data ?? []).map((x) => `- ${x.numero ?? "devis"} : ${x.statut}, ${x.montant_ht ?? "?"} € HT, émis le ${formatDate(x.emis_le)}`);
  if (d.length) blocs.push(`<devis>\n${d.join("\n")}\n</devis>`);

  for (const r of recaps.data ?? []) {
    blocs.push(`<recap_envoye date="${formatDate(r.sent_at)}">\n${(r.body ?? "").slice(0, 3000)}\n</recap_envoye>`);
  }

  return blocs.join("\n\n");
}

export async function synthetiser(dealId: string): Promise<{ synthese: SyntheseAffaire; modele: string }> {
  const admin = createAdminClient();
  if (!admin) throw new Error("Clé de service absente.");
  const texte = await dossier(admin, dealId);
  if (!texte) throw new Error("Affaire introuvable.");

  const reponse = await anthropicClient().messages.parse({
    model: MODELE,
    max_tokens: 8000,
    system: CONSIGNES,
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: zodOutputFormat(Synthese) },
    messages: [{ role: "user", content: `Aujourd'hui : ${formatDate(new Date().toISOString())}\n\n${texte}` }],
  });
  if (reponse.stop_reason === "refusal") throw new Error("Le modèle a refusé de synthétiser cette affaire.");
  const synthese = reponse.parsed_output;
  if (!synthese) throw new Error("Le modèle n'a pas renvoyé de synthèse exploitable.");
  return { synthese, modele: reponse.model };
}
