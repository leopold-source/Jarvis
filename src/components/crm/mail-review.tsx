"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Archive,
  Check,
  ExternalLink,
  ChevronDown,
  History,
  Inbox,
  ListChecks,
  Mail,
  RefreshCw,
  Reply,
  Repeat,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  SectionTitle,
  Textarea,
  useToast,
} from "@/components/ui";
import { AiVerdict } from "@/components/crm/ai-verdict";
import { MAIL_ACTION, MAIL_CATEGORY, RETENTION_JOURS } from "@/lib/constants";
import type { MailRun, MailTriage } from "@/lib/database.types";
import { cn, formatDateHeure, formatRelative } from "@/lib/utils";
import {
  basculerCorbeille,
  classerSansSuite,
  enregistrerBrouillon,
  envoyerBrouillon,
  fetchBilanTri,
  chargerHistorique,
  trierMaintenant,
  type PassageDetaille,
} from "@/app/(crm)/mails/actions";

/**
 * La relecture, mail par mail.
 *
 * Le classement de l'IA est toujours accompagné de sa raison, et la raison est
 * cliquable dans le sens où elle se conteste : un tri qu'on ne peut pas relire
 * est un tri auquel on ne peut pas se fier. Quand elle n'a pas su répondre,
 * elle dit ce qui lui manquait plutôt que de livrer un texte creux.
 */
export function MailReview({
  mails,
  signales,
  dernierPassage,
  compteConnecte,
  perimetre,
}: {
  mails: MailTriage[];
  signales: MailTriage[];
  dernierPassage: MailRun | null;
  compteConnecte: string | null;
  perimetre: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [recap, setRecap] = useState(false);
  const [historique, setHistorique] = useState(false);

  const refresh = () => startTransition(() => router.refresh());

  /*
    Deux gestes, et la distinction compte.

    « Trier » ne revoit jamais un mail déjà vu : c'est ce qui permet de le
    presser sans y penser. « Réanalyser » reprend les deux derniers jours au
    complet, y compris ce qui a déjà été rangé — la seule façon de faire
    profiter l'ancien courrier d'une consigne qui a changé. Elle repaie ce qui
    a déjà été payé, donc elle se demande.
  */
  async function trier(reprise = false) {
    if (
      reprise &&
      !window.confirm(
        "Reprendre les deux derniers jours depuis le début ? Les mails déjà rangés seront reclassés, et l'analyse leur sera refacturée.",
      )
    ) {
      return;
    }

    setBusy(true);
    const resultat = await trierMaintenant(reprise);
    setBusy(false);
    if (!resultat.ok) return toast(resultat.error, "error");
    toast(
      resultat.data?.lus
        ? `${resultat.data.lus} mail(s) passés en revue.`
        : "Aucun nouveau mail à trier.",
    );
    refresh();
  }

  if (!compteConnecte) {
    return (
      <EmptyState
        icon={<Mail className="size-5" />}
        title="Aucun compte Google connecté"
        description="Connecte ta boîte dans Réglages › Connexion Google pour que le tri puisse s'exécuter."
      />
    );
  }

  /*
    Le jeton en base peut être antérieur à l'élargissement des autorisations.

    Dans ce cas tout échouerait en 403 au premier appel, avec un message de
    Google que personne ne saurait interpréter. Le dire avant coûte une ligne
    et évite un quart d'heure de perplexité.
  */
  if (!perimetre.includes("gmail.modify")) {
    return (
      <Card className="p-5">
        <SectionTitle
          title="Autorisations Gmail à renouveler"
          description={`Le compte ${compteConnecte} a été connecté quand l'application ne savait que lire.`}
        />
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--text-muted)]">
          Pour ranger, écarter un spam et préparer des réponses, il faut
          réautoriser le compte — une seule fois. Gmail n&apos;accordera jamais
          la suppression définitive : un mail écarté reste récupérable trente
          jours.
        </p>
        <Button
          className="mt-4"
          onClick={() => router.push("/parametres?onglet=google")}
        >
          <Mail className="size-4" />
          Reconnecter le compte
        </Button>
      </Card>
    );
  }

  // Écartés mais signalés : ils ne sont plus dans la file, donc il faut les
  // remonter ici — sinon « je te le fais savoir » ne veut rien dire.
  const aSavoir = signales;
  const aRepondre = mails.filter((mail) => mail.action === "brouillon_pret");
  const pourToi = mails.filter((mail) => mail.action !== "brouillon_pret");

  return (
    <div className="flex flex-col gap-5">
      {dernierPassage ? (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-linear-to-br from-brand-500/20 to-accent-500/10 text-brand-400 ring-1 ring-[var(--border-subtle)]">
              <Sparkles className="size-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">
                {dernierPassage.lus === 0
                  ? "Rien de neuf au dernier passage."
                  : `${dernierPassage.lus} mail(s) triés ${formatRelative(dernierPassage.started_at)}`}
              </p>
              <p className="mt-0.5 text-[11.5px] text-[var(--text-muted)]">
                {[
                  dernierPassage.spams > 0
                    ? `${dernierPassage.spams} à la corbeille`
                    : null,
                  dernierPassage.factures > 0
                    ? `${dernierPassage.factures} facture(s)`
                    : null,
                  dernierPassage.brouillons > 0
                    ? `${dernierPassage.brouillons} réponse(s) prête(s)`
                    : null,
                  dernierPassage.a_traiter > 0
                    ? `${dernierPassage.a_traiter} pour toi`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "aucune action"}
                {dernierPassage.cout_centimes > 0
                  ? ` · ${Number(dernierPassage.cout_centimes).toFixed(1)} ct`
                  : ""}
              </p>
            </div>
            {/* Trois libellés côte à côte repassent à la ligne sur un
                téléphone et poussent le bilan hors de vue ; les icônes
                suffisent là où la place manque. */}
            <span className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setRecap(true)}
                aria-label="Ce que j'ai fait"
              >
                <ListChecks className="size-3.5" />
                <span className="max-sm:hidden">Ce que j&apos;ai fait</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                loading={busy}
                onClick={() => trier()}
                aria-label="Trier"
              >
                <RefreshCw className="size-3.5" />
                <span className="max-sm:hidden">Trier</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setHistorique(true)}
                aria-label="Historique"
                title={`Les passages des ${RETENTION_JOURS} derniers jours`}
              >
                <History className="size-3.5" />
                <span className="max-sm:hidden">Historique</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => trier(true)}
                aria-label="Réanalyser"
                title="Reprendre les deux derniers jours depuis le début, y compris les mails déjà rangés"
              >
                <Repeat className="size-3.5" />
                <span className="max-sm:hidden">Réanalyser</span>
              </Button>
            </span>
          </div>

          {dernierPassage.erreur ? (
            <p className="mt-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-600 dark:text-rose-300">
              {dernierPassage.erreur}
            </p>
          ) : null}
        </Card>
      ) : (
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-[var(--text-muted)]">
              Le tri ne s&apos;est encore jamais exécuté sur {compteConnecte}.
            </p>
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              onClick={() => trier()}
            >
              <RefreshCw className="size-3.5" />
              Lancer le premier tri
            </Button>
          </div>
        </Card>
      )}

      {aSavoir.length > 0 ? (
        <Card className="border-amber-500/30 bg-amber-500/8 p-4">
          <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-3.5" />
            {aSavoir.length} message{aSavoir.length > 1 ? "s" : ""} écarté
            {aSavoir.length > 1 ? "s" : ""}, mais à savoir
          </p>
          <ul className="mt-2 space-y-1">
            {aSavoir.slice(0, 4).map((mail) => (
              <li
                key={mail.id}
                className="truncate text-[12px] text-[var(--text-secondary)]"
              >
                <span className="font-medium">
                  {mail.from_name || mail.from_email}
                </span>
                {" — "}
                {mail.subject}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setRecap(true)}
            className="mt-2 text-[11.5px] text-brand-500 hover:text-brand-400 dark:text-brand-300"
          >
            Voir et restaurer si besoin
          </button>
        </Card>
      ) : null}

      <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
        <span>
          Tout ce qui est trié sort de ta boîte de réception et se range dans
          son dossier Gmail — cet écran devient donc l&apos;endroit où tu vois
          ce qui attend une réponse. Un expéditeur déjà dans le CRM n&apos;est
          jamais mis à la corbeille, et la corbeille n&apos;est pas une
          suppression : Gmail garde trente jours.
        </span>
      </p>

      {mails.length === 0 ? (
        <EmptyState
          icon={<Inbox className="size-5" />}
          title="Rien n'attend de décision"
          description="Tout ce que le tri a su trancher est rangé dans Gmail sous son étiquette."
        />
      ) : null}

      {aRepondre.length > 0 ? (
        <section>
          <SectionTitle
            title="Réponses préparées"
            description="Relis, modifie si besoin, puis envoie. Rien ne part avant ton clic."
          />
          <div className="mt-3 space-y-3">
            {aRepondre.map((mail) => (
              <MailCard key={mail.id} mail={mail} onDone={refresh} />
            ))}
          </div>
        </section>
      ) : null}

      <HistoriqueModal open={historique} onClose={() => setHistorique(false)} />

      <RecapModal
        open={recap}
        onClose={() => setRecap(false)}
        onChange={refresh}
      />

      {pourToi.length > 0 ? (
        <section>
          <SectionTitle
            title="Ce que je n'ai pas su traiter"
            description="Classement incertain, ou réponse impossible sans information que je n'ai pas."
          />
          <div className="mt-3 space-y-3">
            {pourToi.map((mail) => (
              <MailCard key={mail.id} mail={mail} onDone={refresh} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function MailCard({ mail, onDone }: { mail: MailTriage; onDone: () => void }) {
  const toast = useToast();
  const [ouvert, setOuvert] = useState(mail.action === "brouillon_pret");
  const [corps, setCorps] = useState(mail.draft_body ?? "");
  const [objet, setObjet] = useState(
    mail.draft_subject ?? (mail.subject ? `Re: ${mail.subject}` : ""),
  );
  const [busy, setBusy] = useState<
    "enregistre" | "envoi" | "ignore" | "corbeille" | null
  >(null);

  const categorie = MAIL_CATEGORY[mail.category];
  const action = MAIL_ACTION[mail.action];

  async function agir(
    quoi: "enregistre" | "envoi" | "ignore" | "corbeille",
    run: () => Promise<{ ok: boolean; error?: string }>,
    message: string,
  ) {
    setBusy(quoi);
    const resultat = await run();
    setBusy(null);
    if (!resultat.ok) return toast(resultat.error ?? "Échec.", "error");
    toast(message);
    onDone();
  }

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOuvert((value) => !value)}
        className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-[var(--surface-hover)]/50"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[13.5px] font-medium">
              {mail.from_name || mail.from_email || "Expéditeur inconnu"}
            </span>
            <Badge tone={categorie.tone}>{categorie.label}</Badge>
            <Badge tone={action.tone}>{action.label}</Badge>
            {mail.known_contact ? (
              <span
                title="Expéditeur déjà dans le CRM : protégé de la corbeille"
                className="flex items-center gap-1 text-[10.5px] text-emerald-600 dark:text-emerald-400"
              >
                <ShieldCheck className="size-3" />
                connu
              </span>
            ) : null}
          </span>

          <span className="mt-1 block truncate text-[13px] text-[var(--text-secondary)]">
            {mail.subject || "(sans objet)"}
          </span>
          <span className="mt-0.5 block truncate text-[11.5px] text-[var(--text-muted)]">
            {mail.snippet}
          </span>
        </span>

        <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
          {mail.received_at ? formatRelative(mail.received_at) : ""}
        </span>
      </button>

      {ouvert ? (
        <div className="space-y-3 border-t border-[var(--border-subtle)] p-4">
          {/* Le raisonnement du tri, écrit pour être contesté. */}
          {mail.reason ? (
            <p className="rounded-lg bg-[var(--surface-base)]/60 px-3 py-2 text-[12px] text-[var(--text-muted)]">
              <span className="font-medium text-[var(--text-secondary)]">
                Pourquoi ce classement :
              </span>{" "}
              {mail.reason}
              {mail.confidence > 0 ? (
                <span className="ml-1 tabular-nums">
                  (confiance {Math.round(Number(mail.confidence) * 100)} %)
                </span>
              ) : null}
              {/* Le classement se juge séparément de la réponse : l'un peut
                  être juste et l'autre à côté. */}
              <AiVerdict kind="mail_tri" refId={mail.id} className="mt-1.5" />
            </p>
          ) : null}

          {mail.draft_blocked_reason ? (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                <span className="font-medium">
                  Je n&apos;ai pas su répondre :
                </span>{" "}
                {mail.draft_blocked_reason}
              </span>
            </p>
          ) : null}

          <div className="space-y-2">
            <Input
              value={objet}
              onChange={(event) => setObjet(event.target.value)}
              placeholder="Objet"
              className="text-[12.5px]"
              aria-label="Objet de la réponse"
            />
            <Textarea
              rows={7}
              value={corps}
              onChange={(event) => setCorps(event.target.value)}
              placeholder={
                mail.draft_body
                  ? ""
                  : "Écris ta réponse ici — je n'ai pas su la préparer sans inventer."
              }
              className="text-[13px]"
              aria-label="Corps de la réponse"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={!corps.trim() || !mail.from_email}
              loading={busy === "envoi"}
              onClick={() =>
                agir(
                  "envoi",
                  () => envoyerBrouillon(mail.id, corps, objet),
                  "Envoyé.",
                )
              }
            >
              <Send className="size-3.5" />
              Envoyer
            </Button>

            <Button
              size="sm"
              variant="secondary"
              disabled={!corps.trim()}
              loading={busy === "enregistre"}
              onClick={() =>
                agir(
                  "enregistre",
                  () => enregistrerBrouillon(mail.id, corps, objet),
                  "Brouillon enregistré dans Gmail.",
                )
              }
            >
              <Check className="size-3.5" />
              Garder en brouillon
            </Button>

            <Button
              size="sm"
              variant="ghost"
              loading={busy === "ignore"}
              onClick={() =>
                agir(
                  "ignore",
                  () => classerSansSuite(mail.id),
                  "Classé sans suite.",
                )
              }
            >
              <Archive className="size-3.5" />
              Sans suite
            </Button>

            {/* La corbeille de Gmail garde trente jours : le geste est donc
                offert d'un clic, et son contraire l'est aussi depuis le
                récapitulatif. */}
            <Button
              size="sm"
              variant="ghost"
              loading={busy === "corbeille"}
              onClick={() =>
                agir(
                  "corbeille",
                  () => basculerCorbeille(mail.id, true),
                  "À la corbeille. Récupérable trente jours.",
                )
              }
              className="text-rose-500 hover:bg-rose-500/10"
            >
              <Trash2 className="size-3.5" />
              Supprimer
            </Button>

            {mail.draft_body ? (
              <AiVerdict
                kind="mail_brouillon"
                refId={mail.id}
                className="ml-1"
              />
            ) : null}

            <span
              className={cn("ml-auto text-[11px] text-[var(--text-muted)]")}
            >
              {mail.from_email}
            </span>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * Ce que le tri a fait, mail par mail.
 *
 * L'écran principal ne montre que ce qui attend une décision. Tout le reste —
 * rangé, écarté, répondu — disparaissait sans qu'on puisse le vérifier, ce qui
 * revenait à demander une confiance aveugle à un système dont on découvre à
 * peine le jugement.
 *
 * Les mails écartés viennent en premier : ce sont eux qu'on veut relire, et
 * eux seuls qui portent un bouton pour revenir en arrière.
 */
/**
 * Les cinq façons dont un mail a pu être traité, dans l'ordre où on les lit.
 *
 * « À savoir » passe devant tout : ce sont des messages écartés qu'il faut
 * malgré tout connaître, et les noyer parmi les autres reviendrait à les
 * écarter pour de bon. « Classés » ferme la marche — c'est le cas nominal,
 * celui qu'on survole.
 */
/**
 * L'historique des passages, sur la fenêtre conservée.
 *
 * Le bandeau du haut ne montre que le dernier passage : c'est ce qu'on veut
 * quatre-vingt-dix-neuf fois sur cent, et c'est insuffisant le jour où l'on
 * cherche « ce qui a été supprimé avant-hier ». Cet écran répond à cette
 * question-là, et à elle seule.
 *
 * Chaque passage est replié par défaut. Déplié, il montre exactement ce que
 * montre le récapitulatif du jour — mêmes groupes, mêmes lignes : un historique
 * qui présenterait les choses autrement obligerait à réapprendre à le lire.
 */
function HistoriqueModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [passages, setPassages] = useState<PassageDetaille[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [repondreA, setRepondreA] = useState<MailTriage | null>(null);

  const charger = useCallback(async () => {
    setPassages(await chargerHistorique());
  }, []);

  /*
    Les mêmes gestes qu'au récapitulatif, sur des mails plus anciens.

    C'est souvent là qu'ils servent le plus : on revient sur l'historique
    parce qu'on cherche quelque chose qui n'a pas été fait, et devoir alors
    rouvrir Gmail pour agir viderait l'écran de son intérêt. Gmail garde la
    corbeille trente jours, l'historique en garde quinze : tout ce qui est
    listé ici reste rattrapable.
  */
  async function basculer(mail: MailTriage, versLaCorbeille: boolean) {
    setBusy(mail.id);
    const resultat = await basculerCorbeille(mail.id, versLaCorbeille);
    setBusy(null);
    if (!resultat.ok) return toast(resultat.error, "error");
    toast(versLaCorbeille ? "Mis à la corbeille." : "Remis dans la boîte.");
    await charger();
  }

  useEffect(() => {
    if (!open) return;
    let vivant = true;
    void chargerHistorique().then((donnees) => {
      if (vivant) setPassages(donnees);
    });
    return () => {
      vivant = false;
    };
  }, [open]);

  const total = (passages ?? []).reduce(
    (somme, entree) => somme + entree.passage.lus,
    0,
  );
  const cout = (passages ?? []).reduce(
    (somme, entree) => somme + Number(entree.passage.cout_centimes),
    0,
  );

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="lg"
        title="Historique du tri"
        description={
          passages === null
            ? "Chargement…"
            : `${passages.length} passage(s) sur ${RETENTION_JOURS} jours · ${total} mail(s) examinés` +
              (cout > 0 ? ` · ${cout.toFixed(1)} centime(s)` : "")
        }
        footer={
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
        }
      >
        {passages === null ? (
          <p className="text-[12.5px] text-[var(--text-muted)]">Chargement…</p>
        ) : passages.length === 0 ? (
          <p className="text-[12.5px] text-[var(--text-muted)]">
            Aucun passage dans les {RETENTION_JOURS} derniers jours.
          </p>
        ) : (
          <>
            <ul className="space-y-2">
              {passages.map(({ passage, mails }) => (
                <li
                  key={passage.id}
                  className="overflow-hidden rounded-[10px] border border-[var(--border-subtle)]"
                >
                  {/* `details` natif : replier une liste ne justifie pas un état
                    React, et le navigateur le fait déjà bien. */}
                  <details>
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2.5 transition-colors hover:bg-[var(--surface-hover)]/60">
                      <ChevronDown className="size-3.5 shrink-0 text-[var(--text-muted)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] font-medium">
                          {formatRelative(passage.started_at)}
                          <span className="ml-1.5 font-normal text-[var(--text-muted)]">
                            {formatDateHeure(passage.started_at)}
                          </span>
                        </span>
                        <span className="block text-[11.5px] text-[var(--text-muted)]">
                          {passage.lus === 0
                            ? "rien de neuf"
                            : resumePassage(passage)}
                        </span>
                      </span>

                      <span className="flex shrink-0 items-center gap-1.5">
                        {Number(passage.cout_centimes) > 0 ? (
                          <span className="text-[11px] tabular-nums text-[var(--text-muted)]">
                            {Number(passage.cout_centimes).toFixed(1)} ct
                          </span>
                        ) : null}
                        {passage.erreur ? (
                          <Badge tone="rose">échec</Badge>
                        ) : (
                          <Badge tone="stone">{passage.lus}</Badge>
                        )}
                      </span>
                    </summary>

                    <div className="border-t border-[var(--border-subtle)] px-3 py-2.5">
                      {passage.erreur ? (
                        <p className="mb-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11.5px] text-rose-600 dark:text-rose-300">
                          {passage.erreur}
                        </p>
                      ) : null}

                      {mails.length === 0 ? (
                        <p className="text-[11.5px] text-[var(--text-muted)]">
                          {/* Un passage sans ligne n'est pas forcément un passage
                            raté : il peut n'avoir rien trouvé à trier. */}
                          {passage.lus > 0
                            ? "Le détail de ce passage a été effacé, seul le bilan subsiste."
                            : "Aucun mail à trier ce jour-là."}
                        </p>
                      ) : (
                        <div className="space-y-4">
                          {grouperMails(mails)
                            .filter((groupe) => groupe.mails.length > 0)
                            .map((groupe) => (
                              <section key={groupe.clef}>
                                <h4
                                  className={cn(
                                    "flex flex-wrap items-baseline gap-2 text-[12.5px] font-medium",
                                    groupe.clef === "signale" &&
                                      "text-amber-600 dark:text-amber-300",
                                  )}
                                >
                                  {groupe.titre}
                                  <span className="text-[11px] font-normal text-[var(--text-muted)]">
                                    {groupe.mails.length}
                                  </span>
                                </h4>
                                <ul className="mt-1.5 space-y-1">
                                  {groupe.mails.map((mail) => (
                                    <LigneMail
                                      key={mail.id}
                                      mail={mail}
                                      occupe={busy === mail.id}
                                      onRestaurer={() =>
                                        void basculer(mail, false)
                                      }
                                      onSupprimer={() =>
                                        void basculer(mail, true)
                                      }
                                      onRepondre={() => setRepondreA(mail)}
                                    />
                                  ))}
                                </ul>
                              </section>
                            ))}
                        </div>
                      )}
                    </div>
                  </details>
                </li>
              ))}
            </ul>

            <p className="mt-4 text-[11px] text-[var(--text-muted)]">
              Passé {RETENTION_JOURS} jours, les passages et leur détail sont
              effacés automatiquement. Les mails eux-mêmes restent dans Gmail.
            </p>
          </>
        )}
      </Modal>

      {/* Hors du Modal : deux fenêtres ne s'imbriquent pas. */}
      <RepondreModal
        mail={repondreA}
        onClose={() => setRepondreA(null)}
        onChange={() => void charger()}
      />
    </>
  );
}

/**
 * Répondre depuis le bilan, sans quitter l'écran.
 *
 * Le tri prépare des brouillons pour ce qu'il sait rédiger ; le reste
 * n'attendait aucune réponse, jusqu'au jour où l'on décide que si. Ouvrir
 * Gmail pour trois lignes fait perdre le fil du bilan qu'on était en train de
 * relire — et on ne revient pas.
 *
 * L'envoi reste un geste distinct, et c'est la règle qui n'a pas changé depuis
 * le début : ce qui s'écrit ici part en brouillon dans Gmail, et c'est un
 * humain qui appuie.
 */
function RepondreModal({
  mail,
  onClose,
  onChange,
}: {
  mail: MailTriage | null;
  onClose: () => void;
  onChange: () => void;
}) {
  const toast = useToast();
  const [objet, setObjet] = useState("");
  const [corps, setCorps] = useState("");
  const [busy, setBusy] = useState<"brouillon" | "envoi" | null>(null);

  useEffect(() => {
    if (!mail) return;
    const sujet = mail.subject ?? "";
    setObjet(
      mail.draft_subject ??
        (sujet.toLowerCase().startsWith("re") ? sujet : `Re: ${sujet}`),
    );
    setCorps(mail.draft_body ?? "");
  }, [mail]);

  async function agir(quoi: "brouillon" | "envoi") {
    if (!mail) return;
    setBusy(quoi);
    const resultat =
      quoi === "envoi"
        ? await envoyerBrouillon(mail.id, corps, objet)
        : await enregistrerBrouillon(mail.id, corps, objet);
    setBusy(null);
    if (!resultat.ok) return toast(resultat.error, "error");
    toast(quoi === "envoi" ? "Envoyé." : "Brouillon enregistré dans Gmail.");
    onChange();
    onClose();
  }

  return (
    <Modal
      open={mail !== null}
      onClose={onClose}
      title="Répondre"
      description={
        mail ? `À ${mail.from_name || mail.from_email || "l'expéditeur"}` : ""
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="secondary"
            loading={busy === "brouillon"}
            disabled={busy !== null || !corps.trim()}
            onClick={() => void agir("brouillon")}
          >
            Enregistrer le brouillon
          </Button>
          <Button
            variant="primary"
            loading={busy === "envoi"}
            disabled={busy !== null || !corps.trim()}
            onClick={() => void agir("envoi")}
          >
            <Send className="size-4" />
            Envoyer
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Objet">
          <Input
            value={objet}
            onChange={(event) => setObjet(event.target.value)}
          />
        </Field>
        <Field label="Message">
          <Textarea
            rows={9}
            value={corps}
            onChange={(event) => setCorps(event.target.value)}
            placeholder="Ta réponse…"
          />
        </Field>
      </div>
    </Modal>
  );
}

/**
 * Un mail tel qu'il apparaît dans un bilan.
 *
 * Partagé entre le récapitulatif du dernier passage et l'historique : les deux
 * montrent la même chose, et deux rendus qui divergeraient feraient douter de
 * ce qu'on lit. `onRestaurer` est optionnel — on ne remet pas dans la boîte un
 * mail écarté il y a dix jours depuis un écran d'archives, mais on veut
 * toujours pouvoir l'ouvrir dans Gmail.
 */
function LigneMail({
  mail,
  occupe,
  onRestaurer,
  onSupprimer,
  onRepondre,
}: {
  mail: MailTriage;
  occupe?: boolean;
  onRestaurer?: () => void;
  onSupprimer?: () => void;
  onRepondre?: () => void;
}) {
  const categorie = MAIL_CATEGORY[mail.category];
  const ecarte = mail.action === "corbeille";

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[var(--border-subtle)] px-3 py-2">
      <span className="min-w-40 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[12.5px] font-medium">
            {mail.from_name || mail.from_email || "Inconnu"}
          </span>
          <Badge tone={categorie.tone}>{categorie.label}</Badge>
          {mail.known_contact ? (
            <ShieldCheck
              className="size-3 text-emerald-500"
              aria-label="Déjà dans le CRM"
            />
          ) : null}
        </span>
        <span className="block truncate text-[11.5px] text-[var(--text-muted)]">
          {mail.subject || "(sans objet)"}
        </span>
        {/* La raison du classement, pour pouvoir le contester. */}
        {mail.reason ? (
          <span className="mt-0.5 block text-[11px] text-[var(--text-muted)] italic">
            {mail.reason}
          </span>
        ) : null}
      </span>

      <span className="flex shrink-0 items-center gap-1">
        <AiVerdict kind="mail_tri" refId={mail.id} />

        {/*
          Le tri propose, on dispose — dans les deux sens.

          Restaurer existait déjà ; supprimer manquait, et c'était l'asymétrie
          la plus gênante du récapitulatif : on pouvait annuler une mise à la
          corbeille, jamais en décider une. Or relire le bilan, c'est
          précisément le moment où l'on voit ce qui aurait dû partir.
        */}
        {ecarte && onRestaurer ? (
          <button
            type="button"
            disabled={occupe}
            onClick={onRestaurer}
            title="Remettre dans la boîte"
            className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-emerald-500 disabled:opacity-40"
          >
            <RotateCcw className="size-3.5" />
          </button>
        ) : null}

        {!ecarte && onRepondre ? (
          <button
            type="button"
            disabled={occupe}
            onClick={onRepondre}
            title="Préparer une réponse"
            className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-brand-500 disabled:opacity-40"
          >
            <Reply className="size-3.5" />
          </button>
        ) : null}

        {!ecarte && onSupprimer ? (
          <button
            type="button"
            disabled={occupe}
            onClick={onSupprimer}
            title="Mettre à la corbeille"
            className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-rose-500 disabled:opacity-40"
          >
            <Trash2 className="size-3.5" />
          </button>
        ) : null}

        <a
          href={`https://mail.google.com/mail/u/0/#all/${mail.provider_message_id}`}
          target="_blank"
          rel="noreferrer"
          title="Ouvrir dans Gmail"
          className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-brand-500"
        >
          <ExternalLink className="size-3.5" />
        </a>
      </span>
    </li>
  );
}

function grouperMails(mails: MailTriage[]) {
  return [
    {
      clef: "signale",
      titre: "À savoir",
      note: "Écartés, mais tu dois être au courant.",
      mails: mails.filter((m) => m.a_signaler),
    },
    {
      clef: "corbeille",
      titre: "Écartés",
      note: "À la corbeille — Gmail les garde trente jours.",
      mails: mails.filter((m) => m.action === "corbeille" && !m.a_signaler),
    },
    {
      clef: "brouillon_pret",
      titre: "Réponses préparées",
      note: "Étiquetés, avec un brouillon qui attend ta relecture.",
      mails: mails.filter((m) => m.action === "brouillon_pret"),
    },
    {
      clef: "a_traiter",
      titre: "Laissés pour toi",
      note: "Classement incertain, ou réponse impossible sans information.",
      mails: mails.filter((m) => m.action === "a_traiter"),
    },
    {
      clef: "etiquete",
      titre: "Classés",
      note: "Rangés dans leur dossier, hors de la boîte de réception.",
      mails: mails.filter((m) => m.action === "etiquete"),
    },
  ];
}

/** Le bilan d'un passage en une ligne de texte. */
function resumePassage(passage: MailRun): string {
  const morceaux = [
    passage.spams > 0
      ? `${passage.spams} écarté${passage.spams > 1 ? "s" : ""}`
      : null,
    passage.factures > 0
      ? `${passage.factures} facture${passage.factures > 1 ? "s" : ""}`
      : null,
    passage.brouillons > 0
      ? `${passage.brouillons} réponse${passage.brouillons > 1 ? "s" : ""}`
      : null,
    passage.a_traiter > 0 ? `${passage.a_traiter} pour toi` : null,
  ].filter(Boolean);
  return morceaux.length > 0 ? morceaux.join(" · ") : "aucune action";
}

function RecapModal({
  open,
  onClose,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  onChange: () => void;
}) {
  const toast = useToast();
  const [mails, setMails] = useState<MailTriage[] | null>(null);
  const [passage, setPassage] = useState<MailRun | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [repondreA, setRepondreA] = useState<MailTriage | null>(null);

  const charger = useCallback(async () => {
    const bilan = await fetchBilanTri();
    setMails(bilan.mails);
    setPassage(bilan.passage);
  }, []);

  useEffect(() => {
    if (open) void charger();
  }, [open, charger]);

  async function basculer(mail: MailTriage, versLaCorbeille: boolean) {
    setBusy(mail.id);
    const resultat = await basculerCorbeille(mail.id, versLaCorbeille);
    setBusy(null);
    if (!resultat.ok) return toast(resultat.error, "error");
    toast(versLaCorbeille ? "Mis à la corbeille." : "Remis dans la boîte.");
    await charger();
    onChange();
  }

  const groupes = grouperMails(mails ?? []);

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="lg"
        title="Ce que j'ai fait de tes mails"
        description={
          passage
            ? `Passage ${formatRelative(passage.started_at)} · ${passage.lus} mail(s) examinés` +
              (Number(passage.cout_centimes) > 0
                ? ` · ${Number(passage.cout_centimes).toFixed(1)} centime(s)`
                : "")
            : "Le tri ne s'est encore jamais exécuté."
        }
        footer={
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
        }
      >
        {mails === null ? (
          <p className="text-[12.5px] text-[var(--text-muted)]">Chargement…</p>
        ) : mails.length === 0 ? (
          <p className="text-[12.5px] text-[var(--text-muted)]">
            Aucun mail traité lors du dernier passage.
          </p>
        ) : (
          <div className="space-y-5">
            {groupes
              .filter((groupe) => groupe.mails.length > 0)
              .map((groupe) => (
                <section key={groupe.clef}>
                  <h4
                    className={cn(
                      "flex flex-wrap items-baseline gap-2 text-[13px] font-medium",
                      groupe.clef === "signale" &&
                        "text-amber-600 dark:text-amber-300",
                    )}
                  >
                    {groupe.titre}
                    <span className="text-[11.5px] font-normal text-[var(--text-muted)]">
                      {groupe.mails.length} · {groupe.note}
                    </span>
                  </h4>

                  <ul className="mt-2 space-y-1">
                    {groupe.mails.map((mail) => (
                      <LigneMail
                        key={mail.id}
                        mail={mail}
                        occupe={busy === mail.id}
                        onRestaurer={() => void basculer(mail, false)}
                        onSupprimer={() => void basculer(mail, true)}
                        onRepondre={() => setRepondreA(mail)}
                      />
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        )}
      </Modal>

      {/* Hors du Modal : deux fenêtres ne s'imbriquent pas, et la réponse doit
          survivre à la fermeture du récapitulatif qui l'a ouverte. */}
      <RepondreModal
        mail={repondreA}
        onClose={() => setRepondreA(null)}
        onChange={() => {
          void charger();
          onChange();
        }}
      />
    </>
  );
}
