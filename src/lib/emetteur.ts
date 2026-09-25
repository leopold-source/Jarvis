/**
 * L'émetteur des devis, tel que Pennylane l'imprime.
 *
 * Repris du PDF produit par Pennylane : l'aperçu de l'application doit
 * montrer ce que le client lira. Si l'une de ces informations change chez
 * Pennylane (adresse, banque), elle change ici aussi.
 */
export const EMETTEUR = {
  nom: "Antichaos",
  adresse: "3 grand place",
  ville: "59227 Saulzoir - France",
  email: "leopold@antichaos.fr",
  telephone: "+33 7 82 43 92 12",
  typeDeVente: "Prestations de services",
  paiement: { etablissement: "SWAN SAS", iban: "FR76 1732 8844 0094 5443 1875 408", bic: "SWNBFR22" },
  penalites:
    "Pénalités de retard : trois fois le taux annuel d'intérêt légal en vigueur calculé depuis la date d'échéance jusqu'à complet paiement du prix.\nIndemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 €",
  signature: "Date et signature précédées de la mention\n« Bon pour accord »",
  mentionsLegales: "Antichaos | SAS, société par actions simplifiée au capital social de 1 000,00 € | N° SIREN 105.789.143",
} as const;
