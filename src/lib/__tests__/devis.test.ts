/** `npx tsx src/lib/__tests__/devis.test.ts` — lecture des devis Pennylane et effet sur l'affaire. */
import {
  controlerSaisie,
  corpsClient,
  corpsCorrection,
  corpsDevis,
  decouperAdresse,
  idsDesLignes,
  plusJours,
  totauxDevis,
  type SaisieDevis,
} from "@/lib/devis-emission";
import {
  aRelancer,
  devisDeLaPage,
  etapeApresDevis,
  lireDevis,
  nomReduit,
  pageSuivante,
  statutDevis,
  statutRetenu,
} from "@/lib/devis-logique";

let pass = 0,
  fail = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}  →  ${JSON.stringify(got)}${ok ? "" : ` (attendu ${JSON.stringify(want)})`}`);
}

// --- Statuts, sous toutes leurs graphies
check("pending", statutDevis("pending"), "en_attente");
check("accepted", statutDevis("accepted"), "accepte");
check("denied", statutDevis("denied"), "refuse");
check("invoiced", statutDevis("invoiced"), "facture");
check("expired", statutDevis("expired"), "expire");
check("draft", statutDevis("draft"), "brouillon");
check("en français", statutDevis("Accepté"), "accepte");
check("inconnu", statutDevis("quelque_chose"), "inconnu");

// --- Un devis tel que l'écran Pennylane le montre (D-2026-1, Archimed)
const devis = lireDevis({
  id: 1234,
  quote_number: "D-2026-1",
  status: "expired",
  currency_amount_before_tax: "3500.0",
  date: "2026-06-16",
  deadline: "2026-07-16",
  customer: { id: 99, url: "https://…" },
  public_file_url: "https://app.pennylane.com/public/quote/abc.pdf",
});
check("lu", devis, {
  pennylaneId: "1234",
  numero: "D-2026-1",
  statut: "expire",
  statutBrut: "expired",
  montantHt: 3500,
  emisLe: "2026-06-16",
  echeanceLe: "2026-07-16",
  clientId: "99",
  clientNom: null,
  url: "https://app.pennylane.com/public/quote/abc.pdf",
});
check("sans identifiant, rien", lireDevis({ status: "pending" }), null);

// --- Pages
check("liste sous items", devisDeLaPage({ items: [1, 2] }), [1, 2]);
check("liste nue", devisDeLaPage([1]), [1]);
check("page suivante", pageSuivante({ has_more: true, next_cursor: "abc" }), "abc");
check("dernière page", pageSuivante({ has_more: false, next_cursor: "abc" }), null);

// --- L'affaire suit le devis
check("envoyé depuis R2 → propale", etapeApresDevis("en_attente", "r2"), "propale_envoyee");
check("envoyé, déjà en propale → rien", etapeApresDevis("en_attente", "propale_envoyee"), null);
check("signé → gagné", etapeApresDevis("accepte", "propale_envoyee"), "gagne");
check("facturé → gagné", etapeApresDevis("facture", "r2"), "gagne");
check("déjà gagné → rien", etapeApresDevis("accepte", "gagne"), null);
check("refusé ne ferme rien", etapeApresDevis("refuse", "propale_envoyee"), null);
check("expiré ne ferme rien", etapeApresDevis("expire", "propale_envoyee"), null);

// --- Relance
check("expiré → à relancer", aRelancer({ statut: "expire", echeance_le: null }, "2026-09-24"), true);
check("en attente, échu → à relancer", aRelancer({ statut: "en_attente", echeance_le: "2026-09-20" }, "2026-09-24"), true);
check("en attente, dans les temps", aRelancer({ statut: "en_attente", echeance_le: "2026-10-20" }, "2026-09-24"), false);
check("signé → non", aRelancer({ statut: "accepte", echeance_le: "2026-01-01" }, "2026-09-24"), false);

// --- Rapprochement des noms
check("majuscules et forme juridique", nomReduit("ARCHIMED ENVIRONNEMENT"), nomReduit("Archimed Environnement SAS"));
check("accents et tirets", nomReduit("Bm2s-Bretagne"), nomReduit("BM2S Bretagne"));
check("deux entreprises distinctes restent distinctes", nomReduit("Acme") === nomReduit("Acme Ingénierie"), false);

// --- Un devis créé depuis l'application reste brouillon tant qu'il n'est pas parti
check("brouillon + pending → brouillon", statutRetenu("brouillon", "en_attente"), "brouillon");
check("brouillon + accepted → accepté", statutRetenu("brouillon", "accepte"), "accepte");
check("inconnu + pending → en attente", statutRetenu(undefined, "en_attente"), "en_attente");
check("envoyé reste envoyé", statutRetenu("en_attente", "en_attente"), "en_attente");

// --- Émission : saisie, totaux, corps de requête
const saisie: SaisieDevis = {
  clientPennylaneId: null,
  client: {
    nom: "Archimed Environnement",
    siret: "123 456 789 00012",
    tva: "fr12 123456789",
    adresse: "12 rue de la Paix",
    codePostal: "75002",
    ville: "Paris",
    pays: "fr",
    email: "compta@archimed.fr",
    destinataire: "Jeanne Martin",
  },
  date: "2026-09-24",
  echeance: "2026-10-24",
  objet: "Formation IA",
  description: "",
  mentions: "Paiement à 30 jours.",
  remisePct: 0,
  lignes: [
    { libelle: "Atelier IA", description: "", quantite: 2, prixUnitaireHt: 1250.5, unite: "jour", tva: "FR_200" },
    { libelle: "Support", description: "PDF", quantite: 1, prixUnitaireHt: 100, unite: "forfait", tva: "exempt" },
  ],
};
check("saisie complète acceptée", controlerSaisie(saisie), []);
check("totaux au centime", totauxDevis(saisie.lignes), { ht: 2601, tva: 500.2, ttc: 3101.2 });
check("totaux avec remise 10 %", totauxDevis(saisie.lignes, 10), { ht: 2340.9, tva: 450.18, ttc: 2791.08 });
check(
  "échéance avant la date refusée",
  controlerSaisie({ ...saisie, echeance: "2026-09-01" }),
  ["La validité précède la date du devis."],
);
check(
  "client connu : l'adresse n'est plus exigée",
  controlerSaisie({ ...saisie, clientPennylaneId: "42", client: { ...saisie.client, adresse: "", ville: "" } }),
  [],
);
check(
  "ligne sans libellé ni quantité",
  controlerSaisie({ ...saisie, lignes: [{ ...saisie.lignes[0]!, libelle: " ", quantite: 0 }] }),
  ["Ligne 1 : libellé manquant.", "Ligne 1 : quantité à renseigner."],
);
check("SIRET invalide", controlerSaisie({ ...saisie, client: { ...saisie.client, siret: "123" } }).length, 1);

const corps = corpsDevis(saisie, 42, "jarvis:x");
check("corps : champs requis de l'API v2", Object.keys(corps).filter((k) => ["customer_id", "date", "deadline", "invoice_lines"].includes(k)).length, 4);
check("corps : ligne au format Pennylane", corps.invoice_lines[0], {
  label: "Atelier IA",
  quantity: 2,
  raw_currency_unit_price: "1250.5",
  unit: "jour",
  vat_rate: "FR_200",
});
check("corps : description de ligne transmise", corps.invoice_lines[1], {
  label: "Support",
  quantity: 1,
  raw_currency_unit_price: "100",
  unit: "forfait",
  vat_rate: "exempt",
  description: "PDF",
});
check("corps : pas de remise à zéro, pas de description vide", ["discount", "pdf_description"].some((k) => k in corps), false);
check("corps : mentions", corps.special_mention, "Paiement à 30 jours.");
check("corps : remise relative", corpsDevis({ ...saisie, remisePct: 10 }, 42, "r").discount, { type: "relative", value: "10" });

const correction = corpsCorrection(saisie, 42, [7, 8]);
check("correction : lignes remplacées", correction.invoice_lines.delete, [{ id: 7 }, { id: 8 }]);
check("correction : sans référence externe", "external_reference" in correction, false);
check("correction : description vidée explicitement", correction.pdf_description, null);

check("client : corps", corpsClient(saisie.client), {
  name: "Archimed Environnement",
  billing_address: { address: "12 rue de la Paix", postal_code: "75002", city: "Paris", country_alpha2: "FR" },
  billing_language: "fr_FR",
  reg_no: "12345678900012",
  vat_number: "FR12123456789",
  emails: ["compta@archimed.fr"],
  recipient: "Jeanne Martin",
});

check("adresse d'un bloc", decouperAdresse("12 rue de la Paix, 75002 Paris"), {
  adresse: "12 rue de la Paix",
  codePostal: "75002",
  ville: "Paris",
});
check("adresse sur deux lignes, avec pays", decouperAdresse("3 allée des Pins\n35000 Rennes, France"), {
  adresse: "3 allée des Pins",
  codePostal: "35000",
  ville: "Rennes",
});
check("adresse sans code postal", decouperAdresse("Zone artisanale"), { adresse: "Zone artisanale", codePostal: "", ville: "" });
check("validité à 30 jours", plusJours("2026-09-24", 30), "2026-10-24");
check("ids des lignes", idsDesLignes({ items: [{ id: 3 }, { id: "4" }, {}] }), [3, 4]);

console.log(`\n${pass} succès, ${fail} échec(s).`);
if (fail > 0) process.exit(1);
