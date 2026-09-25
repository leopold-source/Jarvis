"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CalendarCheck, CalendarX, Loader2, Send } from "lucide-react";

import { Button, Field, Input, Modal, Textarea, useToast } from "@/components/ui";
import { ChampAdresses } from "@/components/crm/recap-modal";
import { mailConfirmation } from "@/lib/rdv-logique";
import { depuisSaisieParis, formatDateHeure, versSaisieParis } from "@/lib/utils";
import {
  envoyerConfirmation,
  preparerConfirmation,
  type Confirmation,
} from "@/app/(crm)/affaires/confirmation-actions";

/**
 * Le mail de confirmation du rendez-vous, au moment du « call pris ».
 *
 * La date vient de l'agenda de l'équipe quand un rendez-vous réunit déjà le
 * prospect ; sinon le mail part sans date, ou avec celle qu'on saisit. Tant
 * qu'on n'a pas touché au texte, il suit la date ; une fois retouché, il est
 * à nous et ne bouge plus. Rien ne part sans le bouton « Envoyer ».
 */
export function ConfirmationModal({
  dealId,
  ouvert,
  onClose,
  onEnvoye,
}: {
  dealId: string | null;
  ouvert: boolean;
  onClose: () => void;
  onEnvoye?: () => void;
}) {
  const toast = useToast();
  const [detail, setDetail] = useState<Confirmation | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [quand, setQuand] = useState("");
  const [visio, setVisio] = useState("");
  const [objet, setObjet] = useState("");
  const [corps, setCorps] = useState("");
  const [retouche, setRetouche] = useState(false);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    if (!ouvert || !dealId) return;
    setDetail(null);
    setErreur(null);
    setRetouche(false);
    let annule = false;
    void preparerConfirmation(dealId).then((r) => {
      if (annule) return;
      if (!r.ok) return setErreur(r.error);
      const d = r.data!;
      setDetail(d);
      setTo(d.to);
      setCc([]);
      setQuand(versSaisieParis(d.rdv?.debut));
      setVisio(d.rdv?.visio ?? "");
      setObjet(d.mail.subject);
      setCorps(d.mail.body);
    });
    return () => {
      annule = true;
    };
  }, [ouvert, dealId]);

  /** Réécrit le brouillon d'après la date, tant qu'il n'a pas été retouché. */
  function suivreDate(nouvelle: string, lien: string) {
    if (retouche || !detail) return;
    const debut = depuisSaisieParis(nouvelle);
    const mail = mailConfirmation({ prenom: detail.prenom, rdv: debut ? { debut, visio: lien.trim() || null } : null });
    setObjet(mail.subject);
    setCorps(mail.body);
  }

  async function envoyer() {
    if (!dealId) return;
    setEnvoi(true);
    const r = await envoyerConfirmation(dealId, { to, cc, subject: objet, body: corps }, depuisSaisieParis(quand));
    setEnvoi(false);
    if (!r.ok) return toast(r.error, "error");
    toast("Confirmation envoyée — elle est rangée dans le fil de l'affaire.");
    onEnvoye?.();
    onClose();
  }

  const rdv = detail?.rdv;

  return (
    <Modal
      open={ouvert}
      onClose={onClose}
      size="lg"
      title="Confirmer le rendez-vous"
      description="Un mail de confirmation au prospect, depuis votre boîte Gmail."
      footer={
        detail ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Plus tard
            </Button>
            <Button variant="primary" loading={envoi} disabled={!to.length || !objet.trim()} onClick={() => void envoyer()}>
              <Send className="size-4" />
              Envoyer
            </Button>
          </>
        ) : null
      }
    >
      {erreur ? (
        <p className="flex items-start gap-2 text-[13px] text-rose-500">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {erreur}
        </p>
      ) : !detail ? (
        <p className="flex items-center gap-2 text-[13px] text-[var(--text-muted)]">
          <Loader2 className="size-4 animate-spin" /> Recherche du rendez-vous dans les agendas de l&apos;équipe…
        </p>
      ) : (
        <div className="space-y-4">
          {rdv ? (
            <p className="flex items-start gap-2 rounded-[10px] bg-emerald-500/10 px-3 py-2 text-[12.5px] text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-300">
              <CalendarCheck className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Trouvé dans l&apos;agenda{rdv.agenda ? ` de ${rdv.agenda}` : ""} : « {rdv.titre} », le{" "}
                {formatDateHeure(rdv.debut, { avecAnnee: true })}.
              </span>
            </p>
          ) : (
            <p className="flex items-start gap-2 rounded-[10px] bg-[var(--surface-hover)] px-3 py-2 text-[12.5px] text-[var(--text-secondary)]">
              <CalendarX className="mt-0.5 size-3.5 shrink-0" />
              Aucun rendez-vous avec ce prospect dans les agendas de l&apos;équipe : le mail part sans date, ou
              choisissez-en une.
            </p>
          )}
          {detail.dejaEnvoyee ? (
            <p className="text-[12px] text-amber-600 dark:text-amber-300">
              Une confirmation est déjà partie le {formatDateHeure(detail.dejaEnvoyee.at)}
              {detail.dejaEnvoyee.rdv ? ` (rendez-vous du ${formatDateHeure(detail.dejaEnvoyee.rdv)})` : ""}.
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
            <Field label="Rendez-vous (heure de Paris)">
              <Input
                type="datetime-local"
                value={quand}
                onChange={(e) => {
                  setQuand(e.target.value);
                  suivreDate(e.target.value, visio);
                }}
              />
            </Field>
            <Field label="Lien visio">
              <Input
                value={visio}
                placeholder="https://meet.google.com/…"
                onChange={(e) => {
                  setVisio(e.target.value);
                  suivreDate(quand, e.target.value);
                }}
              />
            </Field>
          </div>

          <Field label="À">
            <ChampAdresses valeur={to} onChange={setTo} placeholder="adresse@client.fr" label="Destinataires" />
          </Field>
          <Field label="Cc">
            <ChampAdresses valeur={cc} onChange={setCc} placeholder="Associé, collègue…" label="Copie" />
          </Field>
          <Field label="Objet">
            <Input
              value={objet}
              onChange={(e) => {
                setObjet(e.target.value);
                setRetouche(true);
              }}
            />
          </Field>
          <Field label="Message" hint={retouche ? "Texte retouché : il ne suit plus la date." : undefined}>
            <Textarea
              rows={10}
              value={corps}
              onChange={(e) => {
                setCorps(e.target.value);
                setRetouche(true);
              }}
            />
          </Field>
          <div>
            <p className="mb-1.5 text-[12.5px] font-medium text-[var(--text-secondary)]">
              Signature{" "}
              {detail.expediteur ? <span className="font-normal text-[var(--text-muted)]">· {detail.expediteur}</span> : null}
            </p>
            {detail.signature ? (
              <iframe
                title="Signature Gmail"
                sandbox=""
                srcDoc={`<body style="margin:0;font:13px -apple-system,Segoe UI,sans-serif;color:#333;background:#fff">${detail.signature}</body>`}
                className="h-24 w-full rounded-xl border border-[var(--border-subtle)] bg-white"
              />
            ) : (
              <p className="text-[12px] text-[var(--text-muted)]">
                {detail.expediteur
                  ? "Aucune signature réglée dans Gmail pour cette adresse : le mail partira sans."
                  : "Connectez votre boîte Gmail dans les Réglages pour envoyer depuis l'application."}
              </p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
