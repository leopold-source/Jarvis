import { detailTva, montantLigne, tauxDe, totauxDevis, type ClientSaisi, type SaisieDevis } from "@/lib/devis-emission";
import { EMETTEUR } from "@/lib/emetteur";

/**
 * Le devis tel que Pennylane le mettra en page, avant qu'il n'existe.
 *
 * Calqué sur le PDF de Pennylane : en-tête émetteur, bloc client, tableau des
 * produits, détail de la TVA, récapitulatif, paiement, mentions. La page reste
 * blanche quel que soit le thème de l'application — c'est une feuille, pas un
 * écran. Le numéro n'existe qu'à la création : il est annoncé comme tel.
 */

const EUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const euros = (n: number) => EUR.format(n);
const JOUR = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const date = (jour: string) => (/^\d{4}-\d{2}-\d{2}$/.test(jour) ? JOUR.format(new Date(`${jour}T12:00:00Z`)) : "—");
const PAYS: Record<string, string> = { FR: "France", BE: "Belgique", CH: "Suisse", LU: "Luxembourg", DE: "Allemagne" };

const GRIS = "#7b818a";
const ENCRE = "#1c1f24";
const FOND = "#eef0f2";

function pourcentage(code: Parameters<typeof tauxDe>[0]): string {
  return code === "exempt" ? "0%" : `${String(tauxDe(code) * 100).replace(".", ",")}%`;
}

function quantite(q: number, unite: string): string {
  const n = String(q).replace(".", ",");
  return `${n} ${unite}`;
}

export function DevisApercu({
  saisie,
  client,
  numero,
}: {
  saisie: SaisieDevis;
  client: ClientSaisi;
  numero: string | null;
}) {
  const remise = saisie.remisePct > 0 ? saisie.remisePct : 0;
  const totaux = totauxDevis(saisie.lignes, remise);
  const brut = saisie.lignes.reduce((s, l) => s + montantLigne(l), 0);
  const tva = detailTva(saisie.lignes, remise);

  return (
    <div className="overflow-x-auto rounded-lg bg-neutral-200/60 p-3 sm:p-6 dark:bg-black/40">
      <article
        className="mx-auto flex min-h-[1000px] w-[760px] flex-col bg-white px-12 pt-10 pb-6 text-[11.5px] leading-snug shadow-lg"
        style={{ color: ENCRE, fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}
      >
        {/* En-tête : le logo à gauche, l'émetteur à droite */}
        <header className="flex items-start justify-between gap-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="Antichaos" className="size-[62px] rounded-lg" />
          <div className="w-[255px]">
            <p className="font-medium" style={{ color: GRIS }}>
              {EMETTEUR.nom}
            </p>
            <p>{EMETTEUR.adresse}</p>
            <p>{EMETTEUR.ville}</p>
            <p>{EMETTEUR.email}</p>
            <p>{EMETTEUR.telephone}</p>
          </div>
        </header>

        <div className="mt-5 flex items-start justify-between gap-8">
          <div>
            <h1 className="mb-2 text-[17px] font-medium" style={{ color: GRIS }}>
              Devis
            </h1>
            <dl className="grid grid-cols-[112px_1fr] gap-x-2 gap-y-0.5">
              <dt className="font-semibold">Numéro</dt>
              <dd style={numero ? undefined : { color: GRIS, fontStyle: "italic" }}>{numero ?? "attribué à la création"}</dd>
              <dt className="font-semibold">Date d&apos;émission</dt>
              <dd>{date(saisie.date)}</dd>
              <dt className="font-semibold">Date d&apos;expiration</dt>
              <dd>{date(saisie.echeance)}</dd>
              <dt className="font-semibold">Type de vente</dt>
              <dd>{EMETTEUR.typeDeVente}</dd>
            </dl>
          </div>
          <div className="w-[255px]">
            <p>Client ou Cliente</p>
            <p className="font-medium uppercase" style={{ color: GRIS }}>
              {client.nom || "—"}
            </p>
            {client.siret ? <p>{client.siret.replace(/\s/g, "").slice(0, 9)}</p> : null}
            {client.adresse ? <p className="uppercase">{client.adresse}</p> : null}
            {client.codePostal || client.ville ? (
              <p className="uppercase">
                {[client.codePostal, client.ville].filter(Boolean).join(" ")} -{" "}
                <span className="normal-case">{PAYS[client.pays.toUpperCase()] ?? client.pays}</span>
              </p>
            ) : null}
            {client.tva ? <p>N° de TVA {client.tva.replace(/\s/g, "").toUpperCase()}</p> : null}
          </div>
        </div>

        {/* Objet et description : Pennylane les place en tête du document */}
        {saisie.objet.trim() || saisie.description.trim() ? (
          <div className="mt-5">
            {saisie.objet.trim() ? <p className="text-[12.5px] font-semibold">{saisie.objet}</p> : null}
            {saisie.description.trim() ? <p className="mt-1 whitespace-pre-line">{saisie.description}</p> : null}
          </div>
        ) : null}

        {/* Produits */}
        <table className="mt-5 w-full border-collapse">
          <thead>
            <tr style={{ background: FOND }}>
              {["Produits", "Qté", "Prix u. HT", "TVA (%)", "Total HT", "Total TTC"].map((t, i) => (
                <th key={t} className={`px-1.5 py-1 text-[10.5px] font-medium ${i === 0 ? "text-left" : "text-right"}`}>
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {saisie.lignes.map((l, i) => {
              const ht = montantLigne(l);
              return (
                <tr key={i} className="align-top">
                  <td className="w-[38%] px-1.5 pt-1.5">
                    <p className="font-semibold">{l.libelle || "—"}</p>
                    {l.description.trim() ? <p className="mt-0.5 whitespace-pre-line" style={{ color: GRIS }}>{l.description}</p> : null}
                  </td>
                  <td className="px-1.5 pt-1.5 text-right">{quantite(l.quantite, l.unite)}</td>
                  <td className="px-1.5 pt-1.5 text-right">{euros(l.prixUnitaireHt)}</td>
                  <td className="px-1.5 pt-1.5 text-right">{pourcentage(l.tva)}</td>
                  <td className="px-1.5 pt-1.5 text-right">{euros(ht)}</td>
                  <td className="px-1.5 pt-1.5 text-right">{euros(ht + Math.round(ht * tauxDe(l.tva) * 100) / 100)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Détails TVA et récapitulatif */}
        <div className="mt-7 flex items-start justify-between gap-10">
          <section className="flex-1">
            <h2 className="mb-1 text-[15px] font-medium" style={{ color: GRIS }}>
              Détails TVA
            </h2>
            <table className="w-full">
              <thead>
                <tr className="font-semibold">
                  <th className="text-left">Taux</th>
                  <th className="text-right">Montant TVA</th>
                  <th className="text-right">Base HT</th>
                </tr>
              </thead>
              <tbody>
                {tva.map((t) => (
                  <tr key={t.code}>
                    <td>{t.libelle}</td>
                    <td className="text-right">{euros(t.montant)}</td>
                    <td className="text-right">{euros(t.base)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="w-[205px]">
            <h2 className="mb-1 text-[15px] font-medium" style={{ color: GRIS }}>
              Récapitulatif
            </h2>
            <dl className="grid grid-cols-[1fr_auto] gap-y-0.5 px-1.5">
              {remise ? (
                <>
                  <dt className="font-semibold">Sous-total HT</dt>
                  <dd className="text-right">{euros(brut)}</dd>
                  <dt className="font-semibold">Remise ({String(remise).replace(".", ",")} %)</dt>
                  <dd className="text-right">−{euros(Math.round((brut - totaux.ht) * 100) / 100)}</dd>
                </>
              ) : null}
              <dt className="font-semibold">Total HT</dt>
              <dd className="text-right">{euros(totaux.ht)}</dd>
              <dt className="font-semibold">Total TVA</dt>
              <dd className="text-right">{euros(totaux.tva)}</dd>
            </dl>
            <p className="mt-1.5 flex justify-between px-1.5 py-1 text-[12.5px] font-semibold" style={{ background: FOND }}>
              <span>Total TTC</span>
              <span>{euros(totaux.ttc)}</span>
            </p>
          </section>
        </div>

        {/* Paiement */}
        <section className="mt-14 w-[285px] rounded-md px-4 py-3" style={{ background: "#f3f4f5" }}>
          <h2 className="mb-2 text-[14px] font-medium" style={{ color: GRIS }}>
            Paiement
          </h2>
          <dl className="grid grid-cols-[100px_1fr] gap-y-1">
            <dt className="font-semibold">Établissement</dt>
            <dd>{EMETTEUR.paiement.etablissement}</dd>
            <dt className="font-semibold">IBAN</dt>
            <dd>{EMETTEUR.paiement.iban}</dd>
            <dt className="font-semibold">BIC</dt>
            <dd>{EMETTEUR.paiement.bic}</dd>
          </dl>
        </section>

        {saisie.mentions.trim() ? <p className="mt-4 whitespace-pre-line">{saisie.mentions}</p> : null}
        <p className="mt-4 text-[10.5px] whitespace-pre-line">{EMETTEUR.penalites}</p>
        <p className="mt-3 text-[12px] whitespace-pre-line">{EMETTEUR.signature}</p>

        <footer className="mt-auto flex justify-between pt-10 text-[9px]" style={{ color: GRIS }}>
          <span>{EMETTEUR.mentionsLegales} · Généré par pennylane</span>
          <span>1/1</span>
        </footer>
      </article>
    </div>
  );
}
