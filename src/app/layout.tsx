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
  var root = document.documentElement;
  try {
    var stored = localStorage.getItem("antichaos-theme");
    var theme = stored || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    root.setAttribute("data-theme", theme);
  } catch (e) {
    root.setAttribute("data-theme", "dark");
  }
  try {
    if (localStorage.getItem("antichaos-charte") === "classique") root.setAttribute("data-charte", "classique");
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /*
      `data-charte` : la charte Atelier par défaut, la charte d'origine sur
      demande. Posée avant la peinture par le script ci-dessous, comme le
      thème, pour qu'aucune des deux ne s'affiche une fraction de seconde avant
      l'autre.
    */
    <html lang="fr" data-theme="dark" data-charte="atelier" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600;700&family=Schibsted+Grotesk:wght@400;500;600;700;800&display=swap"
        />
      </head>
      <body className="min-h-dvh antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
