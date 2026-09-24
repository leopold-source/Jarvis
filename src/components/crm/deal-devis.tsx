"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Eye, FileSignature, Link2, Loader2, Plus, RefreshCw, Send, Unlink } from "lucide-react";

import { Badge, Button, Select, useToast } from "@/components/ui";
import type { DevisPennylane } from "@/lib/database.types";
import { aRelancer } from "@/lib/devis-logique";
import type { Tone } from "@/lib/constants";
import { formatDate, formatMoney, todayIso } from "@/lib/utils";
import { DevisModal, type DevisOuvert } from "@/components/crm/devis-modal";
import {
  fetchDevisAffaire,
  lierDevis,
  marquerDevisEnvoye,
  synchroniserDevisMaintenant,
} from "@/app/(crm)/affaires/devis-actions";

type Statut = DevisPennylane["statut"];

export const STATUT_DEVIS: Record<Statut, { label: string; tone: Tone }> = {
  brouillon: { label: "Devis en brouillon", tone: "stone" },
  en_attente: { label: "Devis envoyé", tone: "sky" },
  accepte: { label: "Devis signé", tone: "emerald" },
  refuse: { label: "Devis refusé", tone: "rose" },
  facture: { label: "Devis facturé", tone: "emerald" },
  expire: { label: "Devis expiré", tone: "amber" },
  inconnu: { label: "Devis", tone: "stone" },
};

export type DevisLeger = Pick<DevisPennylane, "deal_id" | "statut" | "montant_ht" | "echeance_le" | "emis_le">;

const DevisContext = createContext<Map<string, DevisLeger>>(new Map());

/** Le devis le plus récent de chaque affaire, pour le badge des cartes. */
export function DevisProvider({ devis, children }: { devis: DevisLeger[]; children: React.ReactNode }) {
  const parAffaire = new Map<string, DevisLeger>();
  for (const d of devis) {
    if (!d.deal_id) continue;
    const deja = parAffaire.get(d.deal_id);
    if (!deja || (d.emis_le ?? "") > (deja.emis_le ?? "")) parAffaire.set(d.deal_id, d);
  }
  return <DevisContext.Provider value={parAffaire}>{children}</DevisContext.Provider>;
}

/**
 * Le statut du devis sur la carte : envoyé, signé, expiré.
 *
 * « À relancer » prend le pas sur tout le reste : c'est la seule de ces
 * informations qui appelle un geste aujourd'hui.
 */
export function DevisBadge({ dealId }: { dealId: string }) {
  const devis = useContext(DevisContext).get(dealId);
  if (!devis) return null;
  const relance = aRelancer(devis, todayIso());
  const meta = STATUT_DEVIS[devis.statut];
  return (
    <Badge tone={relance ? "amber" : meta.tone}>
      <FileSignature className="size-3" />
      {relance ? "Devis à relancer" : meta.label.replace("Devis ", "")}
    </Badge>
  );
}

type DevisAffiche = Omit<DevisPennylane, "raw">;

/**
 * Les devis Pennylane de l'affaire.
 *
 * Un devis s'émet d'ici : saisi dans l'application, créé chez Pennylane, relu
 * sur son vrai PDF. L'e-signature part de Pennylane ; on confirme ensuite
 * l'envoi d'un clic, et l'affaire suit : devis envoyé, elle passe en propale ;
 * devis signé, elle est gagnée et son projet est créé. Un devis fait
 * directement dans Pennylane se rattache seul, ou à la main.
 */
export function DealDevis({ dealId, onChanged }: { dealId: string; onChanged: () => void }) {
  const toast = useToast();
  const [lies, setLies] = useState<DevisAffiche[] | null>(null);
  const [libres, setLibres] = useState<DevisAffiche[]>([]);
  const [choix, setChoix] = useState("");
  const [occupe, setOccupe] = useState(false);
  const [modal, setModal] = useState<{ devis: DevisOuvert | null } | null>(null);

  const charger = useCallback(async () => {
    const resultat = await fetchDevisAffaire(dealId);
    if (!resultat.ok) return setLies([]);
    setLies(resultat.data!.lies);
    setLibres(resultat.data!.libres);
  }, [dealId]);

  useEffect(() => {
    setLies(null);
    void charger();
  }, [charger]);

  async function synchroniser() {
    setOccupe(true);
    const bilan = await synchroniserDevisMaintenant();
    setOccupe(false);
    if (!bilan.ok) return toast(bilan.error, "error");
    toast(
      bilan.transitions.length
        ? bilan.transitions.map((t) => `« ${t.nom} » → ${t.vers === "gagne" ? "Gagné" : "Propale envoyée"}`).join(" · ")
        : `${bilan.lus} devis relu(s) chez Pennylane.`,
    );
    await charger();
    onChanged();
  }

  async function lier(devisId: string, cible: string | null) {
    setOccupe(true);
    const resultat = await lierDevis(devisId, cible);
    setOccupe(false);
    if (!resultat.ok) return toast(resultat.error, "error");
    setChoix("");
    await charger();
    onChanged();
  }

  async function envoye(devisId: string) {
    setOccupe(true);
    const resultat = await marquerDevisEnvoye(devisId);
    setOccupe(false);
    if (!resultat.ok) return toast(resultat.error, "error");
    toast(resultat.data?.vers ? "Devis envoyé — l'affaire passe en Propale envoyée." : "Devis marqué comme envoyé.");
    await charger();
    onChanged();
  }

  const aujourdhui = todayIso();

  return (
    <section>
      <h3 className="flex items-center gap-2 text-[12.5px] font-medium text-[var(--text-secondary)]">
        <FileSignature className="size-3.5 text-brand-500 dark:text-brand-300" />
        Devis Pennylane
        <button
          type="button"
          onClick={() => setModal({ devis: null })}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium text-brand-600 transition-colors hover:bg-brand-500/10 dark:text-brand-300"
        >
          <Plus className="size-3.5" />
          Émettre un devis
        </button>
        <button
          type="button"
          onClick={() => void synchroniser()}
          disabled={occupe}
          title="Relire Pennylane maintenant"
          className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
        >
          {occupe ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        </button>
      </h3>

      {lies === null ? (
        <p className="mt-2 flex items-center gap-2 text-[12.5px] text-[var(--text-muted)]">
          <Loader2 className="size-3.5 animate-spin" /> Chargement…
        </p>
      ) : lies.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-[var(--text-muted)]">
          Aucun devis rattaché. Émettez-le d&apos;ici, ou créez-le dans Pennylane : il apparaîtra
          ici, et l&apos;affaire avancera toute seule à la signature.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {lies.map((devis) => {
            const relance = aRelancer(devis, aujourdhui);
            const meta = STATUT_DEVIS[devis.statut];
            return (
              <li
                key={devis.id}
                className="flex items-center gap-2 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--surface-base)]/50 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-medium">
                    <span className="font-mono">{devis.numero ?? "Devis"}</span>
                    <Badge tone={relance ? "amber" : meta.tone}>{relance ? "À relancer" : meta.label.replace("Devis ", "")}</Badge>
                  </p>
                  <p className="text-[11px] text-[var(--text-muted)] tabular-nums">
                    {formatMoney(devis.montant_ht)} HT · émis le {formatDate(devis.emis_le)}
                    {devis.echeance_le ? ` · échéance ${formatDate(devis.echeance_le)}` : ""}
                  </p>
                </div>
                {devis.statut === "brouillon" ? (
                  <button
                    type="button"
                    onClick={() => void envoye(devis.id)}
                    disabled={occupe}
                    title="Je l'ai envoyé en e-signature depuis Pennylane"
                    className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                  >
                    <Send className="size-3" />
                    Envoyé
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    setModal({
                      devis: {
                        id: devis.id,
                        pennylaneId: devis.pennylane_id,
                        numero: devis.numero,
                        brouillon: devis.statut === "brouillon",
                      },
                    })
                  }
                  aria-label="Voir le devis"
                  title="Voir le PDF Pennylane"
                  className="shrink-0 rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                >
                  <Eye className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void lier(devis.id, null)}
                  aria-label="Détacher de l'affaire"
                  title="Ce devis n'appartient pas à cette affaire"
                  className="shrink-0 rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-rose-500"
                >
                  <Unlink className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {libres.length > 0 ? (
        <div className="mt-2 flex items-center gap-2">
          <Select value={choix} onChange={(e) => setChoix(e.target.value)} aria-label="Rattacher un devis" className="min-w-0 flex-1">
            <option value="">Rattacher un devis Pennylane…</option>
            {libres.map((d) => (
              <option key={d.id} value={d.id}>
                {[d.numero, d.client_nom, d.montant_ht != null ? formatMoney(d.montant_ht) : null].filter(Boolean).join(" · ")}
              </option>
            ))}
          </Select>
          <Button variant="secondary" disabled={!choix || occupe} onClick={() => void lier(choix, dealId)}>
            <Link2 className="size-3.5" />
            Rattacher
          </Button>
        </div>
      ) : null}

      <DevisModal
        dealId={dealId}
        ouvert={modal !== null}
        devis={modal?.devis ?? null}
        onClose={() => setModal(null)}
        onChanged={() => {
          void charger();
          onChanged();
        }}
      />
    </section>
  );
}
