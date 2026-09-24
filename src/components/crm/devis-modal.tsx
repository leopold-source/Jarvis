"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Building2,
  ExternalLink,
  FileSignature,
  Loader2,
  Pencil,
  Plus,
  Send,
  Trash2,
} from "lucide-react";

import { Button, Field, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import {
  TAUX_TVA,
  UNITES,
  controlerSaisie,
  totauxDevis,
  type CodeTva,
  type LigneDevis,
  type SaisieDevis,
} from "@/lib/devis-emission";
import { cn } from "@/lib/utils";
import {
  emettreDevis,
  marquerDevisEnvoye,
  preparerDevis,
  relireSaisie,
  type PreparationDevis,
  type ProduitPennylane,
} from "@/app/(crm)/affaires/devis-actions";

/** Une ligne telle qu'on la tape : les nombres restent du texte tant qu'on écrit. */
type LigneForm = Omit<LigneDevis, "quantite" | "prixUnitaireHt"> & { cle: number; quantite: string; prix: string };

let compteur = 0;
const cle = () => (compteur += 1);

const versForm = (l: LigneDevis): LigneForm => ({
  ...l,
  cle: cle(),
  quantite: String(l.quantite),
  prix: String(l.prixUnitaireHt),
});

// Au centime : sur un devis, « 1 250 € » pour 1 250,50 € serait faux.
const EUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const formatMoney = (n: number) => EUR.format(n);

const nombre = (v: string) => Number(v.replace(/\s/g, "").replace(",", "."));

function versSaisie(base: SaisieDevis, lignes: LigneForm[], remise: string): SaisieDevis {
  return {
    ...base,
    remisePct: remise.trim() ? nombre(remise) : 0,
    lignes: lignes.map(({ cle: _c, quantite, prix, ...reste }) => ({
      ...reste,
      quantite: nombre(quantite),
      prixUnitaireHt: nombre(prix),
    })),
  };
}

export type DevisOuvert = { id: string; pennylaneId: string; numero: string | null; brouillon: boolean };

/**
 * Émettre un devis depuis l'affaire.
 *
 * Deux temps. On saisit — client, lignes, textes — puis le devis est créé chez
 * Pennylane et l'aperçu montre son vrai PDF, avec la mise en page de
 * Pennylane : ce que le client recevra, pas une imitation. On corrige autant
 * qu'il faut ; l'e-signature, elle, part de Pennylane, l'API ne la proposant
 * pas. Un clic dit ensuite « c'est envoyé » et l'affaire passe en propale.
 */
export function DevisModal({
  dealId,
  ouvert,
  devis,
  onClose,
  onChanged,
}: {
  dealId: string;
  ouvert: boolean;
  /** Un devis existant : on ouvre directement sur son aperçu. */
  devis: DevisOuvert | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [etape, setEtape] = useState<"chargement" | "saisie" | "apercu">("chargement");
  const [erreur, setErreur] = useState<string | null>(null);
  const [prep, setPrep] = useState<PreparationDevis | null>(null);
  const [base, setBase] = useState<SaisieDevis | null>(null);
  const [lignes, setLignes] = useState<LigneForm[]>([]);
  const [remise, setRemise] = useState("");
  const [emis, setEmis] = useState<DevisOuvert | null>(null);
  /** L'identifiant Pennylane du devis qu'on corrige, s'il y en a un. */
  const [correction, setCorrection] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!ouvert) return;
    setErreur(null);
    setCorrection(null);
    if (devis) {
      setEmis(devis);
      setEtape("apercu");
      return;
    }
    setEmis(null);
    setEtape("chargement");
    let annule = false;
    void preparerDevis(dealId).then((r) => {
      if (annule) return;
      if (!r.ok) {
        setErreur(r.error);
        return;
      }
      setPrep(r.data!);
      setBase(r.data!.saisie);
      setLignes(r.data!.saisie.lignes.map(versForm));
      setRemise("");
      setEtape("saisie");
    });
    return () => {
      annule = true;
    };
  }, [ouvert, dealId, devis]);

  const saisie = base ? versSaisie(base, lignes, remise) : null;
  const totaux = saisie
    ? totauxDevis(
        saisie.lignes.filter((l) => Number.isFinite(l.prixUnitaireHt) && Number.isFinite(l.quantite)),
        Number.isFinite(saisie.remisePct) ? saisie.remisePct : 0,
      )
    : null;
  const erreurs = saisie ? controlerSaisie(saisie) : [];

  function majBase(patch: Partial<SaisieDevis>) {
    setBase((b) => (b ? { ...b, ...patch } : b));
  }
  function majClient(patch: Partial<SaisieDevis["client"]>) {
    setBase((b) => (b ? { ...b, client: { ...b.client, ...patch } } : b));
  }
  function majLigne(k: number, patch: Partial<LigneForm>) {
    setLignes((ls) => ls.map((l) => (l.cle === k ? { ...l, ...patch } : l)));
  }
  function ajouterLigne(produit?: ProduitPennylane) {
    setLignes((ls) => [
      ...ls,
      versForm(
        produit
          ? {
              libelle: produit.libelle,
              description: produit.description,
              quantite: 1,
              prixUnitaireHt: produit.prixHt,
              unite: produit.unite,
              tva: produit.tva,
            }
          : { libelle: "", description: "", quantite: 1, prixUnitaireHt: 0, unite: "jour", tva: "FR_200" },
      ),
    ]);
  }

  async function creer() {
    if (!saisie) return;
    setOccupe(true);
    const r = await emettreDevis(dealId, saisie, correction);
    setOccupe(false);
    if (!r.ok) return toast(r.error, "error");
    const nouveau = { ...r.data!, brouillon: emis?.brouillon ?? true };
    setEmis(nouveau);
    setCorrection(null);
    setVersion((v) => v + 1);
    setEtape("apercu");
    toast(correction ? "Devis corrigé chez Pennylane." : `Devis ${r.data!.numero ?? ""} créé chez Pennylane.`);
    onChanged();
  }

  async function corriger() {
    if (!emis) return;
    setOccupe(true);
    const r = await relireSaisie(emis.pennylaneId);
    setOccupe(false);
    if (!r.ok) return toast(r.error, "error");
    setBase(r.data!);
    setLignes(r.data!.lignes.map(versForm));
    setRemise(r.data!.remisePct ? String(r.data!.remisePct) : "");
    setCorrection(emis.pennylaneId);
    setEtape("saisie");
  }

  async function envoye() {
    if (!emis) return;
    setOccupe(true);
    const r = await marquerDevisEnvoye(emis.id);
    setOccupe(false);
    if (!r.ok) return toast(r.error, "error");
    toast(r.data?.vers ? "Devis envoyé — l'affaire passe en Propale envoyée." : "Devis marqué comme envoyé.");
    onChanged();
    onClose();
  }

  const titre =
    etape === "apercu"
      ? `Devis ${emis?.numero ?? ""}`.trim()
      : correction
        ? "Corriger le devis"
        : "Émettre un devis";

  const pied =
    etape === "saisie" ? (
      <>
        <Button variant="ghost" onClick={correction ? () => setEtape("apercu") : onClose}>
          {correction ? "Revenir à l'aperçu" : "Annuler"}
        </Button>
        <Button
          variant="primary"
          loading={occupe}
          disabled={erreurs.length > 0 || (!prep?.ecriturePermise && prep !== null)}
          onClick={() => void creer()}
        >
          <FileSignature className="size-4" />
          {correction ? "Enregistrer la correction" : "Créer dans Pennylane"}
        </Button>
      </>
    ) : etape === "apercu" ? (
      <>
        <Button variant="ghost" onClick={() => void corriger()} disabled={occupe}>
          <Pencil className="size-4" />
          Corriger
        </Button>
        <a
          href="https://app.pennylane.com/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] px-4 text-sm ring-1 ring-[var(--border-subtle)] transition-colors hover:bg-[var(--surface-hover)] sm:h-9.5"
        >
          <ExternalLink className="size-4" />
          Ouvrir Pennylane
        </a>
        {emis?.brouillon ? (
          <Button variant="primary" loading={occupe} onClick={() => void envoye()}>
            <Send className="size-4" />
            C&apos;est envoyé en e-signature
          </Button>
        ) : null}
      </>
    ) : null;

  return (
    <Modal
      open={ouvert}
      onClose={onClose}
      size="xl"
      title={titre}
      description={
        etape === "apercu"
          ? emis?.brouillon
            ? "Le PDF de Pennylane, tel que le client le recevra. Envoyez-le en e-signature depuis Pennylane, puis confirmez ici."
            : "Le PDF de Pennylane."
          : "Le devis est créé chez Pennylane avec sa mise en page ; rien ne part chez le client."
      }
      footer={pied}
    >
      {erreur ? (
        <p className="flex items-start gap-2 text-[13px] text-rose-500">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {erreur}
        </p>
      ) : etape === "chargement" ? (
        <p className="flex items-center gap-2 text-[13px] text-[var(--text-muted)]">
          <Loader2 className="size-4 animate-spin" /> Lecture du client et du catalogue chez Pennylane…
        </p>
      ) : etape === "apercu" && emis ? (
        <iframe
          key={version}
          title="Aperçu du devis"
          src={`/api/devis/${encodeURIComponent(emis.pennylaneId)}/pdf?v=${version}`}
          className="h-[70dvh] w-full rounded-[10px] bg-white ring-1 ring-[var(--border-subtle)]"
        />
      ) : base && saisie ? (
        <div className="space-y-5">
          {prep && !prep.ecriturePermise ? (
            <p className="flex items-start gap-2 rounded-[10px] bg-amber-500/10 px-3 py-2 text-[12.5px] text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              L&apos;écriture vers Pennylane est coupée. Ajoutez PENNYLANE_ENABLED=true dans les variables Vercel
              pour créer le devis.
            </p>
          ) : null}

          {correction ? null : <BlocClient prep={prep} base={base} majBase={majBase} majClient={majClient} />}

          <section className="grid gap-3 sm:grid-cols-[1fr_160px_160px]">
            <Field label="Objet du devis">
              <Input value={base.objet} onChange={(e) => majBase({ objet: e.target.value })} />
            </Field>
            <Field label="Date">
              <Input type="date" value={base.date} onChange={(e) => majBase({ date: e.target.value })} />
            </Field>
            <Field label="Valable jusqu'au">
              <Input type="date" value={base.echeance} onChange={(e) => majBase({ echeance: e.target.value })} />
            </Field>
          </section>

          <section>
            <h3 className="mb-2 text-[12.5px] font-medium text-[var(--text-secondary)]">Lignes</h3>
            <div className="space-y-2">
              {lignes.map((ligne, i) => (
                <LigneSaisie
                  key={ligne.cle}
                  ligne={ligne}
                  numero={i + 1}
                  onChange={(patch) => majLigne(ligne.cle, patch)}
                  onRemove={lignes.length > 1 ? () => setLignes((ls) => ls.filter((l) => l.cle !== ligne.cle)) : undefined}
                />
              ))}
            </div>
            <datalist id="unites-devis">
              {UNITES.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => ajouterLigne()}>
                <Plus className="size-3.5" /> Ligne
              </Button>
              {prep && prep.produits.length > 0 ? (
                <Select
                  value=""
                  aria-label="Ajouter un produit du catalogue"
                  onChange={(e) => {
                    const p = prep.produits.find((x) => String(x.id) === e.target.value);
                    if (p) ajouterLigne(p);
                  }}
                  className="h-9 sm:h-8 sm:text-[13px]"
                >
                  <option value="">Depuis le catalogue Pennylane…</option>
                  {prep.produits.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.libelle} · {formatMoney(p.prixHt)}
                    </option>
                  ))}
                </Select>
              ) : null}
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <Field label="Description" hint="Sous l'objet, en tête du devis.">
              <Textarea rows={3} value={base.description} onChange={(e) => majBase({ description: e.target.value })} />
            </Field>
            <Field label="Mentions" hint="Conditions, modalités de paiement… en pied de devis.">
              <Textarea rows={3} value={base.mentions} onChange={(e) => majBase({ mentions: e.target.value })} />
            </Field>
          </section>

          <section className="flex flex-wrap items-end justify-between gap-4 border-t border-[var(--border-subtle)] pt-4">
            <Field label="Remise globale (%)" className="w-40">
              <Input inputMode="decimal" value={remise} placeholder="0" onChange={(e) => setRemise(e.target.value)} />
            </Field>
            {totaux ? (
              <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-0.5 text-right text-[13px] tabular-nums">
                <dt className="text-[var(--text-muted)]">Total HT</dt>
                <dd>{formatMoney(totaux.ht)}</dd>
                <dt className="text-[var(--text-muted)]">TVA</dt>
                <dd>{formatMoney(totaux.tva)}</dd>
                <dt className="font-medium">Total TTC</dt>
                <dd className="font-semibold">{formatMoney(totaux.ttc)}</dd>
              </dl>
            ) : null}
          </section>

          {erreurs.length > 0 ? (
            <ul className="space-y-0.5 text-[12px] text-[var(--text-muted)]">
              {erreurs.map((e) => (
                <li key={e}>· {e}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

function BlocClient({
  prep,
  base,
  majBase,
  majClient,
}: {
  prep: PreparationDevis | null;
  base: SaisieDevis;
  majBase: (patch: Partial<SaisieDevis>) => void;
  majClient: (patch: Partial<SaisieDevis["client"]>) => void;
}) {
  const connu = prep?.clientPennylane;
  if (base.clientPennylaneId && connu) {
    return (
      <section className="flex items-center gap-3 rounded-[10px] bg-[var(--surface-base)]/60 px-3 py-2.5 ring-1 ring-[var(--border-subtle)]">
        <Building2 className="size-4 shrink-0 text-brand-500 dark:text-brand-300" />
        <p className="min-w-0 flex-1 text-[13px]">
          <span className="font-medium">{connu.nom}</span>
          <span className="text-[var(--text-muted)]"> · client Pennylane existant</span>
        </p>
        <button
          type="button"
          onClick={() => majBase({ clientPennylaneId: null })}
          className="text-[12px] text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text-primary)] hover:underline"
        >
          Créer un autre client
        </button>
      </section>
    );
  }

  const c = base.client;
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-[12.5px] font-medium text-[var(--text-secondary)]">
        <Building2 className="size-3.5" /> Nouveau client Pennylane
        {connu ? (
          <button
            type="button"
            onClick={() => majBase({ clientPennylaneId: connu.id })}
            className="ml-auto text-[12px] font-normal text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:underline"
          >
            Reprendre « {connu.nom} »
          </button>
        ) : null}
      </h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Raison sociale" className="sm:col-span-2">
          <Input value={c.nom} onChange={(e) => majClient({ nom: e.target.value })} />
        </Field>
        <Field label="SIREN / SIRET">
          <Input inputMode="numeric" value={c.siret} onChange={(e) => majClient({ siret: e.target.value })} />
        </Field>
        <Field label="Adresse" className="sm:col-span-3">
          <Input value={c.adresse} onChange={(e) => majClient({ adresse: e.target.value })} />
        </Field>
        <Field label="Code postal">
          <Input inputMode="numeric" value={c.codePostal} onChange={(e) => majClient({ codePostal: e.target.value })} />
        </Field>
        <Field label="Ville">
          <Input value={c.ville} onChange={(e) => majClient({ ville: e.target.value })} />
        </Field>
        <Field label="Pays">
          <Input value={c.pays} maxLength={2} onChange={(e) => majClient({ pays: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="E-mail de facturation">
          <Input type="email" value={c.email} onChange={(e) => majClient({ email: e.target.value })} />
        </Field>
        <Field label="À l'attention de">
          <Input value={c.destinataire} onChange={(e) => majClient({ destinataire: e.target.value })} />
        </Field>
        <Field label="N° TVA intracom.">
          <Input value={c.tva} onChange={(e) => majClient({ tva: e.target.value })} />
        </Field>
      </div>
    </section>
  );
}

function LigneSaisie({
  ligne,
  numero,
  onChange,
  onRemove,
}: {
  ligne: LigneForm;
  numero: number;
  onChange: (patch: Partial<LigneForm>) => void;
  onRemove?: () => void;
}) {
  const montant = nombre(ligne.quantite) * nombre(ligne.prix);
  return (
    <div className="rounded-[10px] bg-[var(--surface-base)]/50 p-2.5 ring-1 ring-[var(--border-subtle)]">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_80px_120px_110px_100px_auto] sm:items-center">
        <Input
          aria-label={`Libellé de la ligne ${numero}`}
          placeholder="Libellé"
          value={ligne.libelle}
          onChange={(e) => onChange({ libelle: e.target.value })}
          className="col-span-2 sm:col-span-1"
        />
        <Input
          aria-label="Quantité"
          inputMode="decimal"
          value={ligne.quantite}
          onChange={(e) => onChange({ quantite: e.target.value })}
        />
        <Input
          aria-label="Unité"
          list="unites-devis"
          value={ligne.unite}
          onChange={(e) => onChange({ unite: e.target.value })}
        />
        <Input
          aria-label="Prix unitaire HT"
          inputMode="decimal"
          value={ligne.prix}
          onChange={(e) => onChange({ prix: e.target.value })}
        />
        <Select aria-label="TVA" value={ligne.tva} onChange={(e) => onChange({ tva: e.target.value as CodeTva })}>
          {TAUX_TVA.map((t) => (
            <option key={t.code} value={t.code}>
              {t.libelle}
            </option>
          ))}
        </Select>
        <div className="col-span-2 flex items-center justify-end gap-2 sm:col-span-1">
          <span className={cn("text-[12.5px] tabular-nums", !Number.isFinite(montant) && "text-rose-500")}>
            {Number.isFinite(montant) ? formatMoney(montant) : "—"}
          </span>
          {onRemove ? (
            <button
              type="button"
              onClick={onRemove}
              aria-label="Retirer la ligne"
              className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-rose-500"
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      <Textarea
        aria-label="Description de la ligne"
        rows={1}
        placeholder="Description (facultatif)"
        value={ligne.description}
        onChange={(e) => onChange({ description: e.target.value })}
        className="mt-2 text-[13px] sm:text-[12.5px]"
      />
    </div>
  );
}
