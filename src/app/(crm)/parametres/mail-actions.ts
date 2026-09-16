"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin, requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * L'interrupteur du tri automatique.
 *
 * Il coupe le passage quotidien, pas le bouton « Trier ». La distinction est
 * la raison d'être du réglage : ce qu'on veut parfois suspendre, c'est qu'une
 * machine touche à la boîte pendant qu'on n'y est pas — une semaine de congés,
 * un changement de consignes qu'on veut éprouver à la main d'abord. Couper
 * aussi le geste manuel reviendrait à retirer l'outil au lieu de l'automatisme.
 */
export async function fetchTriAuto(): Promise<boolean> {
  await requireStaff();
  const supabase = await createClient();

  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "mail")
    .maybeSingle();

  // Absent vaut activé : c'est l'état dans lequel l'application a toujours
  // tourné, et un réglage qu'on ajoute ne doit rien éteindre en arrivant.
  return (data?.value as { tri_auto?: boolean } | null)?.tri_auto !== false;
}

export async function setTriAuto(
  actif: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const supabase = await createClient();

  const { error } = await supabase.from("app_settings").upsert({
    key: "mail",
    value: { tri_auto: actif },
    updated_at: new Date().toISOString(),
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/parametres");
  revalidatePath("/mails");
  return { ok: true };
}
