"use server";

import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import { REGIONS } from "@/lib/constants";
import { requireStaff } from "@/lib/auth";
import {
  MISSING_KEY_ERROR,
  anthropicClient,
  anthropicKey,
  describeAnthropicError,
} from "@/lib/anthropic";

/**
 * Nettoyage d'un import par Claude.
 *
 * Le CSV brut est rarement propre : la région est écrite « IDF » ou absente
 * alors que l'adresse la donne, les noms d'entreprise sont en capitales, les
 * téléphones dans trois formats différents. Plutôt que d'empiler des règles,
 * on confie la normalisation au modèle, avec une consigne stricte : corriger
 * la forme, jamais inventer le fond.
 *
 * Le traitement se fait par lots pour garder des réponses courtes et pouvoir
 * afficher une progression.
 */

const BATCH_SIZE = 25;

/** Ce que le modèle a le droit de renvoyer, et rien d'autre. */
const CleanedLead = z.object({
  index: z.number().int().describe("Index de la ligne dans le lot, à partir de 0"),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  full_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  company_name: z.string().nullable(),
  company_website: z.string().nullable(),
  company_activity: z.string().nullable(),
  sector: z.string().nullable(),
  region: z.string().nullable(),
  address: z.string().nullable(),
  changes: z.array(z.string()).describe("Corrections appliquées, en français, une phrase courte chacune"),
});

const CleanedBatch = z.object({ rows: z.array(CleanedLead) });

const SYSTEM_PROMPT = `Tu ranges des fiches de prospection commerciale importées depuis un CSV.

Ton rôle est de normaliser la FORME des données, jamais d'en inventer le FOND.

Règles impératives :
- N'invente jamais un e-mail, un téléphone, un nom ou une adresse. Si une donnée est absente, renvoie null.
- Ne corrige pas l'orthographe d'un nom de personne : tu risquerais de le fausser.
- Renvoie exactement une entrée par ligne reçue, avec son index d'origine.

Ce que tu dois corriger :
- region : ramène-la à l'une de ces valeurs exactes, et à aucune autre :
  ${REGIONS.join(", ")}.
  Déduis-la de l'adresse ou du code postal quand la région est absente ou mal
  écrite (« IDF » → « Île-de-France », « Haut-de-France » → « Hauts-de-France »,
  « 44100 Nantes » → « Pays de la Loire », « 69003 Lyon » → « Auvergne-Rhône-Alpes »).
  Si tu n'as aucun indice fiable, laisse null plutôt que de deviner.
- phone : format français lisible « +33 6 12 34 56 78 ». Un numéro commençant
  par 0 devient +33 sans le 0. Ne touche pas aux numéros étrangers.
- company_name : casse propre (« ECOTECHNICS » → « Ecotechnics »), en gardant la
  forme juridique si elle est présente. Retire les guillemets parasites.
- company_website : ajoute https:// s'il manque, retire les espaces.
- first_name / last_name : casse propre. Si seul full_name existe, découpe-le
  quand c'est évident ; sinon laisse null.
- company_activity et sector : recopie-les, en corrigeant seulement la casse.
  Ne déduis un secteur que s'il est explicite dans l'activité.

Pour chaque ligne, liste dans « changes » les corrections réellement faites.
Une ligne déjà propre a un tableau « changes » vide.`;

export type AiCleanResult =
  | {
      ok: true;
      rows: Array<Record<string, string | number | null>>;
      changes: Array<{ index: number; label: string; changes: string[] }>;
    }
  | { ok: false; error: string };

export async function cleanRowsWithAi(
  rows: Array<Record<string, string | number | null>>,
  extraInstruction?: string,
): Promise<AiCleanResult> {
  await requireStaff();

  if (rows.length === 0) return { ok: false, error: "Aucune ligne à traiter." };
  if (rows.length > 400) {
    return { ok: false, error: "Le nettoyage par IA est limité à 400 lignes à la fois." };
  }
  if (!anthropicKey()) return { ok: false, error: MISSING_KEY_ERROR };

  const client = anthropicClient();
  const cleaned = [...rows];
  const changes: Array<{ index: number; label: string; changes: string[] }> = [];

  try {
    for (let start = 0; start < rows.length; start += BATCH_SIZE) {
      const batch = rows.slice(start, start + BATCH_SIZE);

      const payload = batch.map((row, index) => ({
        index,
        first_name: row.first_name ?? null,
        last_name: row.last_name ?? null,
        full_name: row.full_name ?? null,
        email: row.email ?? null,
        phone: row.phone ?? null,
        company_name: row.company_name ?? null,
        company_website: row.company_website ?? null,
        company_activity: row.company_activity ?? null,
        sector: row.sector ?? null,
        region: row.region ?? null,
        address: row.address ?? null,
      }));

      const response = await client.messages.parse({
        model: "claude-opus-5",
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        thinking: { type: "adaptive" },
        output_config: {
          effort: "low",
          format: zodOutputFormat(CleanedBatch),
        },
        messages: [
          {
            role: "user",
            content:
              (extraInstruction?.trim()
                ? `Consigne supplémentaire de l'utilisateur : ${extraInstruction.trim()}\n\n`
                : "") + `Lignes à ranger :\n${JSON.stringify(payload, null, 1)}`,
          },
        ],
      });

      const parsed = response.parsed_output;
      if (!parsed) {
        return { ok: false, error: "Le modèle n'a pas renvoyé de résultat exploitable." };
      }

      for (const row of parsed.rows) {
        const target = start + row.index;
        if (target < 0 || target >= cleaned.length) continue;

        const { index: _index, changes: rowChanges, ...fields } = row;
        void _index;

        // Le modèle ne peut que renseigner ou corriger : il ne vide jamais un
        // champ qui avait une valeur.
        for (const [key, value] of Object.entries(fields)) {
          if (value !== null && value !== "") cleaned[target] = { ...cleaned[target], [key]: value };
        }

        if (rowChanges.length > 0) {
          changes.push({
            index: target,
            label: String(cleaned[target].full_name ?? cleaned[target].email ?? `Ligne ${target + 1}`),
            changes: rowChanges,
          });
        }
      }
    }
  } catch (caught) {
    return { ok: false, error: describeAnthropicError(caught) };
  }

  return { ok: true, rows: cleaned, changes };
}
