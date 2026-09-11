import { Sidebar } from "@/components/layout/sidebar";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { AssistantButton } from "@/components/assistant/assistant-overlay";
import { requireStaff } from "@/lib/auth";

/**
 * La coquille de l'application.
 *
 * Sur grand écran : une colonne de navigation à gauche, un en-tête à droite.
 * Sur téléphone, `Sidebar` rend sa propre chrome en position fixe — un en-tête
 * en haut, une barre d'onglets en bas — et cette rangée n'a plus qu'à réserver
 * la place correspondante. C'est ce partage qui manquait : la barre mobile
 * était un enfant direct de la rangée flex, donc un élément *à côté* du
 * contenu, et le téléphone affichait l'application sur la moitié droite de
 * l'écran.
 */
export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireStaff();

  return (
    <div className="flex min-h-dvh">
      <Sidebar
        role={profile.role}
        actions={
          <>
            <ThemeToggle />
            <UserMenu profile={profile} />
          </>
        }
      />

      {/*
        Les marges hautes et basses valent la hauteur des barres fixes du
        téléphone, plus la zone d'encoche. Elles disparaissent au format
        bureau, où l'en-tête reprend le flux normal.
      */}
      <div className="flex min-w-0 flex-1 flex-col pt-14 pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pt-0 lg:pb-0">
        <header className="sticky top-14 z-30 hidden h-14 items-center justify-end gap-1 border-b border-[var(--border-subtle)] bg-[var(--surface-base)]/85 px-4 backdrop-blur-xl sm:px-6 lg:top-0 lg:flex">
          <ThemeToggle />
          <UserMenu profile={profile} />
        </header>

        <main className="aurora min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8">{children}</main>
        <AssistantButton />
      </div>
    </div>
  );
}
