import { PageHeader } from "@/components/layout/page-header";
import { LeadsWorkspace } from "@/components/crm/leads-workspace";
import { requireStaff } from "@/lib/auth";
import { chargerPlan } from "@/lib/plan-du-jour";
import { planDe, verrouProspection } from "@/lib/plan-logique";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Leads" };

/*
  Toutes les fiches, par pages de mille.

  Supabase plafonne une requête à mille lignes, sans erreur ni avertissement :
  passé ce seuil, les fiches les plus anciennes disparaissaient simplement de
  la table — et avec elles leurs relances en retard.
*/
const PAGE = 1000;

async function toutesLesFiches(supabase: Awaited<ReturnType<typeof createClient>>) {
  const fiches = [];
  for (let debut = 0; ; debut += PAGE) {
    const { data, error } = await supabase
      .from("leads")
      // Une seule chaîne littérale, volontairement : concaténée avec `+`, elle
      // perdrait son type littéral et le client ne saurait plus vérifier les
      // noms de colonnes — le filet qui a déjà rattrapé un `companies.city`
      // inexistant.
      .select(
        "id, full_name, first_name, last_name, email, phone, phone_standard, company_name, company_website, company_activity, job_title, region, segment, status, nrp_count, follow_up_on, comment, owner_id, owner_name, revenue, siren, siret, headcount, headcount_range, linkedin_url, org_key, phone_key, status_changed_at, last_touched_at, touch_count, last_action, last_action_detail, last_action_at, last_action_by, converted_at, converted_deal_id, created_at, updated_at",
      )
      .order("created_at", { ascending: false })
      .order("id")
      .range(debut, debut + PAGE - 1);
    if (error || !data) break;
    fiches.push(...data);
    if (data.length < PAGE) break;
  }
  return fiches;
}

export default async function LeadsPage() {
  const profile = await requireStaff();
  const supabase = await createClient();

  const [leads, { data: members }, { data: reglages }, plan] = await Promise.all([
    /*
      Les colonnes affichées, et elles seules.

      `select("*")` envoyait 233 ko au navigateur pour 432 fiches, dont 35 ko
      de descriptions d'entreprise que rien n'affiche — elles avaient été
      importées pour nourrir l'analyse, pas la table. Nommer les colonnes est
      moins élégant qu'une étoile, mais c'est la différence entre une page qui
      s'ouvre et une page qui se charge.
    */
    toutesLesFiches(supabase),
    supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .neq("role", "client")
      .eq("is_active", true)
      .order("full_name"),
    supabase.from("app_settings").select("value").eq("key", "prospection").maybeSingle(),
    // Le plan du jour décide si la prospection libre est ouverte.
    chargerPlan(supabase, { userId: profile.id }),
  ]);
  const verrou = verrouProspection(planDe(plan, profile.id));

  /*
    Les deux arbitrages commerciaux de la prospection, réglés dans Réglages.

    Le délai au-delà duquel un appel chez la même organisation n'est plus un
    doublon, et le seuil de dormance. Ce dernier vaut `null` tant qu'il n'a pas
    été choisi, et ce `null` n'est pas un zéro : il éteint la notion.
  */
  const brut = (reglages?.value ?? {}) as {
    org_cooldown_days?: number;
    lead_dormancy_days?: number | null;
  };
  const cooldown = Number(brut.org_cooldown_days ?? 30);
  const dormance =
    typeof brut.lead_dormancy_days === "number" && brut.lead_dormancy_days > 0
      ? Math.round(brut.lead_dormancy_days)
      : null;

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
        dormanceJours={dormance}
        isAdmin={profile.role === "admin"}
        verrou={verrou}
      />
    </div>
  );
}
