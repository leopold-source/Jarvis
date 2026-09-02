import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

import { notify } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Événements Pennylane — signature de devis, facture payée.
 *
 * Un devis signé ne déclenche PAS l'envoi d'une facture : il la prépare en
 * brouillon et prévient. C'est le point de contrôle voulu tant que
 * l'intégration n'a pas fait ses preuves.
 *
 * Comme pour Claap, tout est journalisé, y compris ce qu'on refuse : sur de la
 * facturation, un événement perdu sans trace est une facture qui n'existera
 * jamais et que personne ne cherchera.
 */

async function log(operation: string, ok: boolean, body: unknown, detail: string) {
  const admin = createAdminClient();
  if (!admin) return;
  await admin.from("pennylane_events").insert({
    direction: "entrant",
    operation,
    ok,
    response: (body ?? null) as never,
    detail,
  });
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  const secret = process.env.PENNYLANE_WEBHOOK_SECRET?.trim();

  if (secret) {
    const provided =
      request.headers.get("x-pennylane-signature") ??
      request.headers.get("x-hub-signature-256") ??
      request.headers.get("x-webhook-signature");

    if (!provided || !valid(raw, provided, secret)) {
      await log("webhook", false, safeParse(raw), "Signature absente ou invalide.");
      return NextResponse.json({ error: "signature invalide" }, { status: 401 });
    }
  }

  const payload = safeParse(raw) as Record<string, unknown> | null;
  if (!payload) {
    await log("webhook", false, { raw: raw.slice(0, 500) }, "Corps illisible.");
    return NextResponse.json({ error: "corps illisible" }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!admin) {
    await log("webhook", false, payload, "Clé service_role absente.");
    return NextResponse.json({ error: "indisponible" }, { status: 500 });
  }

  // Lecture défensive : les noms de champs varient d'un fournisseur à l'autre
  // et la doc n'a pas pu être consultée. Le corps brut reste journalisé pour
  // pouvoir corriger sans perdre l'événement.
  const event = String(payload.event ?? payload.type ?? payload.event_type ?? "");
  const object = (payload.data ?? payload.object ?? payload) as Record<string, unknown>;
  const quoteId = object.id != null ? String(object.id) : null;

  if (!/signed|accepted|signe/i.test(event) || !quoteId) {
    await log("webhook", true, payload, `Événement ignoré : « ${event || "sans type"} ».`);
    return NextResponse.json({ status: "ignore" });
  }

  const { data: dossier } = await admin
    .from("dossiers")
    .select("id, code")
    .eq("pennylane_quote_id", quoteId)
    .maybeSingle();

  if (!dossier) {
    await log("webhook", false, payload, `Aucun dossier pour le devis ${quoteId}.`);
    return NextResponse.json({ status: "inconnu" });
  }

  // La signature date les échéances : le trigger `dossiers_date_echeances`
  // s'en charge, on ne fait que poser l'horodatage.
  await admin
    .from("dossiers")
    .update({ quote_signed_at: new Date().toISOString(), quote_review: "envoye" })
    .eq("id", dossier.id);

  // La première échéance passe en attente de relecture, pas en facture émise.
  const { data: first } = await admin
    .from("invoices")
    .select("id, label")
    .eq("dossier_id", dossier.id)
    .eq("status", "prevue")
    .order("position")
    .limit(1)
    .maybeSingle();

  if (first) {
    await admin.from("invoices").update({ review: "a_valider" }).eq("id", first.id);
  }

  await log("webhook", true, payload, `Devis ${dossier.code} signé.`);

  await notify(
    `Devis ${dossier.code} signé — facture à préparer`,
    [
      `Le devis <strong>${dossier.code}</strong> vient d'être signé.`,
      first
        ? `L'échéance <strong>${first.label}</strong> attend votre validation avant d'être créée en brouillon chez Pennylane.`
        : "Aucune échéance en attente sur ce dossier.",
      "Rien n'a été envoyé au client.",
    ],
    "https://antichaos.dev/facturation",
  );

  return NextResponse.json({ status: "traite", dossier: dossier.code });
}

function safeParse(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function valid(body: string, provided: string, secret: string): boolean {
  const clean = provided.replace(/^sha256=/i, "").trim();
  const received = Buffer.from(clean);
  return (["hex", "base64"] as const).some((encoding) => {
    const expected = Buffer.from(createHmac("sha256", secret).update(body).digest(encoding));
    return expected.length === received.length && timingSafeEqual(expected, received);
  });
}
