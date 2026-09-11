import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Le récapitulatif du matin, envoyé à chacun sur sa propre adresse.
 *
 * Tant que rien ne sort de l'application, elle ne sert qu'à ceux qui pensent à
 * l'ouvrir — et le tri des mails de sept heures reste invisible jusqu'à ce
 * qu'on aille le chercher. Ce message inverse le sens : c'est lui qui va
 * chercher la personne.
 *
 * Chacun reçoit le sien, à l'adresse de son compte. Un brief est une revue de
 * ce qui attend *quelqu'un* : mutualiser l'envoi reviendrait à donner à Romain
 * les relances de Léopold.
 */

const FROM = process.env.NOTIFY_FROM?.trim() || "Jarvis <jarvis@antichaos.dev>";
const BASE = "https://antichaos.dev";

export type BriefOutcome = { email: string; envoye: boolean; detail: string };

type Admin = NonNullable<ReturnType<typeof createAdminClient>>;

function ligne(valeur: number, singulier: string, pluriel: string): string | null {
  if (valeur <= 0) return null;
  return `${valeur} ${valeur > 1 ? pluriel : singulier}`;
}

async function corps(admin: Admin, userId: string, prenom: string): Promise<string | null> {
  const jour = new Date().toISOString().slice(0, 10);
  const dans7 = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

  const [{ data: tri }, mailsEnAttente, { data: leads }, { data: taches }, { data: sante }] =
    await Promise.all([
      admin
        .from("mail_runs")
        .select("*")
        .eq("user_id", userId)
        .order("started_at", { ascending: false })
        .limit(1),
      admin
        .from("mail_triage")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("review", "en_attente"),
      admin.from("leads").select("full_name, company_name, follow_up_on").not("follow_up_on", "is", null).lte("follow_up_on", jour).order("follow_up_on").limit(5),
      admin.from("tasks").select("title, due_on").neq("status", "termine").not("due_on", "is", null).lte("due_on", dans7).order("due_on").limit(5),
      admin.from("deal_health").select("sante"),
    ]);

  const passage = (tri ?? [])[0];
  const attente = mailsEnAttente.count ?? 0;
  const relances = leads ?? [];
  const echeances = taches ?? [];
  const dormantes = (sante ?? []).filter((d) => d.sante === "dormant").length;

  // Un brief qui n'annonce rien ne doit pas partir : le courrier quotidien
  // qu'on apprend à ignorer est pire que pas de courrier du tout.
  const rienASignaler =
    attente === 0 && relances.length === 0 && echeances.length === 0 && !passage?.lus;
  if (rienASignaler) return null;

  const resume = [
    passage?.lus ? ligne(passage.lus, "mail trié", "mails triés") : null,
    passage?.spams ? ligne(passage.spams, "spam écarté", "spams écartés") : null,
    attente ? `${attente} en attente de ta décision` : null,
    relances.length ? ligne(relances.length, "relance due", "relances dues") : null,
    dormantes ? ligne(dormantes, "affaire en sommeil", "affaires en sommeil") : null,
  ].filter(Boolean);

  const bloc = (titre: string, items: string[]) =>
    items.length === 0
      ? ""
      : `<h3 style="margin:22px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#8b8b93">${titre}</h3>
         <ul style="margin:0;padding-left:18px;color:#2a2a31;font-size:14px;line-height:1.65">
           ${items.map((i) => `<li>${i}</li>`).join("")}
         </ul>`;

  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:28px 24px">
    <p style="margin:0;font-size:20px;font-weight:600;color:#16161a">Bonjour ${prenom},</p>
    <p style="margin:6px 0 0;font-size:14px;color:#6b6b75">${resume.join(" · ") || "Rien de neuf ce matin."}</p>

    ${bloc(
      "À rappeler",
      relances.map(
        (l) =>
          `<strong>${l.full_name ?? "Sans nom"}</strong>${l.company_name ? ` — ${l.company_name}` : ""} <span style="color:#8b8b93">(prévu le ${l.follow_up_on})</span>`,
      ),
    )}

    ${bloc(
      "Échéances de la semaine",
      echeances.map((t) => `${t.title} <span style="color:#8b8b93">— ${t.due_on}</span>`),
    )}

    ${
      attente > 0
        ? `<h3 style="margin:22px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#8b8b93">Boîte mail</h3>
           <p style="margin:0;font-size:14px;color:#2a2a31;line-height:1.65">
             ${attente} message${attente > 1 ? "s attendent" : " attend"} ta décision — réponses préparées ou classements que je n'ai pas su trancher.
           </p>`
        : ""
    }

    <p style="margin:26px 0 0">
      <a href="${BASE}" style="display:inline-block;background:#5b5bd6;color:#fff;text-decoration:none;padding:10px 18px;border-radius:9px;font-size:14px;font-weight:500">Ouvrir Antichaos</a>
    </p>
    <p style="margin:18px 0 0;font-size:11.5px;color:#a0a0a8">
      Récapitulatif automatique, envoyé après le tri de la boîte mail. Rien n'a été envoyé à qui que ce soit en ton nom.
    </p>
  </div>`;
}

/** Envoie son brief à chaque compte interne. Silencieux s'il n'y a rien à dire. */
export async function envoyerBriefs(): Promise<BriefOutcome[]> {
  const admin = createAdminClient();
  if (!admin) return [];

  const cle = process.env.RESEND_API_KEY?.trim();

  const { data: comptes } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .neq("role", "client")
    .eq("is_active", true);

  const resultats: BriefOutcome[] = [];

  for (const compte of comptes ?? []) {
    const prenom = compte.full_name?.split(" ")[0] ?? compte.email.split("@")[0];
    const html = await corps(admin, compte.id, prenom);

    if (!html) {
      resultats.push({ email: compte.email, envoye: false, detail: "Rien à signaler." });
      continue;
    }
    if (!cle) {
      resultats.push({ email: compte.email, envoye: false, detail: "RESEND_API_KEY absente." });
      continue;
    }

    try {
      const reponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM,
          to: [compte.email],
          subject: `Antichaos — ton point du matin`,
          html,
        }),
      });

      resultats.push(
        reponse.ok
          ? { email: compte.email, envoye: true, detail: "Envoyé." }
          : {
              email: compte.email,
              envoye: false,
              detail: `Resend ${reponse.status} : ${(await reponse.text()).slice(0, 160)}`,
            },
      );
    } catch (caught) {
      resultats.push({
        email: compte.email,
        envoye: false,
        detail: caught instanceof Error ? caught.message : "Envoi impossible.",
      });
    }
  }

  return resultats;
}
