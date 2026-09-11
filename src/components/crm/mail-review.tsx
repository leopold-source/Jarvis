"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Archive,
  Check,
  Inbox,
  Mail,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  SectionTitle,
  Textarea,
  useToast,
} from "@/components/ui";
import { MAIL_ACTION, MAIL_CATEGORY } from "@/lib/constants";
import type { MailRun, MailTriage } from "@/lib/database.types";
import { cn, formatRelative } from "@/lib/utils";
import {
  classerSansSuite,
  enregistrerBrouillon,
  envoyerBrouillon,
  trierMaintenant,
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
  dernierPassage,
  compteConnecte,
  perimetre,
}: {
  mails: MailTriage[];
  dernierPassage: MailRun | null;
  compteConnecte: string | null;
  perimetre: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  const refresh = () => startTransition(() => router.refresh());

  async function trier() {
    setBusy(true);
    const resultat = await trierMaintenant();
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
          Pour ranger, écarter un spam et préparer des réponses, il faut réautoriser le compte —
          une seule fois. Gmail n&apos;accordera jamais la suppression définitive : un mail écarté
          reste récupérable trente jours.
        </p>
        <Button className="mt-4" onClick={() => router.push("/parametres?onglet=google")}>
          <Mail className="size-4" />
          Reconnecter le compte
        </Button>
      </Card>
    );
  }

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
                  dernierPassage.spams > 0 ? `${dernierPassage.spams} à la corbeille` : null,
                  dernierPassage.factures > 0 ? `${dernierPassage.factures} facture(s)` : null,
                  dernierPassage.brouillons > 0 ? `${dernierPassage.brouillons} réponse(s) prête(s)` : null,
                  dernierPassage.a_traiter > 0 ? `${dernierPassage.a_traiter} pour toi` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "aucune action"}
                {dernierPassage.cout_centimes > 0
                  ? ` · ${Number(dernierPassage.cout_centimes).toFixed(1)} ct`
                  : ""}
              </p>
            </div>
            <Button variant="ghost" size="sm" loading={busy} onClick={trier}>
              <RefreshCw className="size-3.5" />
              Trier maintenant
            </Button>
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
            <Button variant="secondary" size="sm" loading={busy} onClick={trier}>
              <RefreshCw className="size-3.5" />
              Lancer le premier tri
            </Button>
          </div>
        </Card>
      )}

      <p className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-muted)]">
        <ShieldCheck className="size-3.5 text-emerald-500" />
        Un expéditeur déjà dans le CRM n&apos;est jamais mis à la corbeille. Et la corbeille
        n&apos;est pas une suppression : Gmail garde trente jours.
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
  const [busy, setBusy] = useState<"enregistre" | "envoi" | "ignore" | null>(null);

  const categorie = MAIL_CATEGORY[mail.category];
  const action = MAIL_ACTION[mail.action];

  async function agir(
    quoi: "enregistre" | "envoi" | "ignore",
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
              <span className="font-medium text-[var(--text-secondary)]">Pourquoi ce classement :</span>{" "}
              {mail.reason}
              {mail.confidence > 0 ? (
                <span className="ml-1 tabular-nums">
                  (confiance {Math.round(Number(mail.confidence) * 100)} %)
                </span>
              ) : null}
            </p>
          ) : null}

          {mail.draft_blocked_reason ? (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                <span className="font-medium">Je n&apos;ai pas su répondre :</span>{" "}
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
              onClick={() => agir("envoi", () => envoyerBrouillon(mail.id, corps, objet), "Envoyé.")}
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
              onClick={() => agir("ignore", () => classerSansSuite(mail.id), "Classé sans suite.")}
            >
              <Archive className="size-3.5" />
              Sans suite
            </Button>

            <span className={cn("ml-auto text-[11px] text-[var(--text-muted)]")}>
              {mail.from_email}
            </span>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
