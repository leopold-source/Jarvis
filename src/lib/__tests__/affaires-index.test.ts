/**
 * De quel interlocuteur vers quelle affaire.
 *
 * Sans dépendance de test : `npx tsx src/lib/__tests__/affaires-index.test.ts`.
 * C'est cet index qui décide si un e-mail est conservé : un message dont
 * l'expéditeur ne mène à aucune affaire est écarté sans trace. Une erreur ici
 * ne produit pas de message d'erreur — elle produit un fil incomplet, ce qui
 * est bien pire.
 */
import { derniersMailsParLead, indexerAffaires } from "@/lib/gmail-sync";
import { libelleAction } from "@/lib/lead-action";

let pass = 0,
  fail = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${label}  →  ${JSON.stringify(got)}${ok ? "" : ` (attendu ${JSON.stringify(want)})`}`,
  );
}

const deal = (id: string, contact_id: string | null, company_id: string | null) => ({
  id,
  contact_id,
  company_id,
});

// --- Le cas d'avant : un seul contact --------------------------------------

{
  const { dealByContact } = indexerAffaires([deal("a1", "c1", "e1")], [{ deal_id: "a1", contact_id: "c1" }]);
  check("le principal mène à son affaire", dealByContact.get("c1"), "a1");
}

// --- Le cas que l'on répare ------------------------------------------------

{
  const { dealByContact } = indexerAffaires(
    [deal("a1", "c1", "e1")],
    [
      { deal_id: "a1", contact_id: "c1" },
      { deal_id: "a1", contact_id: "c2" },
      { deal_id: "a1", contact_id: "c3" },
    ],
  );
  check("le responsable technique aussi", dealByContact.get("c2"), "a1");
  check("l'assistante aussi", dealByContact.get("c3"), "a1");
}

// --- Une affaire d'avant le déclencheur, sans ligne de liaison --------------

{
  const { dealByContact } = indexerAffaires([deal("a1", "c1", "e1")], []);
  check("le principal reste rattaché sans liaison", dealByContact.get("c1"), "a1");
}

// --- Deux affaires pour le même contact ------------------------------------

{
  // L'ordre d'entrée est celui de la base : la plus récemment modifiée d'abord.
  const { dealByContact } = indexerAffaires(
    [deal("recente", "c1", "e1"), deal("ancienne", "c1", "e1")],
    [
      { deal_id: "ancienne", contact_id: "c1" },
      { deal_id: "recente", contact_id: "c1" },
    ],
  );
  check("la plus vivante gagne", dealByContact.get("c1"), "recente");
}

{
  // Le contact n'est secondaire que sur la récente : elle l'emporte quand même.
  const { dealByContact } = indexerAffaires(
    [deal("recente", "c9", "e1"), deal("ancienne", "c1", "e1")],
    [
      { deal_id: "recente", contact_id: "c9" },
      { deal_id: "recente", contact_id: "c1" },
      { deal_id: "ancienne", contact_id: "c1" },
    ],
  );
  check("secondaire sur la récente l'emporte", dealByContact.get("c1"), "recente");
}

// --- Le repli par entreprise ------------------------------------------------

{
  const { dealByCompany } = indexerAffaires(
    [deal("recente", "c1", "e1"), deal("ancienne", "c2", "e1")],
    [],
  );
  check("l'entreprise mène à son affaire la plus vivante", dealByCompany.get("e1"), "recente");
}

// --- Les cas vides ----------------------------------------------------------

{
  const { dealByContact, dealByCompany } = indexerAffaires([], []);
  check("rien n'entre, rien ne sort", [dealByContact.size, dealByCompany.size], [0, 0]);
}

{
  const { dealByContact, dealByCompany } = indexerAffaires([deal("a1", null, null)], []);
  check("une affaire sans contact ni entreprise", [dealByContact.size, dealByCompany.size], [0, 0]);
}

{
  // Une liaison qui désigne une affaire disparue ne doit rien inventer.
  const { dealByContact } = indexerAffaires([], [{ deal_id: "fantome", contact_id: "c1" }]);
  check("une liaison orpheline est sans effet", dealByContact.size, 0);
}

// --- Les mails échangés avec les leads ----------------------------------------

{
  const leads = new Map([
    ["jean@acme.fr", "l1"],
    ["paul@beta.fr", "l2"],
  ]);
  const boite = "leopold@antichaos.fr";
  const mails = derniersMailsParLead(
    [
      { from: [boite], to: ["jean@acme.fr"], at: "2026-09-20T09:00:00Z", objet: "Présentation" },
      { from: ["jean@acme.fr"], to: [boite], at: "2026-09-21T10:00:00Z", objet: "Re: Présentation" },
      { from: [boite], to: ["paul@beta.fr", "romain@antichaos.fr"], at: "2026-09-19T08:00:00Z", objet: "Formation IA" },
      { from: ["newsletter@x.fr"], to: [boite], at: "2026-09-22T08:00:00Z", objet: "Promo" },
      { from: [boite], to: ["jean@acme.fr"], at: null, objet: "Sans date" },
    ],
    leads,
    boite,
  );
  check("le plus récent l'emporte, dans son sens", mails.get("l1"), {
    leadId: "l1",
    at: "2026-09-21T10:00:00Z",
    sens: "recu",
    objet: "Re: Présentation",
  });
  check("un envoi à un lead est retenu", mails.get("l2")?.sens, "envoye");
  check("un inconnu n'est pas un lead", mails.size, 2);
}

// --- Le libellé de la dernière action ------------------------------------------

check("un NRP compté", libelleAction("statut", "nrp:3")?.titre, "→ NRP 3");
check("un +1 NRP", libelleAction("nrp", "4")?.titre, "NRP 4");
check("un statut ordinaire", libelleAction("statut", "a_recontacter")?.titre.startsWith("→ "), true);
check("un mail reçu, avec son objet", libelleAction("mail", "recu|Re: Formation"), {
  titre: "Mail reçu",
  precision: "Re: Formation",
});
check("une relance datée", libelleAction("relance", "2026-10-02")?.titre, "Relance le 02/10/2026");
check("rien n'a été fait", libelleAction(null, null), null);

console.log(`\n${pass} succès, ${fail} échec(s).`);
if (fail > 0) process.exit(1);
