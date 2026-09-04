"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  Compass,
  FolderKanban,
  Banknote,
  Handshake,
  LayoutDashboard,
  Menu,
  Sparkles,
  Users,
  UsersRound,
  X,
} from "lucide-react";

import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui";
import type { AppRole } from "@/lib/database.types";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Tableau de bord", icon: LayoutDashboard, exact: true },
  { href: "/chantiers", label: "Chantiers", icon: Compass },
  { href: "/leads", label: "Leads", icon: Sparkles },
  { href: "/affaires", label: "Affaires", icon: Handshake },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/entreprises", label: "Entreprises", icon: Building2 },
  { href: "/projets", label: "Projets", icon: FolderKanban },
  { href: "/facturation", label: "Facturation", icon: Banknote },
] as const;

const ADMIN_NAV = [{ href: "/equipe", label: "Équipe & accès", icon: UsersRound }] as const;

/**
 * Retour visuel pendant une navigation.
 *
 * Les `loading.tsx` rendent la bascule instantanée dans la quasi-totalité des
 * cas ; ce voile ne se voit donc que sur une connexion lente, quand le
 * prefetch n'a pas eu le temps d'aboutir. C'est précisément là qu'un clic sans
 * réaction donne l'impression d'une application figée.
 */
function NavPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className="absolute inset-0 animate-fade-in bg-linear-to-r from-transparent via-brand-500/15 to-transparent"
    />
  );
}

export function Sidebar({ role }: { role: AppRole }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Une navigation ferme le tiroir mobile.
  useEffect(() => setMobileOpen(false), [pathname]);

  const items = role === "admin" ? [...NAV, ...ADMIN_NAV] : NAV;

  const content = (
    <div className="flex h-full flex-col gap-1 px-3 py-4">
      <div className="mb-4 flex items-center justify-between px-2">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight">Antichaos</span>
        </Link>
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Fermer le menu"
        >
          <X className="size-4" />
        </Button>
      </div>

      <nav className="flex flex-col gap-0.5">
        {items.map(({ href, label, icon: Icon, ...rest }) => {
          const exact = "exact" in rest && rest.exact;
          const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              prefetch
              className={cn(
                "group relative flex items-center gap-2.5 overflow-hidden rounded-[10px] px-3 py-2 text-[13.5px] font-medium",
                "transition-colors duration-150",
                active
                  ? "bg-[var(--surface-hover)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]/70 hover:text-[var(--text-primary)]",
              )}
            >
              {/* Curseur lumineux à gauche de l'entrée active. */}
              <span
                className={cn(
                  "absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-full transition-all duration-300",
                  active
                    ? "bg-linear-to-b from-brand-400 to-accent-400 opacity-100 shadow-[0_0_10px_var(--glow-brand)]"
                    : "opacity-0",
                )}
                aria-hidden
              />
              <Icon
                className={cn(
                  "size-4 shrink-0 transition-colors",
                  active ? "text-brand-400" : "text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]",
                )}
              />
              {label}
              <NavPending />
            </Link>
          );
        })}
      </nav>

    </div>
  );

  return (
    <>
      {/* Barre mobile */}
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2.5 lg:hidden">
        <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label="Ouvrir le menu">
          <Menu className="size-4.5" />
        </Button>
        <Link href="/" className="flex items-center gap-2">
          <Logo size="sm" />
          <span className="text-sm font-semibold">Antichaos</span>
        </Link>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 animate-fade-in bg-black/55 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <aside
            style={{ animation: "fade-up 0.25s cubic-bezier(0.22,1,0.36,1) both" }}
            className="relative h-full w-72 border-r border-[var(--border-strong)] bg-[var(--surface-raised)]"
          >
            {content}
          </aside>
        </div>
      ) : null}

      <aside className="hidden w-60 shrink-0 border-r border-[var(--border-subtle)] bg-[var(--surface-raised)]/60 lg:block">
        <div className="sticky top-0 h-dvh">{content}</div>
      </aside>
    </>
  );
}
