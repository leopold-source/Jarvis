import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

import { normalizeClaapPayload } from "@/lib/claap";
import { attachCall } from "@/lib/claap-sync";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Réception des événements Claap (`recording_added`, `recording_updated`).
 *
 * Le corps brut est lu avant tout parsing : une signature HMAC se vérifie sur
 * les octets reçus, et re-sérialiser le JSON changerait l'empreinte.
 *
 * Chaque requête est journalisée, y compris celles qu'on refuse : un webhook
 * rejeté qui ne laisse aucune trace transforme le diagnostic en devinette.
 */

/**
 * Noms d'en-têtes dont la valeur est masquée.
 *
 * On journalise *tous* les en-têtes, pas une liste choisie d'avance : si le
 * fournisseur signe avec un nom qu'on n'avait pas prévu, une allowlist le
 * rejetterait sans jamais révéler lequel — exactement le cas qu'on cherche à
 * diagnostiquer. Les valeurs sensibles sont tronquées, jamais leur nom.
 */
const SENSITIVE = /signature|secret|token|authorization|api-?key/i;

function collectHeaders(request: NextRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    if (name === "cookie") return;
    headers[name] = SENSITIVE.test(name) ? `${value.slice(0, 10)}… (${value.length} car.)` : value;
  });
  return headers;
}

/** Tout en-tête qui ressemble à une signature, quel que soit son nom. */
function signatureHeaders(request: NextRequest): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  request.headers.forEach((value, name) => {
    if (/signature|digest/i.test(name)) found.push([name, value]);
  });
  return found;
}

async function log(
  outcome: string,
  detail: string | null,
  request: NextRequest,
  body: string,
  parsed: unknown,
) {
  const admin = createAdminClient();
  if (!admin) return;

  await admin.from("webhook_events").insert({
    source: "claap",
    outcome,
    detail,
    headers: collectHeaders(request) as never,
    body: (parsed ?? null) as never,
    body_text: parsed ? null : body.slice(0, 4000),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const secret = process.env.CLAAP_WEBHOOK_SECRET?.trim();

  if (secret) {
    const candidates = signatureHeaders(request);

    if (candidates.length === 0) {
      // Aucun en-tête de signature : plutôt que de rejeter en aveugle, on
      // enregistre la requête pour pouvoir lire ce que le fournisseur envoie
      // réellement, puis on refuse.
      await log(
        "signature_absente",
        "Aucun en-tête ressemblant à une signature. Voir « headers » pour ce que Claap envoie.",
        request,
        body,
        safeParse(body),
      );
      return NextResponse.json({ error: "signature absente" }, { status: 401 });
    }

    const accepted = candidates.some(([, value]) => isValidSignature(body, value, secret));
    if (!accepted) {
      await log(
        "signature_refusee",
        `Signature présente (${candidates.map(([name]) => name).join(", ")}) mais aucune ne correspond au secret.`,
        request,
        body,
        safeParse(body),
      );
      return NextResponse.json({ error: "signature invalide" }, { status: 401 });
    }
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(body) as Record<string, unknown>;
  } catch {
    await log("corps_illisible", "Le corps n'est pas du JSON.", request, body, null);
    return NextResponse.json({ error: "corps illisible" }, { status: 400 });
  }

  const call = normalizeClaapPayload(raw);
  if (!call) {
    await log("identifiant_absent", "Aucun identifiant d'enregistrement trouvé.", request, body, raw);
    // On répond 200 : un événement qu'on ne sait pas lire ne doit pas pousser
    // Claap à réessayer indéfiniment.
    return NextResponse.json({ status: "ignore", reason: "identifiant absent" });
  }

  const outcome = await attachCall(call, raw);
  await log(outcome.status, "reason" in outcome ? outcome.reason : call.title, request, body, raw);
  return NextResponse.json(outcome);
}

function safeParse(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * Compare la signature reçue à celle attendue.
 *
 * Deux encodages circulent selon les fournisseurs — hexadécimal et base64 —
 * et le préfixe `sha256=` est optionnel. On accepte les deux plutôt que de
 * faire dépendre l'intégration d'un détail de forme.
 */
function isValidSignature(body: string, provided: string, secret: string): boolean {
  const clean = provided.replace(/^sha256=/i, "").trim();
  const received = Buffer.from(clean);

  // Un Hmac ne se réutilise pas après `digest()` : on en construit un par
  // encodage testé plutôt que de cloner celui déjà consommé.
  return (["hex", "base64"] as const).some((encoding) => {
    const expected = Buffer.from(createHmac("sha256", secret).update(body).digest(encoding));
    return expected.length === received.length && timingSafeEqual(expected, received);
  });
}
