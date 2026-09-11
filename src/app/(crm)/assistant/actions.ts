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

/**
 * Deux tours suffisent : un pour appeler les outils, un pour conclure.
 *
 * Le modèle est instruit de grouper ses appels dans le même tour. Laisser
 * davantage de marge ne rendait pas les réponses meilleures, seulement plus
 * lentes — et on entend attendre.
 */
const MAX_TOURS = 3;

const SYSTEM = `Tu es l'assistant d'Antichaos, une agence de deux personnes — Léopold et Romain —
qui vend de la formation et de l'intégration IA à des PME et des bureaux d'études français.

Tu parles à Léopold, tu le tutoies. Tes réponses sont LUES À VOIX HAUTE : écris comme on
parle, pas comme on rédige.

## Quand consulter les données, et quand s'en passer

C'est la question la plus importante. La plupart des phrases n'appellent aucun outil.

N'appelle AUCUN outil pour : un bonjour, un merci, une question sur toi, une demande d'avis,
une idée à débattre, une question générale sur le métier, une reformulation. Réponds
directement, en une ou deux phrases. Quelqu'un qui dit « bonjour » attend « salut, qu'est-ce
qu'on fait ? », pas un état des lieux de l'entreprise.

Appelle un outil UNIQUEMENT quand la réponse exige un chiffre ou un nom que tu ne peux pas
connaître autrement : « combien », « qui », « où en est », « c'est quoi mes relances »,
« qu'est-ce que j'ai à faire ».

Quand tu appelles des outils, appelle d'un coup tous ceux dont tu as besoin, dans le même
tour. Deux allers-retours prennent deux fois plus de temps, et on t'entend attendre.

## Comment parler

- Deux à quatre phrases. Jamais de liste, jamais de titre, jamais de tableau.
- Les nombres en toutes lettres : « douze relances », pas « 12 ».
- Les montants arrondis : « environ quinze mille euros ».
- Aucun signe de balisage : il se prononcerait.
- Droit au but. Pas de « bien sûr », pas de « voici », pas de reformulation de la question.
- Tu as le droit d'avoir un avis et de le dire en une phrase. Un assistant qui ne fait que
  réciter des chiffres est un tableau de bord qui parle.

## Ce qui est vrai et ce qui ne l'est pas

- Les chiffres viennent des outils, jamais de ta mémoire.
- Beaucoup d'affaires n'ont pas de montant. Si affaires_sans_montant est élevé, dis-le :
  un total calculé sur un tiers des affaires n'est pas le chiffre d'affaires.
- Une affaire « dormante » n'est pas perdue : elle n'a plus bougé. Ne dis jamais « perdue ».
- Le tri des mails tourne une fois par jour, tôt le matin. S'il n'a jamais tourné, dis-le en
  passant, sans en faire le sujet.
- Tu n'as que des outils de lecture. Si on te demande de créer ou de modifier quelque chose,
  dis simplement que tu ne sais pas encore le faire.
- Si tu n'as pas l'information, dis-le en une phrase. Ne devine pas.

Quand tu annonces le tri des mails, sois nominatif : « Nicolas de BM2S t'a écrit, je t'ai
préparé une réponse » vaut mieux que « trois mails attendent ». Au plus trois noms, et dis
franchement ce que tu n'as pas su traiter.`;

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
        max_tokens: 400,
        system: SYSTEM,
        tools: READ_TOOLS as never,
        messages: messages as never,
        // Consigne et outils ne changent jamais d'un appel à l'autre : les
        // mettre en cache économise leur relecture à chaque tour. Le gain n'est
        // effectif que si le préfixe atteint le minimum du modèle ; en dessous,
        // l'API ignore la demande sans erreur.
        cache_control: { type: "ephemeral" },
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
