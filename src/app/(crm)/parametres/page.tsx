import Link from "next/link";
import { Activity, Mail, UserCog, Video } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { GmailConnection, type GmailAccountView } from "@/components/crm/gmail-connection";
import { DiagnosticPanel } from "@/components/crm/diagnostic-panel";
import { PasswordForm } from "@/components/crm/password-form";
import { ClaapSettings } from "@/components/crm/claap-settings";
import { fetchClaapSettings } from "@/app/(crm)/parametres/claap-actions";
import { requireStaff } from "@/lib/auth";
import { googleCredentials } from "@/lib/google";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

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

const TABS = [
  { key: "compte", label: "Compte", icon: UserCog, adminOnly: false },
  { key: "google", label: "Connexion Google", icon: Mail, adminOnly: false },
  { key: "claap", label: "Calls Claap", icon: Video, adminOnly: false },
  { key: "diagnostic", label: "Diagnostic", icon: Activity, adminOnly: true },
] as const;

/**
 * Réglages du compte.
 *
 * L'onglet actif vit dans l'URL plutôt que dans un état React : la page reste
 * un composant serveur, chaque onglet est adressable, et le retour arrière du
 * navigateur fait ce qu'on attend de lui.
 */
export default async function ParametresPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string; onglet?: string }>;
}) {
  const profile = await requireStaff();
  const { google, onglet } = await searchParams;

  const isAdmin = profile.role === "admin";
  const tabs = TABS.filter((tab) => !tab.adminOnly || isAdmin);
  // Un retour OAuth atterrit forcément sur l'onglet qui l'a déclenché.
  const active = google ? "google" : (tabs.find((tab) => tab.key === onglet)?.key ?? "compte");

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
        description="Votre compte et vos connexions personnelles."
      />

      <nav className="flex flex-wrap gap-1 border-b border-[var(--border-subtle)]">
        {tabs.map(({ key, label, icon: Icon }) => {
          const current = key === active;
          return (
            <Link
              key={key}
              href={`/parametres?onglet=${key}`}
              scroll={false}
              className={cn(
                "relative flex items-center gap-1.5 rounded-t-lg px-3.5 py-2 text-[13px] transition-colors duration-200",
                current
                  ? "text-[var(--text-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
              )}
            >
              <Icon className="size-3.5" />
              {label}
              {/* Le liseré actif est peint séparément pour qu'il puisse glisser. */}
              <span
                className={cn(
                  "absolute inset-x-2 -bottom-px h-0.5 rounded-full transition-all duration-300",
                  current
                    ? "bg-linear-to-r from-brand-500 to-accent-500 opacity-100"
                    : "opacity-0",
                )}
              />
            </Link>
          );
        })}
      </nav>

      <div key={active} className="animate-fade-up space-y-6">
        {active === "compte" ? (
          <>
            <PasswordForm />
          </>
        ) : null}

        {active === "google" ? (
          <>
            {google === "ok" ? (
              <p className="animate-fade-up rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-[13px] text-emerald-600 dark:text-emerald-300">
                Compte Google connecté. Lancez une première synchronisation pour rattacher les
                échanges existants.
              </p>
            ) : null}
            <GmailConnection
              account={(data as GmailAccountView) ?? null}
              configured={Boolean(googleCredentials())}
              notice={
                google && google !== "ok"
                  ? (NOTICES[google] ?? "Connexion Google interrompue.")
                  : undefined
              }
            />
          </>
        ) : null}

        {active === "claap" ? <ClaapPanel isAdmin={isAdmin} /> : null}

        {active === "diagnostic" && isAdmin ? <DiagnosticPanel /> : null}
      </div>
    </div>
  );
}

/** Chargé à part : l'onglet Claap ne coûte rien tant qu'il n'est pas ouvert. */
async function ClaapPanel({ isAdmin }: { isAdmin: boolean }) {
  const { rules, events, unmappedFolders } = await fetchClaapSettings();
  return (
    <ClaapSettings
      rules={rules}
      events={events}
      unmappedFolders={unmappedFolders}
      isAdmin={isAdmin}
    />
  );
}
