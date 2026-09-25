import "server-only";

import { composeHtmlRaw, getMessage, getSignature, header, refreshAccessToken, sendMessage } from "@/lib/google";
import { corpsEnHtml } from "@/lib/recap-logique";
import { createAdminClient } from "@/lib/supabase/admin";

const ADRESSE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** Nettoie une liste d'adresses et dit laquelle ne tient pas debout. */
export function adresses(liste: string[]): { ok: string[]; invalide: string | null } {
  const propres = [...new Set(liste.map((a) => a.trim().toLowerCase()).filter(Boolean))];
  return { ok: propres, invalide: propres.find((a) => !ADRESSE.test(a)) ?? null };
}

export type MailAEnvoyer = { to: string[]; cc: string[]; subject: string; body: string };

export type MailEnvoye = { id: string; threadId: string; from: string; to: string[]; cc: string[]; at: string };

/**
 * Envoie un mail écrit dans l'application, depuis la boîte Gmail de la
 * personne qui appuie sur le bouton, avec sa signature.
 *
 * C'est le seul chemin par lequel l'application écrit à un client, et il n'est
 * emprunté que sur un geste explicite, après relecture. Le message se range
 * dans les « Envoyés » de l'expéditeur et rejoint aussitôt le fil de
 * l'affaire, sans attendre la synchro de la nuit.
 */
export async function envoyerDepuisGmail(
  userId: string,
  mail: MailAEnvoyer,
  rattachement: { dealId: string | null },
): Promise<{ ok: true; data: MailEnvoye } | { ok: false; error: string }> {
  const to = adresses(mail.to);
  const cc = adresses(mail.cc);
  if (to.invalide ?? cc.invalide) return { ok: false, error: `Adresse invalide : ${to.invalide ?? cc.invalide}` };
  if (to.ok.length === 0) return { ok: false, error: "Ajoutez au moins un destinataire." };
  if (!mail.subject.trim()) return { ok: false, error: "L'objet est vide." };
  if (!mail.body.trim()) return { ok: false, error: "Le message est vide." };

  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Clé de service absente." };

  const { data: compte } = await admin
    .from("google_accounts")
    .select("email, refresh_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (!compte?.refresh_token) {
    return { ok: false, error: "Connectez votre boîte Gmail dans les Réglages pour envoyer depuis l'application." };
  }

  let envoye: { id: string; threadId: string };
  let accessToken: string;
  try {
    ({ access_token: accessToken } = await refreshAccessToken(compte.refresh_token));
    const signature = await getSignature(accessToken, compte.email);
    envoye = await sendMessage(
      accessToken,
      composeHtmlRaw({
        to: to.ok,
        cc: cc.ok,
        subject: mail.subject.trim(),
        text: mail.body.trim(),
        // La signature Gmail est déjà du HTML, écrit par son propriétaire : on
        // la reprend telle quelle, séparée du corps comme Gmail le fait.
        html: `<div>${corpsEnHtml(mail.body)}${signature ? `<br><div class="gmail_signature">${signature}</div>` : ""}</div>`,
      }),
    );
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Envoi impossible.";
    // Un 403 veut presque toujours dire que la connexion Gmail date d'avant
    // l'autorisation d'envoi : la reconnecter suffit.
    return {
      ok: false,
      error: /\b403\b/.test(message)
        ? "Gmail refuse l'envoi (403) : reconnectez votre boîte dans les Réglages pour accorder l'autorisation d'envoyer."
        : message,
    };
  }

  // Le Message-ID du mail parti : sans lui, la copie reçue par l'associé
  // reviendrait dans le fil de l'affaire comme un second message.
  let rfc: string | null = null;
  try {
    rfc = header(await getMessage(accessToken, envoye.id), "Message-ID").trim() || null;
  } catch {
    rfc = null;
  }

  const at = new Date().toISOString();
  await admin.from("email_messages").upsert(
    {
      deal_id: rattachement.dealId,
      provider: "gmail",
      provider_message_id: envoye.id,
      thread_id: envoye.threadId,
      direction: "outbound",
      from_email: compte.email,
      to_emails: [...to.ok, ...cc.ok],
      subject: mail.subject.trim(),
      snippet: mail.body.replace(/\s+/g, " ").slice(0, 200),
      sent_at: at,
      synced_by: userId,
      rfc_message_id: rfc,
    } as never,
    { onConflict: "provider,provider_message_id", ignoreDuplicates: true },
  );

  return { ok: true, data: { ...envoye, from: compte.email, to: to.ok, cc: cc.ok, at } };
}
