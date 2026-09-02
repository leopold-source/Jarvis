import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

import { normalizeClaapPayload } from "@/lib/claap";
import { attachCall } from "@/lib/claap-sync";

/**
 * Réception des événements Claap (`recording_added`, `recording_updated`).
 *
 * Le corps brut est lu avant tout parsing : une signature HMAC se vérifie sur
 * les octets reçus, et re-sérialiser le JSON changerait l'empreinte.
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  const secret = process.env.CLAAP_WEBHOOK_SECRET?.trim();

  if (secret) {
    // On accepte les en-têtes usuels : Claap peut nommer le sien autrement,
    // et une signature absente doit être refusée, pas ignorée.
    const provided =
      request.headers.get("x-claap-signature") ??
      request.headers.get("x-webhook-signature") ??
      request.headers.get("x-hub-signature-256");

    if (!provided || !isValidSignature(body, provided, secret)) {
      return NextResponse.json({ error: "signature invalide" }, { status: 401 });
    }
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "corps illisible" }, { status: 400 });
  }

  const call = normalizeClaapPayload(raw);
  if (!call) {
    // On répond 200 : un événement qu'on ne sait pas lire ne doit pas pousser
    // Claap à réessayer indéfiniment.
    return NextResponse.json({ status: "ignore", reason: "identifiant absent" });
  }

  const outcome = await attachCall(call, raw);
  return NextResponse.json(outcome);
}

function isValidSignature(body: string, provided: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const clean = provided.replace(/^sha256=/, "");
  const a = Buffer.from(expected);
  const b = Buffer.from(clean);
  return a.length === b.length && timingSafeEqual(a, b);
}
