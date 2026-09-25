/**
 * Émettre un devis Pennylane depuis une affaire : la saisie, et ce qu'on en
 * envoie à l'API.
 *
 * Tout ce qui est pur — contrôles, totaux, corps de requête — vit ici, loin des
 * appels réseau, pour être éprouvé sans clé ni serveur. Les champs sont ceux de
 * la spécification officielle de l'API v2 (`POST /quotes`,
 * `POST /company_customers`) ; les montants partent en chaînes, comme elle le
 * demande, pour ne rien perdre en virgule flottante.
 */

export const TAUX_TVA = [
  { code: "FR_200", libelle: "20 %", taux: 0.2 },
  { code: "FR_100", libelle: "10 %", taux: 0.1 },
  { code: "FR_55", libelle: "5,5 %", taux: 0.055 },
  { code: "FR_21", libelle: "2,1 %", taux: 0.021 },
  { code: "exempt", libelle: "Exonéré", taux: 0 },
] as const;

export type CodeTva = (typeof TAUX_TVA)[number]["code"];

export const UNITES = ["jour", "demi-journée", "heure", "forfait", "participant", "session", "mois"] as const;

export type LigneDevis = {
  libelle: string;
  description: string;
  quantite: number;
  prixUnitaireHt: number;
  unite: string;
  tva: CodeTva;
};

/** Le client tel qu'on le crée chez Pennylane, quand il n'y existe pas encore. */
export type ClientSaisi = {
  nom: string;
  siret: string;
  tva: string;
  adresse: string;
  codePostal: string;
  ville: string;
  pays: string;
  email: string;
  destinataire: string;
};

export type SaisieDevis = {
  /** L'identifiant Pennylane du client, s'il est connu ; sinon `client` sert à le créer. */
  clientPennylaneId: string | null;
  client: ClientSaisi;
  date: string;
  echeance: string;
  objet: string;
  description: string;
  mentions: string;
  lignes: LigneDevis[];
  /** Remise globale, en pourcentage du total HT. 0 : aucune. */
  remisePct: number;
};

const JOUR = /^\d{4}-\d{2}-\d{2}$/;

/** Arrondi au centime, sans les surprises de `toFixed`. */
function centimes(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function tauxDe(code: CodeTva): number {
  return TAUX_TVA.find((t) => t.code === code)?.taux ?? 0;
}

/** Totaux affichés à la saisie. Pennylane refait le calcul ; il doit tomber pareil. */
export function totauxDevis(lignes: LigneDevis[], remisePct = 0): { ht: number; tva: number; ttc: number } {
  const facteur = 1 - Math.min(Math.max(remisePct, 0), 100) / 100;
  let ht = 0;
  let tva = 0;
  for (const ligne of lignes) {
    const montant = centimes(ligne.quantite * ligne.prixUnitaireHt * facteur);
    ht += montant;
    tva += centimes(montant * tauxDe(ligne.tva));
  }
  return { ht: centimes(ht), tva: centimes(tva), ttc: centimes(ht + tva) };
}

/** Le montant HT d'une ligne, remise globale comprise, au centime. */
export function montantLigne(ligne: Pick<LigneDevis, "quantite" | "prixUnitaireHt">, remisePct = 0): number {
  const facteur = 1 - Math.min(Math.max(remisePct, 0), 100) / 100;
  return centimes(ligne.quantite * ligne.prixUnitaireHt * facteur);
}

/**
 * Le tableau « Détails TVA » du devis : une ligne par taux, base et montant.
 * Calculé ligne à ligne comme `totauxDevis`, pour que les deux tombent juste.
 */
export function detailTva(
  lignes: LigneDevis[],
  remisePct = 0,
): Array<{ code: CodeTva; libelle: string; base: number; montant: number }> {
  const parTaux = new Map<CodeTva, { base: number; montant: number }>();
  for (const ligne of lignes) {
    const base = montantLigne(ligne, remisePct);
    const deja = parTaux.get(ligne.tva) ?? { base: 0, montant: 0 };
    parTaux.set(ligne.tva, {
      base: centimes(deja.base + base),
      montant: centimes(deja.montant + centimes(base * tauxDe(ligne.tva))),
    });
  }
  return TAUX_TVA.filter((t) => parTaux.has(t.code)).map((t) => ({
    code: t.code,
    libelle: t.code === "exempt" ? "Exonéré" : `${String(t.taux * 100).replace(".", ",")}%`,
    ...parTaux.get(t.code)!,
  }));
}

/** Ce qui empêche l'envoi, dit en clair. Vide : la saisie peut partir. */
export function controlerSaisie(saisie: SaisieDevis): string[] {
  const erreurs: string[] = [];
  if (!JOUR.test(saisie.date)) erreurs.push("Date du devis invalide.");
  if (!JOUR.test(saisie.echeance)) erreurs.push("Date de validité invalide.");
  else if (saisie.echeance < saisie.date) erreurs.push("La validité précède la date du devis.");

  if (saisie.lignes.length === 0) erreurs.push("Ajoutez au moins une ligne.");
  saisie.lignes.forEach((ligne, i) => {
    const n = `Ligne ${i + 1}`;
    if (!ligne.libelle.trim()) erreurs.push(`${n} : libellé manquant.`);
    if (!(ligne.quantite > 0)) erreurs.push(`${n} : quantité à renseigner.`);
    if (!Number.isFinite(ligne.prixUnitaireHt) || ligne.prixUnitaireHt < 0) erreurs.push(`${n} : prix invalide.`);
    if (!ligne.unite.trim()) erreurs.push(`${n} : unité manquante.`);
  });
  if (saisie.remisePct < 0 || saisie.remisePct >= 100) erreurs.push("Remise hors bornes.");

  // Un client déjà connu de Pennylane n'a besoin de rien d'autre.
  if (!saisie.clientPennylaneId) {
    const c = saisie.client;
    if (!c.nom.trim()) erreurs.push("Client : raison sociale manquante.");
    if (!c.adresse.trim() || !c.codePostal.trim() || !c.ville.trim()) {
      erreurs.push("Client : adresse de facturation incomplète (rue, code postal, ville).");
    }
    if (!/^[A-Z]{2}$/.test(c.pays.trim().toUpperCase())) erreurs.push("Client : code pays sur deux lettres (FR).");
    if (c.siret && !/^\d{9}(\d{5})?$/.test(c.siret.replace(/\s/g, ""))) {
      erreurs.push("Client : SIREN (9 chiffres) ou SIRET (14 chiffres) invalide.");
    }
  }
  return erreurs;
}

function texteOuAbsent(v: string): string | undefined {
  const t = v.trim();
  return t ? t : undefined;
}

/** Le montant au format attendu : une chaîne, point décimal, sans zéro inutile. */
function prix(n: number): string {
  return String(centimes(n));
}

function lignePennylane(ligne: LigneDevis) {
  return {
    label: ligne.libelle.trim(),
    quantity: ligne.quantite,
    raw_currency_unit_price: prix(ligne.prixUnitaireHt),
    unit: ligne.unite.trim(),
    vat_rate: ligne.tva,
    ...(texteOuAbsent(ligne.description) ? { description: ligne.description.trim() } : {}),
  };
}

/** Le corps de `POST /quotes`. */
export function corpsDevis(saisie: SaisieDevis, clientId: number, referenceExterne: string) {
  return {
    customer_id: clientId,
    date: saisie.date,
    deadline: saisie.echeance,
    currency: "EUR",
    language: "fr_FR",
    external_reference: referenceExterne,
    invoice_lines: saisie.lignes.map(lignePennylane),
    ...(texteOuAbsent(saisie.objet) ? { pdf_invoice_subject: saisie.objet.trim() } : {}),
    ...(texteOuAbsent(saisie.description) ? { pdf_description: saisie.description.trim() } : {}),
    ...(texteOuAbsent(saisie.mentions) ? { special_mention: saisie.mentions.trim() } : {}),
    ...(saisie.remisePct > 0 ? { discount: { type: "relative", value: String(saisie.remisePct) } } : {}),
  };
}

/**
 * Le corps de `PUT /quotes/{id}` : les lignes existantes sont retirées, les
 * nouvelles créées. Plus simple et plus sûr que d'apparier ligne à ligne ce
 * que l'utilisateur a pu réordonner.
 */
export function corpsCorrection(saisie: SaisieDevis, clientId: number, lignesExistantes: number[]) {
  const { external_reference: _ref, invoice_lines, ...reste } = corpsDevis(saisie, clientId, "");
  return {
    ...reste,
    pdf_invoice_subject: texteOuAbsent(saisie.objet) ?? null,
    pdf_description: texteOuAbsent(saisie.description) ?? null,
    special_mention: texteOuAbsent(saisie.mentions) ?? null,
    // Toujours explicite : une remise retirée à la correction doit disparaître.
    discount: { type: "relative", value: String(saisie.remisePct) },
    invoice_lines: { delete: lignesExistantes.map((id) => ({ id })), create: invoice_lines },
  };
}

/** Le corps de `POST /company_customers`. */
export function corpsClient(client: ClientSaisi) {
  const siret = client.siret.replace(/\s/g, "");
  return {
    name: client.nom.trim(),
    billing_address: {
      address: client.adresse.trim(),
      postal_code: client.codePostal.trim(),
      city: client.ville.trim(),
      country_alpha2: client.pays.trim().toUpperCase(),
    },
    billing_language: "fr_FR",
    ...(siret ? { reg_no: siret } : {}),
    ...(texteOuAbsent(client.tva) ? { vat_number: client.tva.replace(/\s/g, "").toUpperCase() } : {}),
    ...(texteOuAbsent(client.email) ? { emails: [client.email.trim()] } : {}),
    ...(texteOuAbsent(client.destinataire) ? { recipient: client.destinataire.trim() } : {}),
  };
}

/**
 * Découpe une adresse écrite d'un bloc : « 12 rue de la Paix, 75002 Paris ».
 *
 * Le CRM la garde en un seul champ, Pennylane la veut en trois. Le code postal
 * sert de pivot ; faute de le trouver, tout reste dans la rue et l'utilisateur
 * complète.
 */
export function decouperAdresse(brute: string | null | undefined): { adresse: string; codePostal: string; ville: string } {
  const texte = (brute ?? "").replace(/\s*\n\s*/g, ", ").trim();
  const trouve = /^(.*?)[,\s]+(\d{5})\s+([^,\d][^,]*?)(?:,\s*(?:france|fr))?\s*$/i.exec(texte);
  if (!trouve) return { adresse: texte, codePostal: "", ville: "" };
  return { adresse: trouve[1]!.replace(/,\s*$/, "").trim(), codePostal: trouve[2]!, ville: trouve[3]!.trim() };
}

/** Recompose l'adresse d'un bloc, pour la rendre au CRM. */
export function adresseEnBloc(c: Pick<ClientSaisi, "adresse" | "codePostal" | "ville">): string {
  return [c.adresse.trim(), [c.codePostal.trim(), c.ville.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

/** Une date `AAAA-MM-JJ` décalée de `jours`. */
export function plusJours(jour: string, jours: number): string {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

/** Les identifiants des lignes d'un devis relu, pour les remplacer. */
export function idsDesLignes(reponse: unknown): number[] {
  if (!reponse || typeof reponse !== "object") return [];
  const items = (reponse as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => (item && typeof item === "object" ? Number((item as { id?: unknown }).id) : NaN))
    .filter((id) => Number.isInteger(id));
}
