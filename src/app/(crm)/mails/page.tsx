import { PageHeader } from "@/components/layout/page-header";
import { MailReview } from "@/components/crm/mail-review";
import { requireStaff } from "@/lib/auth";
import type { MailRun, MailTriage } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Boîte mail" };

/**
 * La file de relecture.
 *
 * On n'y trouve que ce qui attend une décision humaine : ce que l'IA a rangé
 * sans hésiter n'a pas à encombrer l'écran, il est dans Gmail sous son
 * étiquette. Ce qui remonte ici, c'est ce qu'elle n'a pas su trancher et ce
 * qu'elle a rédigé sans avoir le droit de l'envoyer.
 */
export default async function MailsPage() {
  const profile = await requireStaff();
  const supabase = await createClient();

  const [{ data: mails }, { data: signales }, { data: passages }, { data: compte }] = await Promise.all([
    supabase
      .from("mail_triage")
      .select("*")
      .eq("user_id", profile.id)
      .eq("review", "en_attente")
      .order("received_at", { ascending: false })
      .limit(60),
    // Écartés mais dignes d'être sus : ils ont quitté la file de relecture, on
    // les rappelle donc explicitement.
    supabase
      .from("mail_triage")
      .select("*")
      .eq("user_id", profile.id)
      .eq("a_signaler", true)
      .gte("created_at", new Date(Date.now() - 3 * 86_400_000).toISOString())
      .order("received_at", { ascending: false })
      .limit(10),
    supabase
      .from("mail_runs")
      .select("*")
      .eq("user_id", profile.id)
      .order("started_at", { ascending: false })
      .limit(1),
    supabase
      .from("google_accounts")
      .select("email, scope")
      .eq("user_id", profile.id)
      .maybeSingle(),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        title="Boîte mail"
        description="Ce que le tri n'a pas su trancher, et les réponses qui attendent ton feu vert. Rien n'est jamais parti sans toi."
      />
      <MailReview
        mails={(mails ?? []) as MailTriage[]}
        signales={(signales ?? []) as MailTriage[]}
        dernierPassage={((passages ?? [])[0] as MailRun | undefined) ?? null}
        compteConnecte={compte?.email ?? null}
        perimetre={compte?.scope ?? ""}
      />
    </div>
  );
}
