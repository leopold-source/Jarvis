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

/** En-têtes conservés pour le diagnostic. Aucun secret n'y figure. */
const LOGGED_HEADERS = [
  "content-type",
  "user-agent",
  "x-claap-signature",
  "x-webhook-signature",
  "x-hub-signature-256",
  "x-claap-event",
  "x-event-type",
];

async function log(
  outcome: string,
  detail: string | null,
  request: NextRequest,
  body: string,
  parsed: unknown,
) {
  const admin = createAdminClient();
  if (!admin) return;

  const headers: Record<string, string> = {};
  for (const name of LOGGED_HEADERS) {
    const value = request.headers.get(name);
    // La signature est tronquée : sa présence est l'information utile, sa
    // valeur complète n'a aucune raison de rester en base.
    if (value) headers[name] = name.includes("signature") ? `${value.slice(0, 12)}…` : value;
  }

  await admin.from("webhook_events").insert({
    source: "claap",
    outcome,
    detail,
    headers: headers as never,
    body: (parsed ?? null) as never,
    body_text: parsed ? null : body.slice(0, 4000),
  });
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const secret = process.env.CLAAP_WEBHOOK_SECRET?.trim();

  if (secret) {
    const provided =
      request.headers.get("x-claap-signature") ??
      request.headers.get("x-webhook-signature") ??
      request.headers.get("x-hub-signature-256");

    if (!provided || !isValidSignature(body, provided, secret)) {
      await log(
        "signature_refusee",
        provided ? "Signature présente mais invalide." : "Aucun en-tête de signature reconnu.",
        request,
        body,
        null,
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

function isValidSignature(body: string, provided: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const clean = provided.replace(/^sha256=/, "");
  const a = Buffer.from(expected);
  const b = Buffer.from(clean);
  return a.length === b.length && timingSafeEqual(a, b);
}
