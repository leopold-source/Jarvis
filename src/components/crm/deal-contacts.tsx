"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Mail, Phone, Plus, Star, Trash2, Users } from "lucide-react";

import { Badge, Button, Input, Select, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  addDealContact,
  fetchDealContacts,
  removeDealContact,
  setMainDealContact,
  type DealContactLigne,
} from "@/app/(crm)/affaires/actions";

type ContactLite = { id: string; full_name: string | null; email: string | null; company_id: string | null };

/**
 * Les interlocuteurs d'une affaire.
 *
 * Une affaire se mène rarement à une voix : le dirigeant décide, le
 * responsable technique cadre, l'assistante organise. N'en retenir qu'un
 * n'était pas qu'un manque d'affichage — la synchronisation Gmail rattache un
 * message à une affaire *par son contact*, si bien que les échanges avec les
 * deux autres n'étaient rattachés à rien et n'étaient pas conservés. Le fil
 * d'une affaire montrait la moitié de ce qui s'était dit, sans jamais indiquer
 * qu'il en manquait.
 *
 * Le principal reste distingué : c'est lui qu'affichent le tableau, le portail
 * et la conversion d'un lead.
 */
export function DealContacts({
  dealId,
  companyId,
  contacts,
  onChanged,
}: {
  dealId: string;
  companyId: string | null;
  /** L'annuaire complet, déjà chargé par le tableau des affaires. */
  contacts: ContactLite[];
  onChanged: () => void;
}) {
  const toast = useToast();
  const [lignes, setLignes] = useState<DealContactLigne[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ajout, setAjout] = useState("");
  const [role, setRole] = useState("");
  const [occupe, setOccupe] = useState<string | null>(null);

  const recharger = useCallback(async () => {
    const resultat = await fetchDealContacts(dealId);
    if (!resultat.ok) return setErreur(resultat.error);
    setErreur(null);
    setLignes(resultat.data!);
  }, [dealId]);

  useEffect(() => {
    setLignes(null);
    void recharger();
  }, [recharger]);

  async function agir(cle: string, action: () => Promise<{ ok: boolean; error?: string }>) {
    setOccupe(cle);
    const resultat = await action();
    setOccupe(null);
    if (!resultat.ok) return toast(resultat.error ?? "Action impossible.", "error");
    await recharger();
    onChanged();
  }

  const dejaLa = new Set((lignes ?? []).map((ligne) => ligne.contact_id));

  /*
    Ceux de l'entreprise d'abord.

    La liste complète compte tous les contacts du CRM, et celui qu'on cherche
    est presque toujours un collègue de l'interlocuteur déjà présent. Le faire
    remonter évite de parcourir l'annuaire entier pour ajouter la personne qui
    était en copie du dernier message.
  */
  const candidats = contacts
    .filter((contact) => !dejaLa.has(contact.id))
    .sort((a, b) => {
      const chezNous = (contact: ContactLite) =>
        companyId && contact.company_id === companyId ? 0 : 1;
      const rang = chezNous(a) - chezNous(b);
      if (rang !== 0) return rang;
      return (a.full_name ?? a.email ?? "").localeCompare(b.full_name ?? b.email ?? "");
    });

  return (
    <section>
      <h3 className="flex items-center gap-2 text-[12.5px] font-medium text-[var(--text-secondary)]">
        <Users className="size-3.5 text-brand-500 dark:text-brand-300" />
        Interlocuteurs
        {lignes && lignes.length > 0 ? (
          <span className="text-[11px] text-[var(--text-muted)]">({lignes.length})</span>
        ) : null}
      </h3>

      {erreur ? <p className="mt-2 text-[12.5px] text-red-500">{erreur}</p> : null}

      {lignes === null ? (
        <p className="mt-2 flex items-center gap-2 text-[12.5px] text-[var(--text-muted)]">
          <Loader2 className="size-3.5 animate-spin" />
          Chargement…
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {lignes.map((ligne) => (
            <li
              key={ligne.contact_id}
              className={cn(
                "rounded-[10px] border px-3 py-2",
                ligne.principal
                  ? "border-brand-500/30 bg-brand-500/8"
                  : "border-[var(--border-subtle)] bg-[var(--surface-base)]/50",
              )}
            >
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-medium">
                    <Link
                      href={`/contacts?contact=${ligne.contact_id}`}
                      className="truncate hover:text-brand-500 dark:hover:text-brand-300"
                    >
                      {ligne.full_name || ligne.email || "Sans nom"}
                    </Link>
                    {ligne.principal ? <Badge tone="violet">Principal</Badge> : null}
                    {ligne.role ? <Badge tone="stone">{ligne.role}</Badge> : null}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-[var(--text-muted)]">
                    {ligne.job_title ? <span className="truncate">{ligne.job_title}</span> : null}
                    {ligne.email ? (
                      <a href={`mailto:${ligne.email}`} className="inline-flex items-center gap-1 hover:text-brand-500 dark:hover:text-brand-300">
                        <Mail className="size-3" />
                        {ligne.email}
                      </a>
                    ) : null}
                    {ligne.phone ? (
                      <a href={`tel:${ligne.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 hover:text-brand-500 dark:hover:text-brand-300">
                        <Phone className="size-3" />
                        {ligne.phone}
                      </a>
                    ) : null}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {!ligne.principal ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={occupe === `principal:${ligne.contact_id}`}
                        onClick={() =>
                          agir(`principal:${ligne.contact_id}`, () =>
                            setMainDealContact(dealId, ligne.contact_id),
                          )
                        }
                        title="Faire de lui le correspondant de référence"
                      >
                        <Star className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={occupe === `retrait:${ligne.contact_id}`}
                        onClick={() =>
                          agir(`retrait:${ligne.contact_id}`, () =>
                            removeDealContact(dealId, ligne.contact_id),
                          )
                        }
                        title="Retirer de cette affaire"
                        className="text-rose-500 hover:text-rose-400"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Select
          value={ajout}
          onChange={(event) => setAjout(event.target.value)}
          aria-label="Ajouter un interlocuteur"
          className="min-w-0 flex-1 basis-48"
        >
          <option value="">Ajouter un interlocuteur…</option>
          {candidats.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contact.full_name || contact.email || "Sans nom"}
              {companyId && contact.company_id === companyId ? " · même entreprise" : ""}
            </option>
          ))}
        </Select>
        <Input
          value={role}
          onChange={(event) => setRole(event.target.value)}
          placeholder="Rôle (facultatif)"
          aria-label="Rôle dans cette affaire"
          className="w-36 shrink-0"
        />
        <Button
          variant="secondary"
          disabled={!ajout}
          loading={occupe === "ajout"}
          onClick={() =>
            agir("ajout", async () => {
              const resultat = await addDealContact(dealId, ajout, role);
              if (resultat.ok) {
                setAjout("");
                setRole("");
              }
              return resultat;
            })
          }
        >
          <Plus className="size-3.5" />
          Ajouter
        </Button>
      </div>

      <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
        Les échanges e-mail de chaque interlocuteur remontent dans le fil de cette affaire — y
        compris ceux qu&apos;on envoie. La prochaine synchronisation rattrape l&apos;historique.
      </p>
    </section>
  );
}
