import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Couche d'accès à Pennylane.
 *
 * La documentation n'est pas joignable depuis l'environnement où ce code a été
 * écrit. Plutôt que de deviner la forme des requêtes — sur un système qui
 * produit des documents légaux et engage de l'argent, deviner serait
 * irresponsable — deux principes tiennent lieu de garde-fou :
 *
 * 1. Chaque appel est journalisé intégralement, requête et réponse. Un devis
 *    ou une facture doit pouvoir être expliqué après coup.
 * 2. Rien n'est envoyé au client. On ne crée que des brouillons ; c'est depuis
 *    Pennylane, après relecture, que les documents partent.
 *
 * Les chemins ci-dessous sont ceux que le sondage aura confirmés. Tant qu'ils
 * ne le sont pas, `pennylaneReady()` répond faux et l'application se contente
 * de préparer les documents sans rien pousser.
 */

const BASE = "https://app.pennylane.com/api/external/v2";

export function pennylaneKey(): string | null {
  const key = process.env.PENNYLANE_API_KEY?.trim();
  return key ? key : null;
}

/**
 * Un garde-fou explicite : tant qu'il n'est pas levé, aucun appel n'est tenté.
 * Il évite qu'une intégration à moitié vérifiée crée des documents réels.
 */
export function pennylaneReady(): boolean {
  return Boolean(pennylaneKey()) && process.env.PENNYLANE_ENABLED?.trim() === "true";
}

export type PennylaneCall = {
  operation: string;
  method: "GET" | "POST" | "PUT";
  path: string;
  body?: unknown;
  dossierId?: string;
  invoiceId?: string;
};

export type PennylaneResult<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

/** Journalise l'échange, quel qu'en soit l'issue. */
async function record(call: PennylaneCall, status: number, ok: boolean, response: unknown, detail?: string) {
  const admin = createAdminClient();
  if (!admin) return;

  await admin.from("pennylane_events").insert({
    direction: "sortant",
    operation: call.operation,
    dossier_id: call.dossierId ?? null,
    invoice_id: call.invoiceId ?? null,
    http_status: status,
    ok,
    request: { method: call.method, path: call.path, body: call.body ?? null } as never,
    response: (response ?? null) as never,
    detail: detail ?? null,
  });
}

export async function callPennylane<T = unknown>(call: PennylaneCall): Promise<PennylaneResult<T>> {
  const key = pennylaneKey();
  if (!key) {
    await record(call, 0, false, null, "Clé PENNYLANE_API_KEY absente.");
    return { ok: false, status: 0, error: "Clé PENNYLANE_API_KEY absente." };
  }

  try {
    const response = await fetch(`${BASE}${call.path}`, {
      method: call.method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: call.body ? JSON.stringify(call.body) : undefined,
    });

    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text.slice(0, 1000) };
    }

    await record(call, response.status, response.ok, data);

    return response.ok
      ? { ok: true, status: response.status, data: data as T }
      : { ok: false, status: response.status, error: text.slice(0, 400) || `HTTP ${response.status}` };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Appel impossible.";
    await record(call, 0, false, null, message);
    return { ok: false, status: 0, error: message };
  }
}

/**
 * Sonde l'API depuis le serveur, qui l'atteint — contrairement à
 * l'environnement de développement. Lecture seule : aucun document n'est créé.
 */
export async function probePennylane(): Promise<
  Array<{ path: string; status: number; ok: boolean; preview: string }>
> {
  const key = pennylaneKey();
  if (!key) return [];

  const paths = ["/customers?limit=1", "/customer_invoices?limit=1", "/quotes?limit=1"];
  const results: Array<{ path: string; status: number; ok: boolean; preview: string }> = [];

  for (const path of paths) {
    try {
      const response = await fetch(`${BASE}${path}`, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      });
      const text = await response.text();
      results.push({
        path,
        status: response.status,
        ok: response.ok,
        preview: text.slice(0, 400),
      });
    } catch (caught) {
      results.push({
        path,
        status: 0,
        ok: false,
        preview: caught instanceof Error ? caught.message : "échec réseau",
      });
    }
  }

  return results;
}
