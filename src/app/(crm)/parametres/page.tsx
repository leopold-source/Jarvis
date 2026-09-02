import { PageHeader } from "@/components/layout/page-header";
import { GmailConnection, type GmailAccountView } from "@/components/crm/gmail-connection";
import { requireStaff } from "@/lib/auth";
import { googleCredentials } from "@/lib/google";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Messages de retour du parcours OAuth, traduits pour l'utilisateur. */
const NOTICES: Record<string, string> = {
  config: "Connexion Google impossible : les identifiants OAuth ne sont pas configurés.",
  refus: "Autorisation refusée : rien n'a été connecté.",
  etat: "Retour Google invalide ou expiré. Relancez la connexion.",
  service: "Clé SUPABASE_SERVICE_ROLE_KEY absente : le jeton n'a pas pu être enregistré.",
  "sans-refresh":
    "Google n'a pas renvoyé de jeton durable. Retirez l'accès de l'application dans votre compte Google, puis reconnectez.",
  base: "Enregistrement du compte impossible.",
  echec: "L'échange avec Google a échoué. Vérifiez l'URI de redirection déclarée dans la console.",
};

export default async function ParametresPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const profile = await requireStaff();
  const { google } = await searchParams;

  const supabase = await createClient();
  // La colonne `refresh_token` est fermée au rôle `authenticated` : on ne
  // sélectionne donc que les champs d'affichage, jamais l'étoile.
  const { data } = await supabase
    .from("google_accounts")
    .select("email, last_synced_at, last_error, synced_count, connected_at")
    .eq("user_id", profile.id)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Réglages"
        description="Vos connexions personnelles. Elles ne concernent que votre compte."
      />

      {google === "ok" ? (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-[13px] text-emerald-600 dark:text-emerald-300">
          Compte Google connecté. Lancez une première synchronisation pour rattacher les échanges
          existants.
        </p>
      ) : null}

      <GmailConnection
        account={(data as GmailAccountView) ?? null}
        configured={Boolean(googleCredentials())}
        notice={google && google !== "ok" ? (NOTICES[google] ?? "Connexion Google interrompue.") : undefined}
      />
    </div>
  );
}
