"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  History,
  Link2,
  Link2Off,
  Mail,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import { Badge, Button, Card, SectionTitle, useToast } from "@/components/ui";
import { disconnectGmail, syncGmail } from "@/app/(crm)/parametres/actions";
import { formatRelative } from "@/lib/utils";

export type GmailAccountView = {
  /** Périmètre réellement accordé : il date de la connexion, pas du code. */
  scope: string | null;
  email: string;
  last_synced_at: string | null;
  last_error: string | null;
  synced_count: number;
  connected_at: string;
} | null;

/**
 * Connexion Gmail d'un collaborateur.
 *
 * Chacun autorise sa propre boîte : le CRM ne partage jamais un jeton entre
 * utilisateurs, et les messages remontés sont ceux que cette personne pouvait
 * déjà lire.
 */
export function GmailConnection({
  account,
  configured,
  notice,
}: {
  account: GmailAccountView;
  configured: boolean;
  notice?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [syncing, setSyncing] = useState<false | "normale" | "profonde">(false);
  const [disconnecting, setDisconnecting] = useState(false);

  async function runSync(profond = false) {
    setSyncing(profond ? "profonde" : "normale");
    const result = await syncGmail(profond);
    setSyncing(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast(
      (result.imported > 0
        ? `${result.imported} message(s) rattaché(s), toutes boîtes de l'équipe confondues.`
        : "Aucun nouveau message à rattacher.") + (result.since ? ` ${result.since}.` : ""),
      result.since ? "error" : "success",
    );
    startTransition(() => router.refresh());
  }

  async function disconnect() {
    setDisconnecting(true);
    const result = await disconnectGmail();
    setDisconnecting(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast("Compte Google déconnecté.");
    startTransition(() => router.refresh());
  }

  return (
    <Card glow className="p-5">
      <SectionTitle
        title={
          <span className="flex items-center gap-2">
            <Mail className="size-4 text-brand-500 dark:text-brand-300" />
            Compte Google
          </span>
        }
        description="Rattache vos échanges aux affaires, range la boîte chaque matin dans des dossiers Gmail, et affiche vos rendez-vous du jour sur le tableau de bord."
        action={
          account ? (
            <Badge tone="emerald">
              <CheckCircle2 className="size-3" />
              Connecté
            </Badge>
          ) : (
            <Badge tone="stone">Non connecté</Badge>
          )
        }
      />

      {account && !account.scope?.includes("calendar") ? (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[12.5px] text-amber-600 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Ce compte a été connecté quand l&apos;application ne savait que lire les mails.
            Reconnectez-le pour activer le tri de la boîte et l&apos;agenda — c&apos;est la même
            opération pour les deux, une seule fois.
          </span>
        </p>
      ) : null}

      {notice ? (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[12.5px] text-amber-600 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {notice}
        </p>
      ) : null}

      {account ? (
        <>
          <div className="mt-4 space-y-2 text-[13px]">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border-subtle)] pb-2">
              <span className="text-[12.5px] text-[var(--text-muted)]">Boîte connectée</span>
              <span className="font-mono text-[12.5px]">{account.email}</span>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border-subtle)] pb-2">
              <span className="text-[12.5px] text-[var(--text-muted)]">Dernière synchronisation</span>
              <span className="text-[12.5px]">
                {account.last_synced_at ? formatRelative(account.last_synced_at) : "jamais"}
              </span>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[12.5px] text-[var(--text-muted)]">Messages rattachés</span>
              <span className="text-[12.5px] tabular-nums">{account.synced_count}</span>
            </div>
          </div>

          {account.last_error ? (
            <p className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[12.5px] text-red-600 dark:text-red-300">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              {account.last_error}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="primary"
              loading={syncing === "normale"}
              disabled={syncing !== false}
              onClick={() => void runSync()}
            >
              <RefreshCw className="size-3.5" />
              Synchroniser l&apos;équipe
            </Button>
            {/* Une exécution ordinaire reprend à la dernière : elle ne peut
                pas voir ce qui la précède. Ajouter un interlocuteur à une
                affaire ne remonte donc rien de son historique — d'où ce
                second bouton, qui rejoue quatre mois. */}
            <Button
              variant="secondary"
              loading={syncing === "profonde"}
              disabled={syncing !== false}
              onClick={() => void runSync(true)}
              title="Rejouer les quatre derniers mois"
            >
              <History className="size-3.5" />
              Rattraper l&apos;historique
            </Button>
            <Button variant="ghost" loading={disconnecting} onClick={disconnect}>
              <Link2Off className="size-3.5" />
              Déconnecter
            </Button>
          </div>

          <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
            Les deux boutons synchronisent toutes les boîtes connectées de l&apos;équipe : un mail
            de Romain au client rejoint l&apos;affaire comme un mail de Léopold, et un échange à
            plusieurs n&apos;apparaît qu&apos;une fois. Les invitations et réponses d&apos;agenda
            sont écartées. Une synchronisation tourne aussi chaque nuit.
          </p>
        </>
      ) : (
        <>
          <p className="mt-4 text-[13px] text-[var(--text-secondary)]">
            Le CRM n&apos;ouvre pas votre boîte : il interroge Gmail avec les adresses de vos
            contacts et ne conserve que l&apos;objet, la date et l&apos;extrait des messages qui
            correspondent à une affaire.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={!configured}
              onClick={() => {
                // Navigation pleine page : le parcours OAuth quitte l'application.
                window.location.href = "/api/google/connect";
              }}
            >
              <Link2 className="size-3.5" />
              Connecter mon compte Google
            </Button>
            {!configured ? (
              <span className="text-[12px] text-[var(--text-muted)]">
                Variables GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET à renseigner.
              </span>
            ) : null}
          </div>
        </>
      )}

      <p className="mt-4 flex items-start gap-2 text-[11.5px] text-[var(--text-muted)]">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
        Accès en lecture seule. Le jeton reste côté serveur, hors de portée du navigateur, et se
        révoque d&apos;un clic depuis cette page ou depuis votre compte Google.
      </p>
    </Card>
  );
}
