"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { createClient as createAdminClient } from "@supabase/supabase-js";

import type { AppRole, Database } from "@/lib/database.types";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: string };

/** La clé service_role n'est lue que côté serveur, jamais exposée au client. */
function adminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createAdminClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function updateMemberRole(userId: string, role: AppRole): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (userId === admin.id) return { ok: false, error: "Vous ne pouvez pas changer votre propre rôle." };

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/equipe");
  return { ok: true };
}

export async function updateMemberCompany(userId: string, companyId: string | null): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await createClient();

  const { error } = await supabase.from("profiles").update({ company_id: companyId }).eq("id", userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/equipe");
  return { ok: true };
}

export async function setMemberActive(userId: string, active: boolean): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (userId === admin.id) return { ok: false, error: "Vous ne pouvez pas vous désactiver vous-même." };

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ is_active: active }).eq("id", userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/equipe");
  return { ok: true };
}

/**
 * Envoie une invitation par e-mail. Le rôle (et l'entreprise pour un client)
 * voyagent dans les metadata : le trigger `handle_new_user` les reprend pour
 * créer le profil avec les bons droits dès la première connexion.
 */
export async function inviteUser(input: {
  email: string;
  full_name: string;
  role: AppRole;
  company_id?: string | null;
  redirectTo: string;
}): Promise<ActionResult> {
  await requireAdmin();

  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Adresse e-mail invalide." };
  }
  if (input.role === "client" && !input.company_id) {
    return { ok: false, error: "Un compte client doit être rattaché à une entreprise." };
  }

  const admin = adminClient();
  if (!admin) {
    return {
      ok: false,
      error:
        "Clé SUPABASE_SERVICE_ROLE_KEY absente. Ajoutez-la dans les variables d'environnement Vercel pour activer les invitations.",
    };
  }

  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: input.redirectTo,
    data: {
      full_name: input.full_name.trim() || email.split("@")[0],
      role: input.role,
      company_id: input.company_id ?? "",
    },
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/equipe");
  return { ok: true, message: `Invitation envoyée à ${email}.` };
}

/* ----------------------------------------------------- Compte de démonstration */

const DEMO_EMAIL = "demo.client@antichaos.dev";

/**
 * Crée (ou réinitialise) le compte client de démonstration.
 *
 * Une invitation par e-mail ne convient pas ici : personne ne relève cette
 * boîte, et l'intérêt d'une démonstration est de pouvoir se connecter tout de
 * suite. On crée donc l'utilisateur avec un mot de passe rendu à l'écran, une
 * seule fois — c'est aussi pour cela qu'il est régénéré à chaque appel plutôt
 * que stocké quelque part.
 *
 * Le compte est rattaché à l'entreprise fictive « (DÉMO) » et ne voit qu'elle :
 * la RLS ne fait aucune différence entre un client de démonstration et un vrai.
 */
export async function creerCompteDemo(): Promise<
  ActionResult<{ email: string; motDePasse: string }>
> {
  await requireAdmin();

  const admin = adminClient();
  if (!admin) return { ok: false, error: "Clé SUPABASE_SERVICE_ROLE_KEY absente." };

  const { data: entreprise } = await admin
    .from("companies")
    .select("id, name")
    .ilike("name", "%(DÉMO)%")
    .maybeSingle();

  if (!entreprise) {
    return {
      ok: false,
      error: "Aucune entreprise de démonstration en base. Le jeu de données n'a pas été posé.",
    };
  }

  // Mot de passe long et aléatoire : ce compte voit de vraies pages, même si
  // les données sont fictives.
  const motDePasse = `Demo-${randomUUID().slice(0, 18)}`;

  const { data: existants } = await admin.auth.admin.listUsers({ perPage: 200 });
  const deja = existants?.users.find((u) => u.email === DEMO_EMAIL);

  if (deja) {
    const { error } = await admin.auth.admin.updateUserById(deja.id, {
      password: motDePasse,
      email_confirm: true,
      user_metadata: { full_name: "Client démo", role: "client", company_id: entreprise.id },
    });
    if (error) return { ok: false, error: error.message };

    // Le trigger ne repasse pas sur un compte existant : on aligne le profil.
    await admin
      .from("profiles")
      .update({ role: "client", company_id: entreprise.id, full_name: "Client démo", is_active: true })
      .eq("id", deja.id);
  } else {
    const { data: cree, error } = await admin.auth.admin.createUser({
      email: DEMO_EMAIL,
      password: motDePasse,
      email_confirm: true,
      user_metadata: { full_name: "Client démo", role: "client", company_id: entreprise.id },
    });
    if (error) return { ok: false, error: error.message };

    if (cree.user) {
      await admin
        .from("profiles")
        .update({ role: "client", company_id: entreprise.id, full_name: "Client démo", is_active: true })
        .eq("id", cree.user.id);
    }
  }

  revalidatePath("/equipe");
  return { ok: true, data: { email: DEMO_EMAIL, motDePasse } };
}
