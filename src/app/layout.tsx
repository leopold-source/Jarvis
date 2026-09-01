import type { Metadata, Viewport } from "next";

import { ToastProvider } from "@/components/ui";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Antichaos",
    template: "%s · Antichaos",
  },
  description: "CRM et pilotage de projets pour Antichaos.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0b12" },
    { media: "(prefers-color-scheme: light)", color: "#f7f8fc" },
  ],
};

/**
 * Applique le thème avant le premier rendu pour éviter le flash de couleur.
 * Volontairement inline et minuscule : il s'exécute avant l'hydratation.
 */
const THEME_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("antichaos-theme");
    var theme = stored || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
        />
      </head>
      <body className="min-h-dvh antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
