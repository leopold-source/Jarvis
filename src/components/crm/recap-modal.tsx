"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { AlertTriangle, Clock, Loader2, Mail, RotateCcw, Send, Sparkles, X } from "lucide-react";

import { Button, Field, Input, Modal, Textarea, useToast } from "@/components/ui";
import type { RecapStatut } from "@/lib/database.types";
import { cn, formatDateHeure } from "@/lib/utils";
import {
  ecarterRecap,
  enregistrerRecap,
  envoyerRecap,
  fetchRecapDeLAffaire,
  fetchRecapsOuverts,
  preparerRecap,
  relancerRecap,
  type RecapDetail,
} from "@/app/(crm)/affaires/recap-actions";

export type RecapLeger = { id: string; deal_id: string; status: RecapStatut; updated_at: string };

const EN_COURS: RecapStatut[] = ["en_attente_call", "redaction"];

type Pilote = {
  statutDe: (dealId: string) => RecapStatut | null;
  ouvrir: (dealId: string) => void;
  /** Le passage en R2 vient d'avoir lieu : on attend le récap sans recharger. */
  signaler: (dealId: string) => void;
};

const RecapsContext = createContext<Pilote>({
  statutDe: () => null,
  ouvrir: () => {},
  signaler: () => {},
});

export const useRecaps = () => useContext(RecapsContext);

/**
 * Le suivi des récaps sur le tableau des affaires.
 *
 * Un récap se prépare en arrière-plan : on attend Claap, puis le modèle. Tant
 * qu'il y en a un en cours, le tableau demande où il en est toutes les douze
 * secondes — une requête légère, et seulement tant que c'est utile. Quand il
 * devient prêt, on le dit : c'est tout l'intérêt de ne pas avoir attendu.
 */
export function RecapsProvider({
  initial,
  nomDe,
  children,
}: {
  initial: RecapLeger[];
  nomDe: (dealId: string) => string;
  children: React.ReactNode;
}) {
  const toast = useToast();
  const [recaps, setRecaps] = useState(initial);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const courant = useRef(recaps);
  useEffect(() => {
    courant.current = recaps;
  }, [recaps]);

  useEffect(() => setRecaps(initial), [initial]);

  const enCours = recaps.some((r) => EN_COURS.includes(r.status));

  const rafraichir = useCallback(async () => {
    const frais = (await fetchRecapsOuverts()) as RecapLeger[];
    for (const recap of frais) {
      const avant = courant.current.find((r) => r.deal_id === recap.deal_id);
      if (recap.status === "pret" && avant && avant.status !== "pret") {
        toast(`Récap prêt à relire : ${nomDe(recap.deal_id)}`);
      }
      if (recap.status === "echec" && avant && avant.status !== "echec") {
        toast(`Le récap de « ${nomDe(recap.deal_id)} » n'a pas pu être rédigé.`, "error");
      }
    }
    setRecaps(frais);
  }, [toast, nomDe]);

  useEffect(() => {
    if (!enCours) return;
    const minuteur = setInterval(() => void rafraichir(), 12_000);
    return () => clearInterval(minuteur);
  }, [enCours, rafraichir]);

  const pilote = useMemo<Pilote>(
    () => ({
      statutDe: (dealId) => recaps.find((r) => r.deal_id === dealId)?.status ?? null,
      ouvrir: setOuvert,
      signaler: (dealId) =>
        setRecaps((liste) =>
          liste.some((r) => r.deal_id === dealId)
            ? liste
            : [...liste, { id: `local-${dealId}`, deal_id: dealId, status: "en_attente_call", updated_at: "" }],
        ),
    }),
    [recaps],
  );

  return (
    <RecapsContext.Provider value={pilote}>
      {children}
      <RecapModal
        dealId={ouvert}
        nom={ouvert ? nomDe(ouvert) : ""}
        onClose={() => setOuvert(null)}
        onChanged={() => void rafraichir()}
      />
    </RecapsContext.Provider>
  );
}

const BADGE: Record<RecapStatut, { texte: string; classe: string } | null> = {
  en_attente_call: { texte: "Récap · attente du call", classe: "text-[var(--text-muted)] ring-[var(--border-strong)]" },
  redaction: { texte: "Récap · rédaction", classe: "text-[var(--text-muted)] ring-[var(--border-strong)]" },
  pret: { texte: "Récap prêt", classe: "bg-brand-500/12 text-brand-600 ring-brand-500/40 dark:text-brand-300" },
  echec: { texte: "Récap en échec", classe: "bg-rose-500/10 text-rose-600 ring-rose-500/30 dark:text-rose-300" },
  envoye: null,
  ecarte: null,
};

/** Le badge d'une carte d'affaire. Un clic ouvre le récap, sans ouvrir l'affaire. */
export function RecapBadge({ dealId }: { dealId: string }) {
  const { statutDe, ouvrir } = useRecaps();
  const statut = statutDe(dealId);
  const badge = statut ? BADGE[statut] : null;
  if (!statut || !badge) return null;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        ouvrir(dealId);
      }}
      onPointerDown={(event) => event.stopPropagation()}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset transition-colors",
        badge.classe,
      )}
    >
      {statut === "redaction" ? <Loader2 className="size-3 animate-spin" /> : null}
      {statut === "en_attente_call" ? <Clock className="size-3" /> : null}
      {statut === "pret" ? <Mail className="size-3" /> : null}
      {statut === "echec" ? <AlertTriangle className="size-3" /> : null}
      {badge.texte}
    </button>
  );
}

/**
 * Des adresses en pastilles.
 *
 * Entrée, virgule ou point-virgule valident ; un collage de plusieurs
 * adresses se découpe tout seul. Une adresse mal formée reste visible, en
 * rouge, plutôt que d'être refusée en silence.
 */
function ChampAdresses({
  valeur,
  onChange,
  placeholder,
  label,
}: {
  valeur: string[];
  onChange: (valeur: string[]) => void;
  placeholder: string;
  label: string;
}) {
  const [saisie, setSaisie] = useState("");

  function ajouter(texte: string) {
    const nouvelles = texte
      .split(/[\s,;]+/)
      .map((a) => a.trim().replace(/^<|>$/g, "").toLowerCase())
      .filter(Boolean);
    if (nouvelles.length) onChange([...new Set([...valeur, ...nouvelles])]);
    setSaisie("");
  }

  function touche(event: KeyboardEvent<HTMLInputElement>) {
    if (["Enter", ",", ";"].includes(event.key)) {
      event.preventDefault();
      ajouter(saisie);
    } else if (event.key === "Backspace" && !saisie && valeur.length) {
      onChange(valeur.slice(0, -1));
    }
  }

  return (
    <div
      className={cn(
        "flex min-h-11 flex-wrap items-center gap-1.5 rounded-[10px] bg-[var(--surface-input)] px-2 py-1.5 sm:min-h-9.5",
        "ring-1 ring-[var(--border-subtle)] focus-within:ring-2 focus-within:ring-brand-500/70",
      )}
    >
      {valeur.map((adresse) => {
        const valide = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adresse);
        return (
          <span
            key={adresse}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px]",
              valide ? "bg-[var(--surface-hover)]" : "bg-rose-500/15 text-rose-600 dark:text-rose-300",
            )}
          >
            {adresse}
            <button
              type="button"
              onClick={() => onChange(valeur.filter((a) => a !== adresse))}
              aria-label={`Retirer ${adresse}`}
              className="rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X className="size-3" />
            </button>
          </span>
        );
      })}
      <input
        value={saisie}
        onChange={(event) => setSaisie(event.target.value)}
        onKeyDown={touche}
        onBlur={() => saisie.trim() && ajouter(saisie)}
        onPaste={(event) => {
          const texte = event.clipboardData.getData("text");
          if (/[,;\s]/.test(texte.trim())) {
            event.preventDefault();
            ajouter(texte);
          }
        }}
        placeholder={valeur.length ? "" : placeholder}
        aria-label={label}
        className="min-w-32 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-[var(--text-muted)] sm:text-sm"
      />
    </div>
  );
}

/**
 * La popup du mail récap.
 *
 * Tout y est modifiable — destinataires, copie, objet, texte — et rien ne part
 * sans le bouton « Envoyer ». La signature n'est pas dans le texte : elle est
 * celle de Gmail, ajoutée à l'envoi, et montrée ici pour qu'on sache à quoi
 * ressemblera le mail.
 */
function RecapModal({
  dealId,
  nom,
  onClose,
  onChanged,
}: {
  dealId: string | null;
  nom: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [detail, setDetail] = useState<RecapDetail | null | undefined>(undefined);
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [objet, setObjet] = useState("");
  const [corps, setCorps] = useState("");
  const [occupe, setOccupe] = useState<null | "envoi" | "enregistrement" | "ecart" | "relance">(null);

  const charger = useCallback(async () => {
    if (!dealId) return;
    const resultat = await fetchRecapDeLAffaire(dealId);
    if (!resultat.ok) {
      toast(resultat.error, "error");
      setDetail(null);
      return;
    }
    const d = resultat.data ?? null;
    setDetail(d);
    if (d?.recap) {
      setTo(d.recap.to_emails);
      setCc(d.recap.cc_emails);
      setObjet(d.recap.subject ?? "");
      setCorps(d.recap.body ?? "");
    }
  }, [dealId, toast]);

  useEffect(() => {
    setDetail(undefined);
    void charger();
  }, [charger]);

  // Tant qu'il se prépare, la popup suit : on peut la laisser ouverte et voir
  // le brouillon arriver.
  const statut = detail?.recap.status ?? null;
  useEffect(() => {
    if (!statut || !EN_COURS.includes(statut)) return;
    const minuteur = setInterval(() => void charger(), 5_000);
    return () => clearInterval(minuteur);
  }, [statut, charger]);

  async function agir(
    quoi: NonNullable<typeof occupe>,
    action: () => Promise<{ ok: boolean; error?: string }>,
    succes: string,
    fermer = false,
  ) {
    setOccupe(quoi);
    const resultat = await action();
    setOccupe(null);
    if (!resultat.ok) return toast(resultat.error ?? "Action impossible.", "error");
    toast(succes);
    onChanged();
    if (fermer) onClose();
    else void charger();
  }

  const recap = detail?.recap;
  const brouillon = { to, cc, subject: objet, body: corps };

  let contenu: React.ReactNode;
  let pied: React.ReactNode = (
    <Button variant="ghost" onClick={onClose}>
      Fermer
    </Button>
  );

  if (detail === undefined) {
    contenu = (
      <p className="flex items-center gap-2 py-6 text-[13px] text-[var(--text-muted)]">
        <Loader2 className="size-4 animate-spin" /> Chargement…
      </p>
    );
  } else if (!recap || recap.status === "ecarte") {
    contenu = (
      <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
        {recap?.status === "ecarte"
          ? "Le dernier récap a été écarté."
          : "Aucun récap pour cette affaire."}{" "}
        Un récap est préparé automatiquement au passage de R1 en R2 ; vous pouvez aussi en
        demander un à partir du dernier call.
      </p>
    );
    pied = (
      <>
        <Button variant="ghost" onClick={onClose}>
          Fermer
        </Button>
        <Button
          variant="primary"
          loading={occupe === "relance"}
          onClick={() => agir("relance", () => preparerRecap(dealId!), "Récap demandé.")}
        >
          <Sparkles className="size-4" />
          Préparer un récap
        </Button>
      </>
    );
  } else if (recap.status === "en_attente_call") {
    contenu = (
      <div className="space-y-3 text-[13px] leading-relaxed text-[var(--text-secondary)]">
        <p className="flex items-start gap-2">
          <Clock className="mt-0.5 size-4 shrink-0 text-[var(--text-muted)]" />
          <span>
            En attente du call. Claap l&apos;envoie quelques minutes après la fin de
            l&apos;enregistrement ; le brouillon se rédigera dès son arrivée, et cette fenêtre le
            montrera.
          </span>
        </p>
        {detail.plusRecent ? (
          <p className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-base)]/60 p-3 text-[12.5px]">
            Le call le plus récent de l&apos;affaire est « {detail.plusRecent.title ?? "sans titre"} »,
            du {formatDateHeure(detail.plusRecent.quand)}. Il date de plus de douze heures avant le
            passage en R2 : c&apos;est sans doute le R1. Vous pouvez tout de même partir de lui.
          </p>
        ) : null}
      </div>
    );
    pied = (
      <>
        <Button variant="ghost" loading={occupe === "ecart"} onClick={() => agir("ecart", () => ecarterRecap(recap.id), "Récap écarté.", true)}>
          Écarter
        </Button>
        {detail.plusRecent ? (
          <Button
            variant="secondary"
            loading={occupe === "relance"}
            onClick={() => agir("relance", () => relancerRecap(recap.id, detail.plusRecent!.id), "Brouillon rédigé.")}
          >
            Utiliser ce call
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          Fermer
        </Button>
      </>
    );
  } else if (recap.status === "redaction") {
    contenu = (
      <p className="flex items-center gap-2 py-6 text-[13px] text-[var(--text-secondary)]">
        <Loader2 className="size-4 animate-spin" />
        Rédaction à partir du transcript{detail.call?.title ? ` de « ${detail.call.title} »` : ""}…
      </p>
    );
  } else if (recap.status === "echec") {
    contenu = (
      <p className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-[12.5px] text-rose-700 dark:text-rose-300">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        {recap.error ?? "La rédaction a échoué."}
      </p>
    );
    pied = (
      <>
        <Button variant="ghost" loading={occupe === "ecart"} onClick={() => agir("ecart", () => ecarterRecap(recap.id), "Récap écarté.", true)}>
          Écarter
        </Button>
        <Button variant="primary" loading={occupe === "relance"} onClick={() => agir("relance", () => relancerRecap(recap.id), "Brouillon rédigé.")}>
          <RotateCcw className="size-4" />
          Réessayer
        </Button>
      </>
    );
  } else if (recap.status === "envoye") {
    contenu = (
      <div className="space-y-2 text-[13px] text-[var(--text-secondary)]">
        <p>
          Envoyé le {formatDateHeure(recap.sent_at, { avecAnnee: true })} à{" "}
          {recap.to_emails.join(", ")}
          {recap.cc_emails.length ? `, copie ${recap.cc_emails.join(", ")}` : ""}.
        </p>
        <pre className="max-h-80 overflow-auto rounded-xl bg-[var(--surface-base)] p-3 font-sans text-[12.5px] whitespace-pre-wrap">
          {recap.body}
        </pre>
      </div>
    );
  } else {
    // Prêt : le brouillon, entièrement modifiable.
    contenu = (
      <div className="space-y-3.5">
        {detail.call ? (
          <p className="text-[11.5px] text-[var(--text-muted)]">
            Rédigé à partir de « {detail.call.title ?? "call"} » du {formatDateHeure(detail.call.quand)}
            {recap.tutoiement === null ? "" : recap.tutoiement ? " · tutoiement repéré dans l'échange" : " · vouvoiement"}.
          </p>
        ) : null}
        <Field label="À">
          <ChampAdresses valeur={to} onChange={setTo} placeholder="adresse@client.fr" label="Destinataires" />
        </Field>
        <Field label="Cc">
          <ChampAdresses valeur={cc} onChange={setCc} placeholder="Personne en copie" label="Copie" />
        </Field>
        <Field label="Objet">
          <Input value={objet} onChange={(event) => setObjet(event.target.value)} />
        </Field>
        <Field label="Message">
          <Textarea rows={16} value={corps} onChange={(event) => setCorps(event.target.value)} className="font-[inherit]" />
        </Field>
        <div>
          <p className="mb-1.5 text-[12.5px] font-medium text-[var(--text-secondary)]">
            Signature {detail.expediteur ? <span className="font-normal text-[var(--text-muted)]">· {detail.expediteur}</span> : null}
          </p>
          {detail.signature ? (
            // La signature vient de Gmail : on la montre isolée, sans script ni
            // accès à la page.
            <iframe
              title="Signature Gmail"
              sandbox=""
              srcDoc={`<body style="margin:0;font:13px -apple-system,Segoe UI,sans-serif;color:#333;background:#fff">${detail.signature}</body>`}
              className="h-28 w-full rounded-xl border border-[var(--border-subtle)] bg-white"
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
    );
    pied = (
      <>
        <Button
          variant="ghost"
          loading={occupe === "ecart"}
          onClick={() => agir("ecart", () => ecarterRecap(recap.id), "Récap écarté.", true)}
          className="sm:mr-auto"
        >
          Écarter
        </Button>
        <Button
          variant="secondary"
          loading={occupe === "enregistrement"}
          onClick={() => agir("enregistrement", () => enregistrerRecap(recap.id, brouillon), "Brouillon enregistré.")}
        >
          Enregistrer
        </Button>
        <Button
          variant="primary"
          loading={occupe === "envoi"}
          disabled={!detail.expediteur || to.length === 0}
          onClick={() => agir("envoi", () => envoyerRecap(recap.id, brouillon), "Récap envoyé.", true)}
        >
          <Send className="size-4" />
          Envoyer
        </Button>
      </>
    );
  }

  return (
    <Modal
      open={Boolean(dealId)}
      onClose={onClose}
      size="lg"
      title="Mail récap"
      description={nom}
      footer={pied}
    >
      {contenu}
    </Modal>
  );
}
