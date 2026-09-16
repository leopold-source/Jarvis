import { PageHeader } from "@/components/layout/page-header";
import { LeadsWorkspace } from "@/components/crm/leads-workspace";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Leads" };

export default async function LeadsPage() {
  const profile = await requireStaff();
  const supabase = await createClient();

  const [{ data: leads }, { data: members }, { data: reglages }] = await Promise.all([
    /*
      Les colonnes affichées, et elles seules.

      `select("*")` envoyait 233 ko au navigateur pour 432 fiches, dont 35 ko
      de descriptions d'entreprise que rien n'affiche — elles avaient été
      importées pour nourrir l'analyse, pas la table. Nommer les colonnes est
      moins élégant qu'une étoile, mais c'est la différence entre une page qui
      s'ouvre et une page qui se charge.
    */
    supabase
      .from("leads")
      // Une seule chaîne littérale, volontairement : concaténée avec `+`, elle
      // perdrait son type littéral et le client ne saurait plus vérifier les
      // noms de colonnes — le filet qui a déjà rattrapé un `companies.city`
      // inexistant.
      .select(
        "id, full_name, first_name, last_name, email, phone, phone_standard, company_name, company_website, company_activity, job_title, region, segment, status, nrp_count, follow_up_on, comment, owner_id, owner_name, revenue, siren, siret, headcount, headcount_range, linkedin_url, org_key, phone_key, status_changed_at, last_touched_at, touch_count, converted_at, converted_deal_id, created_at, updated_at",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .neq("role", "client")
      .eq("is_active", true)
      .order("full_name"),
    supabase.from("app_settings").select("value").eq("key", "prospection").maybeSingle(),
  ]);

  // Le délai au-delà duquel un appel chez la même organisation n'est plus un
  // doublon. Réglable depuis Réglages : c'est un arbitrage commercial.
  const cooldown = Number(
    (reglages?.value as { org_cooldown_days?: number } | null)?.org_cooldown_days ?? 30,
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <PageHeader
        title="Leads"
        description="La base de prospection amont. Dès qu'un lead accepte un rendez-vous, convertissez-le : contact, entreprise et affaire sont créés d'un coup."
      />
      <LeadsWorkspace
        leads={leads ?? []}
        members={members ?? []}
        currentUserId={profile.id}
        orgCooldownDays={cooldown}
        isAdmin={profile.role === "admin"}
      />
    </div>
  );
}
