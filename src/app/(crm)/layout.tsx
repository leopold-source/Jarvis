import { Sidebar } from "@/components/layout/sidebar";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { requireStaff } from "@/lib/auth";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireStaff();

  return (
    <div className="flex min-h-dvh">
      <Sidebar role={profile.role} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-end gap-1 border-b border-[var(--border-subtle)] bg-[var(--surface-base)]/85 px-4 backdrop-blur-xl sm:px-6">
          <ThemeToggle />
          <UserMenu profile={profile} />
        </header>

        <main className="aurora min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
