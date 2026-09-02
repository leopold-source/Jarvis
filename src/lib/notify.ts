import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Notification d'un événement qui demande une relecture humaine.
 *
 * Deux canaux, et l'ordre compte. La file « à valider » dans l'application est
 * le canal fiable : elle ne dépend d'aucun fournisseur, ne se perd pas dans un
 * dossier spam et reste consultable. L'e-mail n'est qu'un rappel qui pousse
 * vers elle — s'il n'est pas configuré, rien n'est perdu.
 */

const FROM = process.env.NOTIFY_FROM?.trim() || "Jarvis <jarvis@antichaos.dev>";
const TO = process.env.NOTIFY_TO?.trim() || "leopold@antichaos.fr";

export type NotifyResult = { sent: boolean; detail: string };

export async function notify(subject: string, lines: string[], link?: string): Promise<NotifyResult> {
  const key = process.env.RESEND_API_KEY?.trim();

  // La trace en base est prise dans tous les cas : c'est elle qui alimente la
  // file de relecture, l'e-mail n'en est que l'écho.
  const admin = createAdminClient();
  if (admin) {
    await admin.from("pennylane_events").insert({
      direction: "entrant",
      operation: "notification",
      ok: true,
      detail: subject,
      response: { lines, link: link ?? null } as never,
    });
  }

  if (!key) return { sent: false, detail: "RESEND_API_KEY absente : notification en base seulement." };

  const html = [
    `<p>${lines.join("<br>")}</p>`,
    link ? `<p><a href="${link}">Ouvrir dans le CRM</a></p>` : "",
    `<p style="color:#888;font-size:12px">Rien n'a été envoyé au client. Ce document attend votre relecture.</p>`,
  ].join("");

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [TO], subject, html }),
    });

    if (!response.ok) {
      return { sent: false, detail: `Resend ${response.status} : ${(await response.text()).slice(0, 200)}` };
    }
    return { sent: true, detail: `Envoyé à ${TO}.` };
  } catch (caught) {
    return { sent: false, detail: caught instanceof Error ? caught.message : "Envoi impossible." };
  }
}
