"use server";

import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { REGIONS } from "@/lib/constants";
import { requireStaff } from "@/lib/auth";
import { MISSING_KEY_ERROR, anthropicClient, anthropicKey, describeAnthropicError } from "@/lib/anthropic";

/**
 * Classement libre d'un import.
 *
 * Distinct du nettoyage, qui corrige la *forme* sans jamais créer de valeur.
 * Ici on demande au contraire une valeur nouvelle, déduite de la ligne selon
 * une consigne écrite par l'utilisateur : « déduis la région de l'adresse »,
 * « range par taille d'entreprise », « marque ceux du BTP ».
 *
 * Deux garde-fous, parce qu'un classement libre invente vite :
 * chaque ligne doit porter la raison de son classement, et le champ écrit est
 * choisi dans une liste — on ne laisse jamais le modèle décider *où* il écrit.
 */

/** Colonnes qu'un classement a le droit de renseigner. */
export const ORGANIZE_TARGETS = {
  segment: { label: "Campagne / segment", hint: "Un libellé court de regroupement" },
  region: { label: "Région", hint: `Une des ${REGIONS.length} régions françaises` },
  sector: { label: "Secteur", hint: "Le secteur d'activité" },
  comment: { label: "Commentaire", hint: "Une note libre" },
} as const;

export type OrganizeTarget = keyof typeof ORGANIZE_TARGETS;

const BATCH_SIZE = 30;

const Assignment = z.object({
  index: z.number().int().describe("Index de la ligne dans le lot, à partir de 0"),
  valeur: z.string().nullable().describe("La valeur attribuée, ou null si la consigne ne s'applique pas"),
  raison: z.string().describe("Ce qui, dans la ligne, justifie cette valeur. Très court."),
});

const Batch = z.object({ lignes: z.array(Assignment) });

export type OrganizeRow = { index: number; valeur: string | null; raison: string };

export type OrganizeResult =
  | {
      ok: true;
      target: OrganizeTarget;
      rows: OrganizeRow[];
      /** Répartition obtenue, pour juger le classement avant de l'appliquer. */
      distribution: Array<{ valeur: string; nombre: number }>;
    }
  | { ok: false; error: string };

function systemPrompt(target: OrganizeTarget, instruction: string): string {
  const constraint =
    target === "region"
      ? `\nLa valeur doit être exactement l'une de celles-ci, et aucune autre :\n${REGIONS.join(", ")}.`
      : "";

  return `Tu classes des fiches de prospection commerciale importées depuis un fichier.

L'utilisateur te donne une consigne de classement. Tu l'appliques ligne par
ligne et tu renseignes un seul champ : « ${ORGANIZE_TARGETS[target].label} ».

Consigne de l'utilisateur :
${instruction}
${constraint}

Règles impératives :
- Tu ne déduis que de ce que la ligne contient. Aucune connaissance extérieure
  sur l'entreprise, aucune supposition sur son activité.
- Si la ligne ne permet pas de trancher, renvoie null. Une valeur inventée coûte
  plus cher qu'une case vide : elle sera prise pour un fait.
- « raison » cite l'élément de la ligne qui justifie le classement, en quelques
  mots. Si tu ne sais pas quoi y écrire, c'est que la valeur doit être null.
- Reste cohérent d'une ligne à l'autre : les mêmes libellés pour les mêmes cas,
  sans variantes de casse ni synonymes.
- Renvoie exactement une entrée par ligne reçue, avec son index d'origine.`;
}

export async function organizeRowsWithAi(
  rows: Array<Record<string, string | number | null>>,
  instruction: string,
  target: OrganizeTarget,
): Promise<OrganizeResult> {
  await requireStaff();

  if (!instruction.trim()) return { ok: false, error: "Écrivez la consigne de classement." };
  if (rows.length === 0) return { ok: false, error: "Aucune ligne à classer." };
  if (rows.length > 400) return { ok: false, error: "Le classement est limité à 400 lignes à la fois." };
  if (!anthropicKey()) return { ok: false, error: MISSING_KEY_ERROR };

  const client = anthropicClient();
  const assignments: OrganizeRow[] = [];

  try {
    for (let start = 0; start < rows.length; start += BATCH_SIZE) {
      const batch = rows.slice(start, start + BATCH_SIZE);

      const response = await client.messages.parse({
        // Un classement à partir de champs déjà présents est une tâche de
        // lecture, pas de raisonnement : le modèle rapide suffit et permet de
        // relancer plusieurs fois pour ajuster la consigne.
        model: "claude-haiku-4-5",
        max_tokens: 4000,
        system: systemPrompt(target, instruction.trim()),
        output_config: { format: zodOutputFormat(Batch) },
        messages: [
          {
            role: "user",
            content: `Lignes à classer :\n${JSON.stringify(
              batch.map((row, index) => ({ index, ...row })),
              null,
              0,
            )}`,
          },
        ],
      });

      const parsed = response.parsed_output;
      if (!parsed) return { ok: false, error: "Le modèle n'a pas renvoyé de classement exploitable." };

      for (const line of parsed.lignes) {
        const absolute = start + line.index;
        if (absolute < 0 || absolute >= rows.length) continue;
        assignments.push({ index: absolute, valeur: line.valeur?.trim() || null, raison: line.raison });
      }
    }
  } catch (caught) {
    return { ok: false, error: describeAnthropicError(caught) };
  }

  const counts = new Map<string, number>();
  for (const row of assignments) {
    if (!row.valeur) continue;
    counts.set(row.valeur, (counts.get(row.valeur) ?? 0) + 1);
  }

  return {
    ok: true,
    target,
    rows: assignments,
    distribution: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([valeur, nombre]) => ({ valeur, nombre })),
  };
}
