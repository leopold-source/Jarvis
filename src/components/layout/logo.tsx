import { cn } from "@/lib/utils";

/**
 * Marque Antichaos : un « A » construit à partir de trois traits qui
 * s'ordonnent — le chaos qui se range. Rendu en SVG inline pour rester net et
 * suivre le dégradé de la marque sans charger d'image.
 */
export function Logo({
  size = "md",
  withWordmark = false,
  className,
}: {
  size?: "sm" | "md" | "lg";
  withWordmark?: boolean;
  className?: string;
}) {
  const dimensions = { sm: 28, md: 34, lg: 48 }[size];

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {/* La marque telle qu'elle est dessinée — un point, un trait — sous la
          charte Atelier. Les proportions sont celles du favicon : point et
          barre de même diamètre. Elle suit le thème : noire sur le papier,
          claire sur le noir. */}
      <svg
        viewBox="0 0 100 100"
        width={dimensions}
        height={dimensions}
        aria-hidden
        className="seulement-atelier shrink-0"
      >
        <rect width="100" height="100" rx="11.5" fill="var(--ink)" />
        <circle cx="23.5" cy="56.2" r="9.7" fill="var(--ink-contrast)" />
        <path
          d="M45.3 72.5 76.2 31.2"
          stroke="var(--ink-contrast)"
          strokeWidth="19.4"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      <span
        className="seulement-classique relative grid shrink-0 place-items-center rounded-[10px] bg-linear-to-br from-brand-600 to-accent-500 shadow-[0_0_28px_-8px_var(--glow-brand)]"
        style={{ width: dimensions, height: dimensions }}
      >
        <svg
          viewBox="0 0 24 24"
          width={dimensions * 0.6}
          height={dimensions * 0.6}
          fill="none"
          aria-hidden
        >
          <path
            d="M5 19 12 5l7 14"
            stroke="white"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M8.4 14.2h7.2" stroke="white" strokeWidth="2.1" strokeLinecap="round" opacity="0.85" />
        </svg>
      </span>
      {withWordmark ? (
        <span className="text-[15px] font-semibold tracking-tight">Antichaos</span>
      ) : null}
    </span>
  );
}
