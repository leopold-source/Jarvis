import { AlertTriangle, CheckCircle2, GitCommitHorizontal, KeyRound, XCircle } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Badge, Card, SectionTitle } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import {
  anthropicClient,
  anthropicKey,
  anthropicWorkspaceId,
  describeAnthropicError,
} from "@/lib/anthropic";

/**
 * Page de diagnostic.
 *
 * Une variable d'environnement « présente dans Vercel » mais absente à
 * l'exécution vient presque toujours du même malentendu : le navigateur est
 * resté sur l'URL figée d'un ancien déploiement, qui garde l'environnement de
 * son propre build. Cette page dit donc d'abord *quelle version tourne*, puis
 * ce qu'elle voit, puis teste la clé pour de bon.
 */
export const dynamic = "force-dynamic";

const WATCHED = [
  { name: "NEXT_PUBLIC_SUPABASE_URL", secret: false, optional: false },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", secret: true, optional: false },
  { name: "SUPABASE_SERVICE_ROLE_KEY", secret: true, optional: false },
  { name: "ANTHROPIC_API_KEY", secret: true, optional: false },
  // Nécessaire uniquement si la clé ci-dessus est rattachée à une identité.
  { name: "ANTHROPIC_WORKSPACE_ID", secret: false, optional: true },
  { name: "GOOGLE_CLIENT_ID", secret: false, optional: false },
  { name: "GOOGLE_CLIENT_SECRET", secret: true, optional: false },
  // Sans elle, l'URI de retour est déduite de l'origine de la requête.
  { name: "GOOGLE_REDIRECT_URI", secret: false, optional: true },
] as const;

/** Masque une valeur sensible en n'en gardant que les extrémités. */
function mask(value: string) {
  if (value.length <= 12) return "•".repeat(value.length);
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

/** Appel réel à l'API pour distinguer « clé absente » de « clé refusée ». */
async function pingAnthropic() {
  if (!anthropicKey()) return { ok: false as const, detail: "Aucune clé à tester." };
  try {
    const models = await anthropicClient().models.list({ limit: 1 });
    const first = models.data[0]?.id ?? "aucun modèle renvoyé";
    return { ok: true as const, detail: `Authentification acceptée (${first}).` };
  } catch (caught) {
    return { ok: false as const, detail: describeAnthropicError(caught) };
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--border-subtle)] py-2 last:border-0">
      <span className="text-[12.5px] text-[var(--text-muted)]">{label}</span>
      <span className="font-mono text-[12.5px] break-all">{value}</span>
    </div>
  );
}

export default async function DiagnosticPage() {
  await requireAdmin();

  const env = process.env;
  const sha = env.VERCEL_GIT_COMMIT_SHA;
  const ping = await pingAnthropic();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Diagnostic"
        description="Ce que le serveur voit réellement, dans le déploiement qui répond à cette page."
      />

      <Card glow className="p-5">
        <SectionTitle
          title={
            <span className="flex items-center gap-2">
              <GitCommitHorizontal className="size-4 text-brand-500 dark:text-brand-300" />
              Déploiement en cours
            </span>
          }
          description="Si le commit n'est pas le dernier poussé, c'est une ancienne version qui répond : ouvrez le domaine de production plutôt qu'une URL de déploiement figée."
        />
        <div className="mt-3">
          <Row label="Environnement Vercel" value={env.VERCEL_ENV ?? "hors Vercel (local)"} />
          <Row label="Branche" value={env.VERCEL_GIT_COMMIT_REF ?? "—"} />
          <Row label="Commit" value={sha ? sha.slice(0, 8) : "—"} />
          <Row label="Message du commit" value={env.VERCEL_GIT_COMMIT_MESSAGE ?? "—"} />
          <Row label="URL du déploiement" value={env.VERCEL_URL ?? "—"} />
          <Row label="Région d'exécution" value={env.VERCEL_REGION ?? "—"} />
          <Row label="Rendu de cette page" value={new Date().toLocaleString("fr-FR")} />
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle
          title={
            <span className="flex items-center gap-2">
              <KeyRound className="size-4 text-brand-500 dark:text-brand-300" />
              Variables d&apos;environnement
            </span>
          }
          description="Lues à l'exécution. Une valeur absente ici n'existe pas dans ce déploiement, quel que soit l'affichage du tableau de bord Vercel."
        />
        <div className="mt-3 space-y-2">
          {WATCHED.map(({ name, secret, optional }) => {
            const raw = env[name];
            const trimmed = raw?.trim() ?? "";
            const present = trimmed.length > 0;
            const padded = raw !== undefined && raw !== trimmed;

            return (
              <div
                key={name}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="font-mono text-[12.5px]">{name}</p>
                  {present ? (
                    <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                      {trimmed.length} caractères · {secret ? mask(trimmed) : trimmed}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                      {optional
                        ? "Non définie — utile seulement avec une clé rattachée à une identité."
                        : "Non définie dans ce déploiement."}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {padded ? (
                    <Badge tone="amber">
                      <AlertTriangle className="size-3" />
                      Espace ou saut de ligne
                    </Badge>
                  ) : null}
                  <Badge tone={present ? "emerald" : optional ? "stone" : "red"}>
                    {present ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
                    {present ? "Présente" : optional ? "Optionnelle" : "Absente"}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle
          title="Test en direct de la clé Anthropic"
          description={
            anthropicWorkspaceId()
              ? `Un appel réel à l'API, au nom de l'espace de travail ${anthropicWorkspaceId()}.`
              : "Un appel réel à l'API, sans en-tête d'espace de travail."
          }
        />
        <div
          className={`mt-3 flex items-start gap-2.5 rounded-xl border p-3.5 text-[13px] ${
            ping.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
              : "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300"
          }`}
        >
          {ping.ok ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          ) : (
            <XCircle className="mt-0.5 size-4 shrink-0" />
          )}
          <p>{ping.detail}</p>
        </div>
      </Card>
    </div>
  );
}
