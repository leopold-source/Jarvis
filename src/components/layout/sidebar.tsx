"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  Compass,
  FolderKanban,
  Inbox,
  Banknote,
  Handshake,
  LayoutDashboard,
  Menu,
  MoreHorizontal,
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
  { href: "/mails", label: "Boîte mail", icon: Inbox },
  { href: "/leads", label: "Leads", icon: Sparkles },
  { href: "/affaires", label: "Affaires", icon: Handshake },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/entreprises", label: "Entreprises", icon: Building2 },
  { href: "/projets", label: "Projets", icon: FolderKanban },
  { href: "/facturation", label: "Facturation", icon: Banknote },
] as const;

const ADMIN_NAV = [{ href: "/equipe", label: "Équipe & accès", icon: UsersRound }] as const;

/*
  Les quatre destinations de la barre du bas.

  Un téléphone se tient d'une main et le pouce n'atteint pas le haut de
  l'écran ; c'est en bas que se met ce qu'on ouvre vingt fois par jour. Quatre
  et pas neuf : une barre d'onglets qui liste tout n'est plus une barre
  d'onglets, c'est un menu déguisé en barre. Le reste est derrière « Plus »,
  qui ouvre le même tiroir que le bureau.

  Le choix vient de la journée type — on regarde le tableau de bord, on appelle
  depuis les leads, on relit la boîte mail, on suit les affaires. Contacts,
  entreprises, projets et facturation se consultent, ils ne se pilotent pas au
  téléphone entre deux rendez-vous.
*/
const ONGLETS = ["/", "/leads", "/mails", "/affaires"] as const;

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

function estActif(pathname: string, href: string, exact?: boolean) {
  if (exact || href === "/") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ role, actions }: { role: AppRole; actions?: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Une navigation ferme le tiroir mobile.
  useEffect(() => setMobileOpen(false), [pathname]);

  // Le tiroir couvre l'écran : laisser la page défiler dessous donne le
  // sentiment d'avoir perdu sa place en le refermant.
  useEffect(() => {
    if (!mobileOpen) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const items = role === "admin" ? [...NAV, ...ADMIN_NAV] : NAV;
  const onglets = items.filter((item) => (ONGLETS as readonly string[]).includes(item.href));
  const autres = items.filter((item) => !(ONGLETS as readonly string[]).includes(item.href));

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

      <nav className="flex flex-col gap-0.5 overflow-y-auto">
        {items.map(({ href, label, icon: Icon, ...rest }) => {
          const active = estActif(pathname, href, "exact" in rest && rest.exact);
          return (
            <Link
              key={href}
              href={href}
              prefetch
              className={cn(
                "group relative flex items-center gap-2.5 overflow-hidden rounded-[10px] px-3 text-[13.5px] font-medium",
                // Plus haut au doigt qu'à la souris : sous 44 px, une entrée de
                // menu se rate une fois sur trois en marchant.
                "py-2.5 transition-colors duration-150 lg:py-2",
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
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 animate-fade-in bg-black/55 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <aside
            style={{ animation: "fade-up 0.25s cubic-bezier(0.22,1,0.36,1) both" }}
            className="relative h-full w-72 max-w-[85vw] border-r border-[var(--border-strong)] bg-[var(--surface-raised)] pb-[env(safe-area-inset-bottom)]"
          >
            {content}
          </aside>
        </div>
      ) : null}

      <aside className="hidden w-60 shrink-0 border-r border-[var(--border-subtle)] bg-[var(--surface-raised)]/60 lg:block">
        <div className="sticky top-0 h-dvh">{content}</div>
      </aside>

      <MobileChrome
        onglets={onglets}
        autres={autres.length}
        pathname={pathname}
        onOpen={() => setMobileOpen(true)}
        actions={actions}
      />
    </>
  );
}

/*
  La navigation du téléphone, rendue par le même composant que celle du bureau.

  Elle vit dans des éléments `fixed`, donc sa place dans l'arbre n'a pas
  d'importance — et c'est ce qui règle le défaut d'origine : la barre du haut
  était un enfant direct de la rangée flex du gabarit, si bien qu'elle se
  plaçait *à côté* du contenu au lieu d'être au-dessus. Sur un écran de
  téléphone, le contenu se retrouvait comprimé dans la moitié droite.
*/
function MobileChrome({
  onglets,
  autres,
  pathname,
  onOpen,
  actions,
}: {
  onglets: ReadonlyArray<{ href: string; label: string; icon: typeof LayoutDashboard }>;
  autres: number;
  pathname: string;
  onOpen: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <>
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-base)]/90 px-3 backdrop-blur-xl lg:hidden">
        <button
          type="button"
          onClick={onOpen}
          aria-label="Ouvrir le menu"
          className="grid size-10 place-items-center rounded-[10px] text-[var(--text-secondary)] transition-colors active:bg-[var(--surface-hover)]"
        >
          <Menu className="size-5" />
        </button>
        <Link href="/" className="flex min-w-0 items-center gap-2">
          <Logo size="sm" />
          <span className="truncate text-sm font-semibold">Antichaos</span>
        </Link>

        {/* Thème et compte : sans eux ici, ils n'existeraient plus du tout sur
            téléphone — l'en-tête du bureau est masqué à cette largeur. */}
        <span className="ml-auto flex items-center gap-0.5">{actions}</span>
      </div>

      <nav
        aria-label="Navigation principale"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-[var(--border-subtle)] bg-[var(--surface-base)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      >
        {onglets.map(({ href, label, icon: Icon }) => {
          const active = estActif(pathname, href, href === "/");
          return (
            <Link
              key={href}
              href={href}
              prefetch
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-14 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors",
                active ? "text-brand-400" : "text-[var(--text-muted)] active:text-[var(--text-secondary)]",
              )}
            >
              <Icon className="size-5" />
              {/* Le libellé complet ne tient pas sur un cinquième d'écran. */}
              <span className="max-w-full truncate px-1">{label.split(" ")[0]}</span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={onOpen}
          className="flex h-14 flex-col items-center justify-center gap-1 text-[10px] font-medium text-[var(--text-muted)] transition-colors active:text-[var(--text-secondary)]"
        >
          <MoreHorizontal className="size-5" />
          Plus{autres > 0 ? ` (${autres})` : ""}
        </button>
      </nav>
    </>
  );
}
