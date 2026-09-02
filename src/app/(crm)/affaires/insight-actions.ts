"use server";

import { revalidatePath } from "next/cache";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { requireStaff } from "@/lib/auth";
import { MISSING_KEY_ERROR, anthropicClient, anthropicKey, describeAnthropicError } from "@/lib/anthropic";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Dépouillement d'un call.
 *
 * Claap produit déjà un résumé dense — points clés, actions, montants cités,
 * objections. On n'a donc ni à récupérer le transcript, ni à le résumer : il
 * reste à en tirer des champs *comparables* d'un call à l'autre. C'est cette
 * comparabilité qui permet de dire « l'objection budget revient dans 7 des 12
 * no-shows », ce qu'aucune lecture individuelle ne donnerait.
 *
 * Un modèle rapide suffit : le travail d'analyse a déjà été fait en amont,
 * celui-ci ne fait que ranger.
 */

const Insights = z.object({
  besoin_principal: z.string().describe("Le besoin exprimé par le prospect, en une phrase"),
  objections: z.array(z.string()).describe("Objections et réticences soulevées, courtes"),
  blocages: z
    .array(z.enum(["budget", "timing", "technique", "decideur_absent", "priorite", "confiance", "aucun"]))
    .describe("Nature des freins identifiés"),
  signaux_achat: z.array(z.string()).describe("Ce qui indique un intérêt réel"),
  montant_evoque: z.number().nullable().describe("Montant en euros cité pendant l'échange, sinon null"),
  prochaine_etape: z.string().nullable().describe("Ce qui a été convenu, sinon null"),
  engagement: z.enum(["fort", "moyen", "faible"]).describe("Niveau d'engagement du prospect"),
  verbatims: z.array(z.string()).max(3).describe("Une à trois citations marquantes du prospect"),
});

export type CallInsights = z.infer<typeof Insights>;

const SYSTEM_PROMPT = `Tu dépouilles le compte rendu d'un rendez-vous commercial, pour une
agence qui vend de la formation et de l'intégration IA à des PME industrielles
et des bureaux d'études.

On te donne le résumé du rendez-vous. Tu en extrais des champs structurés.

Règles :
- N'invente rien. Ce qui n'est pas dans le résumé vaut null ou tableau vide.
- Les objections sont celles du PROSPECT, pas les doutes du commercial.
- « engagement » se juge sur des actes annoncés, pas sur la politesse : un
  « je vous rappelle dans six mois » est faible, un créneau fixé est fort.
- « verbatims » ne reprend que des propos du prospect, tels quels.
- « montant_evoque » retient le prix discuté pour la prestation, pas un
  chiffre d'affaires ou une économie estimée.`;

export type InsightResult = { ok: true; done: number } | { ok: false; error: string };

/**
 * Dépouille les calls qui ont un résumé mais pas encore de fiche.
 *
 * Traitement par lots plafonnés : une Server Action a un temps d'exécution
 * borné, et un rattrapage sur tout l'historique le dépasserait.
 */
export async function extractCallInsights(limit = 15): Promise<InsightResult> {
  await requireStaff();
  if (!anthropicKey()) return { ok: false, error: MISSING_KEY_ERROR };

  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Clé SUPABASE_SERVICE_ROLE_KEY absente." };

  const { data: calls } = await admin
    .from("call_records")
    .select("id, title, summary")
    .not("summary", "is", null)
    .is("insights", null)
    .limit(limit);

  if (!calls || calls.length === 0) return { ok: true, done: 0 };

  const model = "claude-haiku-4-5";
  const client = anthropicClient();
  let done = 0;

  for (const call of calls) {
    try {
      const response = await client.messages.parse({
        model,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        output_config: { format: zodOutputFormat(Insights) },
        messages: [
          { role: "user", content: `Rendez-vous « ${call.title} »\n\n${call.summary}` },
        ],
      });

      const parsed = response.parsed_output;
      if (!parsed) continue;

      await admin
        .from("call_records")
        .update({
          insights: parsed as never,
          insights_model: model,
          insights_at: new Date().toISOString(),
        })
        .eq("id", call.id);
      done += 1;
    } catch (caught) {
      // Un résumé illisible ne doit pas interrompre le lot : on le laisse sans
      // fiche, il repassera au prochain rattrapage.
      return done > 0
        ? { ok: true, done }
        : { ok: false, error: describeAnthropicError(caught) };
    }
  }

  revalidatePath("/");
  revalidatePath("/affaires");
  return { ok: true, done };
}
