"use server";

import { requireStaff } from "@/lib/auth";
import {
  MISSING_KEY_ERROR,
  anthropicClient,
  anthropicKey,
  describeAnthropicError,
} from "@/lib/anthropic";
import { READ_TOOLS, runReadTool } from "@/app/(crm)/assistant/tools";

/**
 * L'assistant vocal, côté serveur.
 *
 * Le modèle ne voit jamais la base : il demande, on exécute, on lui rend un
 * objet compact. C'est ce qui permet de tenir la dépense — les 432 leads ne
 * traversent jamais le réseau — et c'est aussi ce qui borne ce qu'il peut
 * faire, puisque la liste des outils est la liste exhaustive de ses pouvoirs.
 *
 * Haiku plutôt qu'Opus : répondre « tu as douze relances en retard » est de la
 * restitution, pas du raisonnement. Le modèle rapide suffit, coûte cinq fois
 * moins, et surtout répond assez vite pour qu'une conversation parlée reste
 * une conversation.
 */

/** Trois allers-retours suffisent à enchaîner deux outils et à conclure. */
const MAX_TOURS = 4;

const SYSTEM = `Tu es l'assistant d'Antichaos, une agence de deux personnes (Léopold et Romain)
qui vend de la formation et de l'intégration IA à des PME et des bureaux d'études français.

Tu parles à Léopold, tu le tutoies. Tes réponses sont LUES À VOIX HAUTE : écris donc comme on
parle, pas comme on rédige.

Règles de parole :
- Deux à quatre phrases. Jamais de liste à puces, jamais de tableau, jamais de titre.
- Les nombres en toutes lettres quand ils sont courts : « douze relances », pas « 12 relances ».
- Les montants arrondis et parlés : « environ quinze mille euros », pas « 15 000,00 € ».
- Pas de balisage : ni gras, ni astérisque, ni emoji. Tout signe se prononcerait.
- Va droit au fait. Pas de « bien sûr », pas de « voici », pas de reformulation de la question.

Règles de fond :
- Appuie-toi sur les outils, jamais sur ta mémoire. Aucun chiffre ne sort de nulle part.
- Si un outil renvoie une liste vide, dis-le simplement plutôt que de meubler.
- Beaucoup d'affaires n'ont pas de montant renseigné. Quand tu donnes un total, précise-le si
  le champ affaires_sans_montant est élevé : un total calculé sur un tiers des affaires n'est
  pas le chiffre d'affaires.
- Une affaire « dormante » n'est pas perdue : elle n'a plus bougé depuis le délai fixé. Ne dis
  jamais qu'elle est perdue.
- Tu n'as que des outils de lecture. Si on te demande de créer, modifier ou supprimer quoi que
  ce soit, dis que tu ne sais pas encore le faire.
- Si tu n'as pas l'information, dis-le en une phrase. Ne devine pas.

Quand tu annonces le tri des mails, sois nominatif : « Nicolas de BM2S t'a écrit, je t'ai
préparé une réponse » vaut mieux que « trois mails attendent ». Cite au plus trois noms, et
dis franchement ce que tu n'as pas su traiter — c'est l'information la plus utile.`;

export type AssistantTurn = { role: "user" | "assistant"; content: string };

export type AssistantReply =
  | { ok: true; texte: string; outils: string[]; cout_centimes: number }
  | { ok: false; error: string };

export async function demanderAssistant(
  question: string,
  historique: AssistantTurn[] = [],
): Promise<AssistantReply> {
  await requireStaff();

  const demande = question.trim();
  if (!demande) return { ok: false, error: "Je n'ai rien entendu." };
  if (!anthropicKey()) return { ok: false, error: MISSING_KEY_ERROR };

  const client = anthropicClient();
  const outilsUtilises: string[] = [];

  // On ne renvoie que les derniers échanges : une conversation parlée se
  // souvient de son contexte immédiat, pas de la séance d'hier.
  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [
    ...historique.slice(-6).map((tour) => ({ role: tour.role, content: tour.content })),
    { role: "user" as const, content: demande },
  ];

  let entree = 0;
  let sortie = 0;

  try {
    for (let tour = 0; tour < MAX_TOURS; tour += 1) {
      const reponse = await client.messages.create({
        // Haiku 4.5 n'accepte ni `thinking: adaptive` ni `output_config.effort` :
        // les lui passer ferait échouer la requête.
        model: "claude-haiku-4-5",
        max_tokens: 700,
        system: SYSTEM,
        tools: READ_TOOLS as never,
        messages: messages as never,
      });

      entree += reponse.usage.input_tokens;
      sortie += reponse.usage.output_tokens;

      if (reponse.stop_reason !== "tool_use") {
        const texte = reponse.content
          .filter((bloc): bloc is { type: "text"; text: string; citations: never } =>
            bloc.type === "text")
          .map((bloc) => bloc.text)
          .join(" ")
          .trim();

        return {
          ok: true,
          texte: texte || "Je n'ai pas de réponse à te donner là-dessus.",
          outils: outilsUtilises,
          // Haiku 4.5 : 1 $ / million en entrée, 5 $ en sortie. Converti en
          // centimes d'euro à la louche, pour surveiller la dérive, pas pour
          // tenir une comptabilité.
          cout_centimes: Math.round(((entree * 1e-6 + sortie * 5e-6) * 100) * 100) / 100,
        };
      }

      // Les appels d'un même tour partent ensemble : leurs résultats doivent
      // revenir dans un seul message, sinon le modèle cesse de paralléliser.
      const resultats = [];
      for (const bloc of reponse.content) {
        if (bloc.type !== "tool_use") continue;
        outilsUtilises.push(bloc.name);
        const donnees = await runReadTool(bloc.name, bloc.input as Record<string, unknown>);
        resultats.push({
          type: "tool_result" as const,
          tool_use_id: bloc.id,
          content: JSON.stringify(donnees),
        });
      }

      messages.push({ role: "assistant", content: reponse.content });
      messages.push({ role: "user", content: resultats });
    }

    return { ok: false, error: "Je me suis perdu en chemin, reformule ta question." };
  } catch (caught) {
    return { ok: false, error: describeAnthropicError(caught) };
  }
}
