import "server-only";

import { agendaDe } from "@/lib/agenda";
import { estOuvre, precedentOuvre } from "@/lib/echeances";
import { composeHtmlRaw, refreshAccessToken, sendMessage } from "@/lib/google";
import { chargerRadar, type Radar } from "@/lib/prochaines-actions";
import { createAdminClient } from "@/lib/supabase/admin";
import { depuisSaisieParis, formatHeure, todayIso } from "@/lib/utils";

/**
 * Le récap commercial du matin, un seul pour toute l'équipe.
 *
 * Commun plutôt qu'individuel : à deux, chacun doit voir ce que l'autre a sur
 * le feu — c'est comme ça qu'on se passe une relance ou qu'on repère une
 * affaire qui dort. Chaque ligne dit à qui elle revient.
 *
 * Les jours ouvrés seulement. Il part de la boîte Gmail d'un associé vers
 * toute l'équipe ; faute de Gmail branché, par Resend si la clé existe.
 */

const BASE = "https://antichaos.dev";
const FROM_RESEND = process.env.NOTIFY_FROM?.trim() || "Jarvis <jarvis@antichaos.dev>";

export type BriefOutcome = { email: string; envoye: boolean; detail: string };

type Admin = NonNullable<ReturnType<typeof createAdminClient>>;
type Membre = { id: string; email: string; prenom: string; role: string };

function esc(texte: string | null | undefined): string {
  return (texte ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const GRIS = "#8b8b93";
const ROUGE = "#c2410c";

function titre(t: string, compte?: number): string {
  return `<h3 style="margin:26px 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:${GRIS}">${t}${
    compte != null ? ` · ${compte}` : ""
  }</h3>`;
}

function liste(items: string[]): string {
  return `<ul style="margin:0;padding-left:18px;color:#26262c;font-size:14px;line-height:1.65">${items
    .map((i) => `<li style="margin:2px 0">${i}</li>`)
    .join("")}</ul>`;
}

function lien(href: string, texte: string): string {
  return `<a href="${BASE}${href}" style="color:#26262c;text-decoration:none;font-weight:600">${texte}</a>`;
}

const JOUR_LONG = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long" });

/** Ce qui s'est passé depuis la veille travaillée, par personne. */
async function bilanVeille(admin: Admin, membres: Membre[], aujourdhui: string) {
  const debut = depuisSaisieParis(`${precedentOuvre(aujourdhui)}T00:00`)!;
  const fin = depuisSaisieParis(`${aujourdhui}T00:00`)!;

  const [{ data: evenements }, { data: gagnees }, { data: signes }] = await Promise.all([
    admin
      .from("lead_events")
      .select("lead_id, to_status, actor_id")
      .eq("kind", "statut")
      .gte("created_at", debut)
      .lt("created_at", fin)
      .limit(2000),
    admin.from("deals").select("name, amount").gte("won_at", debut).lt("won_at", fin),
    admin
      .from("devis_pennylane")
      .select("numero, montant_ht")
      .eq("statut", "accepte")
      .gte("statut_change_le", debut)
      .lt("statut_change_le", fin),
  ]);

  const parPersonne = membres
    .map((m) => {
      const siens = (evenements ?? []).filter((e) => e.actor_id === m.id);
      return {
        prenom: m.prenom,
        appels: new Set(siens.map((e) => e.lead_id)).size,
        callsPris: siens.filter((e) => e.to_status === "call_pris").length,
      };
    })
    .filter((p) => p.appels > 0);

  return { parPersonne, gagnees: gagnees ?? [], signes: signes ?? [] };
}

async function composer(admin: Admin, membres: Membre[]): Promise<{ sujet: string; html: string }> {
  const aujourdhui = todayIso();
  const prenomDe = (id: string | null) => membres.find((m) => m.id === id)?.prenom ?? "—";
  const qui = (id: string | null) => `<span style="color:${GRIS}"> · ${esc(prenomDe(id))}</span>`;

  const [radar, { data: suggestions }, veille, agendas, { data: ouvertes }] = await Promise.all([
    chargerRadar(admin),
    admin.from("daily_suggestions").select("focus, items").eq("for_date", aujourdhui).maybeSingle(),
    bilanVeille(admin, membres, aujourdhui),
    Promise.all(membres.map(async (m) => ({ m, agenda: await agendaDe(m.id, { jours: 0 }) }))),
    admin.from("deals").select("amount, probability").not("stage", "in", "(gagne,perdu,non_qualifie)"),
  ]);

  const r: Radar = radar;
  const retard = r.affaires.filter((a) => a.echeance === "retard");
  const jour = r.affaires.filter((a) => a.echeance === "jour");
  const prochain = r.affaires.filter((a) => a.echeance === "prochain");
  const rdv = agendas.flatMap(({ m, agenda }) => (agenda.ok ? agenda.rendezVous.map((x) => ({ m, x })) : []));
  rdv.sort((a, b) => (a.x.debut ?? "").localeCompare(b.x.debut ?? ""));

  const blocs: string[] = [];

  // --- Rendez-vous
  if (rdv.length) {
    blocs.push(
      titre("Rendez-vous du jour", rdv.length) +
        liste(
          rdv.map(({ m, x }) => {
            const heure = x.journee_entiere ? "journée" : x.debut ? formatHeure(x.debut) : "";
            const avec = x.participants.length ? ` — avec ${esc(x.participants.join(", "))}` : "";
            return `<strong>${heure}</strong> ${esc(x.titre)}<span style="color:${GRIS}">${avec} · ${esc(m.prenom)}</span>`;
          }),
        ),
    );
  }

  // --- Tâches de l'équipe : bloquées, en retard, du jour, prioritaires
  const taches = r.taches.filter((t) => t.echeance !== "prochain" || t.prio || t.probleme);
  if (taches.length) {
    const etat = (t: Radar["taches"][number]) =>
      t.probleme
        ? `<span style="color:${ROUGE}">problème</span>`
        : t.echeance === "retard"
          ? `<span style="color:${ROUGE}">en retard</span>`
          : t.echeance === "jour"
            ? "aujourd'hui"
            : "prioritaire";
    blocs.push(
      titre("Tâches de l'équipe", taches.length) +
        liste(
          taches.slice(0, 15).map(
            (t) =>
              `${t.prio ? "<strong>P1</strong> " : ""}${lien("/taches", esc(t.titre))}${t.categorie ? ` <span style="color:${GRIS}">#${esc(t.categorie)}</span>` : ""} — ${etat(t)}<span style="color:${GRIS}"> · ${
                t.assignees.map((id) => esc(prenomDe(id))).join(" + ") || "à attribuer"
              }</span>`,
          ),
        ),
    );
  }

  // --- Priorités commerciales (les suggestions du jour)
  const items = ((suggestions?.items ?? []) as Array<{ title: string; detail: string; href: string; urgency: string }>).slice(0, 8);
  if (items.length) {
    blocs.push(
      titre("Priorités commerciales du jour") +
        (suggestions?.focus ? `<p style="margin:0 0 6px;font-size:14px;color:#26262c"><em>${esc(suggestions.focus)}</em></p>` : "") +
        liste(
          items.map(
            (i) =>
              `${i.urgency === "haute" ? `<span style="color:${ROUGE}">●</span> ` : ""}${lien(i.href, esc(i.title))}<br><span style="color:${GRIS};font-size:13px">${esc(i.detail)}</span>`,
          ),
        ),
    );
  }

  // --- Prochaines actions des affaires
  const ligneAffaire = (a: Radar["affaires"][number]) =>
    `${lien(`/affaires?affaire=${a.dealId}`, esc(a.action || "Prochaine étape à préciser"))} — ${esc(a.nom)} <span style="color:${GRIS}">(${esc(a.etape)})</span>${
      a.retard ? ` <span style="color:${ROUGE}">${a.retard} j de retard</span>` : ""
    }${qui(a.ownerId)}`;
  if (retard.length || jour.length) {
    blocs.push(titre("Prochaines actions du jour", retard.length + jour.length) + liste([...retard, ...jour].map(ligneAffaire)));
  }
  if (prochain.length) {
    blocs.push(titre(`À anticiper pour ${r.nomProchain.toLowerCase()}`, prochain.length) + liste(prochain.map(ligneAffaire)));
  }

  // --- Relances de leads, par personne
  if (r.relances.length) {
    const groupes = new Map<string, Radar["relances"]>();
    for (const l of r.relances) {
      const cle = prenomDe(l.ownerId);
      groupes.set(cle, [...(groupes.get(cle) ?? []), l]);
    }
    const html = [...groupes.entries()]
      .map(([prenom, leads]) => {
        const enRetard = leads.filter((l) => l.retard > 0).length;
        return (
          `<p style="margin:8px 0 4px;font-size:14px;color:#26262c"><strong>${esc(prenom)}</strong> — ${leads.length} relance${leads.length > 1 ? "s" : ""}${
            enRetard ? ` <span style="color:${ROUGE}">(dont ${enRetard} en retard)</span>` : ""
          }</p>` +
          liste(
            leads.slice(0, 10).map(
              (l) =>
                `${lien(`/leads?lead=${l.leadId}`, esc(l.nom))}${l.entreprise ? ` — ${esc(l.entreprise)}` : ""} <span style="color:${GRIS}">(${esc(l.statut)}${l.retard ? `, ${l.retard} j de retard` : ""})</span>`,
            ),
          ) +
          (leads.length > 10 ? `<p style="margin:4px 0 0;font-size:13px;color:${GRIS}">… et ${leads.length - 10} autres, dans le mode Prospection.</p>` : "")
        );
      })
      .join("");
    blocs.push(titre("Relances de leads du jour", r.relances.length) + html);
  }

  // --- À ne pas laisser filer
  const vigilance = [
    ...r.recaps.map((x) => `Récap R2 prêt à envoyer — ${lien(`/affaires?affaire=${x.dealId}`, esc(x.nom))}${qui(x.ownerId)}`),
    ...r.devis.map(
      (x) =>
        `${x.expire ? "Devis expiré" : "Devis à relancer"}${x.numero ? ` ${esc(x.numero)}` : ""} — ${lien(`/affaires?affaire=${x.dealId}`, esc(x.nom))}${qui(x.ownerId)}`,
    ),
    ...r.sansSuite.map(
      (x) => `${esc(x.etape)} sans prochaine étape datée — ${lien(`/affaires?affaire=${x.dealId}`, esc(x.nom))}${qui(x.ownerId)}`,
    ),
  ];
  if (vigilance.length) blocs.push(titre("À ne pas laisser filer", vigilance.length) + liste(vigilance));

  // --- La veille
  const bilan = [
    ...veille.parPersonne.map(
      (p) => `${esc(p.prenom)} : ${p.appels} lead${p.appels > 1 ? "s" : ""} travaillé${p.appels > 1 ? "s" : ""}${
        p.callsPris ? `, <strong>${p.callsPris} call${p.callsPris > 1 ? "s" : ""} pris</strong>` : ""
      }`,
    ),
    ...veille.gagnees.map((g) => `🏆 Affaire gagnée : <strong>${esc(g.name)}</strong>${g.amount ? ` (${Math.round(g.amount).toLocaleString("fr-FR")} € HT)` : ""}`),
    ...veille.signes.map((d) => `Devis signé${d.numero ? ` ${esc(d.numero)}` : ""}${d.montant_ht ? ` — ${Math.round(d.montant_ht).toLocaleString("fr-FR")} € HT` : ""}`),
  ];
  if (bilan.length) blocs.push(titre("Depuis le dernier récap") + liste(bilan));

  // --- Pipeline
  const pipe = ouvertes ?? [];
  const total = pipe.reduce((s, d) => s + Number(d.amount ?? 0), 0);
  const pondere = pipe.reduce((s, d) => s + Number(d.amount ?? 0) * (Number(d.probability ?? 0) / 100), 0);
  const resume = [
    rdv.length ? `${rdv.length} rendez-vous` : null,
    retard.length + jour.length ? `${retard.length + jour.length} action${retard.length + jour.length > 1 ? "s" : ""} affaires` : null,
    r.relances.length ? `${r.relances.length} relance${r.relances.length > 1 ? "s" : ""} leads` : null,
    taches.length ? `${taches.length} tâche${taches.length > 1 ? "s" : ""}` : null,
  ].filter(Boolean);

  const date = JOUR_LONG.format(new Date());
  const html = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:28px 22px">
    <p style="margin:0;font-size:20px;font-weight:600;color:#16161a">Récap commercial — ${esc(date)}</p>
    <p style="margin:6px 0 0;font-size:14px;color:#6b6b75">${resume.join(" · ") || "Journée calme : rien d'échu."}</p>
    ${blocs.join("\n")}
    <p style="margin:26px 0 0;font-size:13px;color:${GRIS}">Pipeline ouvert : ${pipe.length} affaire${pipe.length > 1 ? "s" : ""} · ${Math.round(total).toLocaleString("fr-FR")} € HT · pondéré ${Math.round(pondere).toLocaleString("fr-FR")} €</p>
    <p style="margin:18px 0 0">
      <a href="${BASE}" style="display:inline-block;background:#26262c;color:#fff;text-decoration:none;padding:10px 18px;border-radius:9px;font-size:14px;font-weight:500">Ouvrir Jarvis</a>
    </p>
    <p style="margin:18px 0 0;font-size:11.5px;color:#a0a0a8">Récap automatique des jours ouvrés, envoyé à toute l'équipe. Rien n'a été envoyé à un client.</p>
  </div>`;

  return { sujet: `Récap commercial — ${date}`, html };
}

/** Le texte brut qui accompagne le HTML, pour les clients mail qui n'en veulent pas. */
function versTexte(html: string): string {
  return html
    .replace(/<(br|\/p|\/li|\/h3)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

/**
 * Envoie le récap du jour à toute l'équipe, une fois par jour ouvré.
 * `force` l'envoie même le week-end ou s'il est déjà parti — pour un essai.
 */
export async function envoyerBriefs(options: { force?: boolean } = {}): Promise<BriefOutcome[]> {
  const admin = createAdminClient();
  if (!admin) return [];

  const aujourdhui = todayIso();
  if (!options.force && !estOuvre(aujourdhui)) return [{ email: "équipe", envoye: false, detail: "Week-end : pas de récap." }];

  const { data: deja } = await admin.from("app_settings").select("value").eq("key", "brief_commercial").maybeSingle();
  if (!options.force && (deja?.value as { jour?: string } | null)?.jour === aujourdhui) {
    return [{ email: "équipe", envoye: false, detail: "Déjà envoyé aujourd'hui." }];
  }

  const { data: profils } = await admin
    .from("profiles")
    .select("id, email, full_name, role")
    .neq("role", "client")
    .eq("is_active", true);
  const membres: Membre[] = (profils ?? []).map((p) => ({
    id: p.id,
    email: p.email,
    prenom: p.full_name?.split(" ")[0] ?? p.email.split("@")[0]!,
    role: p.role,
  }));
  if (!membres.length) return [];
  const destinataires = membres.map((m) => m.email);

  const { sujet, html } = await composer(admin, membres);

  // Gmail d'abord : depuis la boîte d'un associé, de préférence un admin.
  const { data: comptes } = await admin.from("google_accounts").select("user_id, email, refresh_token");
  const ordre = [...(comptes ?? [])].sort(
    (a, b) =>
      Number(membres.find((m) => m.id === b.user_id)?.role === "admin") -
      Number(membres.find((m) => m.id === a.user_id)?.role === "admin"),
  );

  let resultat: BriefOutcome | null = null;
  for (const compte of ordre) {
    if (!compte.refresh_token || !membres.some((m) => m.id === compte.user_id)) continue;
    try {
      const { access_token } = await refreshAccessToken(compte.refresh_token);
      await sendMessage(access_token, composeHtmlRaw({ to: destinataires, cc: [], subject: sujet, text: versTexte(html), html }));
      resultat = { email: destinataires.join(", "), envoye: true, detail: `Envoyé depuis ${compte.email}.` };
      break;
    } catch (caught) {
      resultat = { email: compte.email, envoye: false, detail: caught instanceof Error ? caught.message : "Gmail indisponible." };
    }
  }

  const cle = process.env.RESEND_API_KEY?.trim();
  if (!resultat?.envoye && cle) {
    try {
      const reponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM_RESEND, to: destinataires, subject: sujet, html }),
      });
      resultat = reponse.ok
        ? { email: destinataires.join(", "), envoye: true, detail: "Envoyé par Resend." }
        : { email: "resend", envoye: false, detail: `Resend ${reponse.status} : ${(await reponse.text()).slice(0, 160)}` };
    } catch (caught) {
      resultat = { email: "resend", envoye: false, detail: caught instanceof Error ? caught.message : "Resend indisponible." };
    }
  }

  resultat ??= { email: "équipe", envoye: false, detail: "Aucun compte Gmail connecté ni RESEND_API_KEY." };
  if (resultat.envoye) {
    await admin
      .from("app_settings")
      .upsert({ key: "brief_commercial", value: { jour: aujourdhui, at: new Date().toISOString() } as never }, { onConflict: "key" });
  }
  return [resultat];
}
