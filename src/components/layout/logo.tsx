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
      <span
        className="relative grid shrink-0 place-items-center rounded-[10px] bg-linear-to-br from-brand-600 to-accent-500 shadow-[0_0_28px_-8px_var(--glow-brand)]"
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
