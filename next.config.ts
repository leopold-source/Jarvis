import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Réduit le JS envoyé au client pour les grosses librairies d'icônes.
    optimizePackageImports: ["lucide-react", "date-fns"],
  },
};

export default nextConfig;
