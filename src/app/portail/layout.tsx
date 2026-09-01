import Link from "next/link";

import { Logo } from "@/components/layout/logo";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { requireClient } from "@/lib/auth";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireClient();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--surface-base)]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Link href="/portail" className="flex items-center gap-2.5">
            <Logo />
            <span className="text-[15px] font-semibold tracking-tight">Antichaos</span>
          </Link>
          <span className="hidden rounded-full bg-[var(--surface-hover)] px-2.5 py-0.5 text-[11.5px] text-[var(--text-muted)] sm:inline">
            Espace client
          </span>
          <span className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <UserMenu profile={profile} />
          </span>
        </div>
      </header>

      <main className="aurora mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>

      <footer className="border-t border-[var(--border-subtle)] py-5 text-center text-[11.5px] text-[var(--text-muted)]">
        Une question&nbsp;? Écrivez à votre interlocuteur Antichaos depuis le fil d&apos;échange de votre projet.
      </footer>
    </div>
  );
}
