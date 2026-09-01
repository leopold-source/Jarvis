"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, LogOut } from "lucide-react";

import { Avatar } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/constants";
import type { Profile } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export function UserMenu({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/connexion");
    router.refresh();
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex items-center gap-2 rounded-[10px] py-1 pr-2 pl-1 transition-colors",
          "hover:bg-[var(--surface-hover)]",
        )}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar name={profile.full_name} email={profile.email} size={28} />
        <span className="hidden text-left sm:block">
          <span className="block max-w-36 truncate text-[13px] leading-tight font-medium">
            {profile.full_name ?? profile.email}
          </span>
          <span className="block text-[11px] leading-tight text-[var(--text-muted)]">
            {ROLE_LABEL[profile.role]}
          </span>
        </span>
        <ChevronDown className="size-3.5 text-[var(--text-muted)]" />
      </button>

      {open ? (
        <div
          role="menu"
          className={cn(
            "absolute right-0 z-40 mt-2 w-60 animate-pop overflow-hidden rounded-xl",
            "border border-[var(--border-strong)] bg-[var(--surface-overlay)] shadow-[var(--shadow-pop)]",
          )}
        >
          <div className="border-b border-[var(--border-subtle)] px-3.5 py-3">
            <p className="truncate text-[13px] font-medium">{profile.full_name ?? "—"}</p>
            <p className="truncate text-[11.5px] text-[var(--text-muted)]">{profile.email}</p>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-rose-400"
          >
            <LogOut className="size-4" />
            Se déconnecter
          </button>
        </div>
      ) : null}
    </div>
  );
}
