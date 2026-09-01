import { redirect } from "next/navigation";

import type { Profile } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";

/** Profil de l'utilisateur connecté, ou `null` s'il n'y a pas de session. */
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  return data ?? null;
}

/** Exige une session ; redirige vers la connexion sinon. */
export async function requireProfile(): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect("/connexion");
  return profile;
}

/** Exige un compte interne (admin ou collaborateur). */
export async function requireStaff(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role === "client") redirect("/portail");
  return profile;
}

/** Exige un compte client. */
export async function requireClient(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== "client") redirect("/");
  return profile;
}

export async function requireAdmin(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/");
  return profile;
}
