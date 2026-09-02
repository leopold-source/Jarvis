import { cn } from "@/lib/utils";

/**
 * Ossature affichée pendant le rendu d'une page.
 *
 * Sa vraie fonction n'est pas décorative : sa seule présence, via un
 * `loading.tsx`, autorise Next à préparer une route dynamique à l'avance et à
 * basculer immédiatement au clic. Sans elle, le prefetch est abandonné et
 * chaque navigation attend le serveur, écran figé.
 */
export function PageSkeleton({
  rows = 8,
  tiles = 0,
  className,
}: {
  rows?: number;
  tiles?: number;
  className?: string;
}) {
  return (
    <div className={cn("animate-fade-in space-y-6", className)} aria-hidden>
      <div className="space-y-2">
        <div className="skeleton h-6 w-48" />
        <div className="skeleton h-3.5 w-96 max-w-full" />
      </div>

      {tiles > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: tiles }).map((_, index) => (
            <div key={index} className="card h-24 p-4">
              <div className="skeleton h-3 w-20" />
              <div className="skeleton mt-3 h-6 w-16" />
            </div>
          ))}
        </div>
      ) : null}

      <div className="card overflow-hidden">
        <div className="border-b border-[var(--border-subtle)] px-4 py-3">
          <div className="skeleton h-3.5 w-32" />
        </div>
        <div className="divide-y divide-[var(--border-subtle)]">
          {Array.from({ length: rows }).map((_, index) => (
            <div
              key={index}
              style={{ ["--i" as string]: index }}
              className="stagger flex items-center gap-4 px-4 py-2.5"
            >
              <div className="skeleton h-3.5 flex-1" />
              <div className="skeleton hidden h-3.5 w-32 sm:block" />
              <div className="skeleton h-5 w-24 rounded-full" />
              <div className="skeleton hidden h-3.5 w-28 md:block" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
