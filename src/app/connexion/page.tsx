import { Suspense } from "react";
import type { Metadata } from "next";

import { LoginForm } from "./login-form";
import { Logo } from "@/components/layout/logo";

export const metadata: Metadata = { title: "Connexion" };

export default function LoginPage() {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-12">
      {/* Décor : grille et halo, sur leur propre calque pour que le masque de la
          grille ne rogne pas le contenu du formulaire. */}
      <div aria-hidden className="grid-backdrop pointer-events-none absolute inset-0" />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full opacity-70 blur-3xl"
        style={{
          background:
            "radial-gradient(45% 50% at 30% 40%, var(--glow-brand), transparent 70%), radial-gradient(45% 50% at 70% 55%, var(--glow-accent), transparent 70%)",
        }}
      />

      <div className="relative w-full max-w-sm animate-fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size="lg" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">
            Bienvenue sur <span className="text-gradient">Antichaos</span>
          </h1>
          <p className="mt-1.5 text-[13.5px] text-[var(--text-muted)]">
            Le CRM et le pilotage projet de l&apos;équipe.
          </p>
        </div>

        <Suspense fallback={<div className="skeleton h-72 w-full rounded-2xl" />}>
          <LoginForm />
        </Suspense>

        <p className="mt-6 text-center text-[12px] text-[var(--text-muted)]">
          Un souci d&apos;accès ? Contactez un administrateur Antichaos.
        </p>
      </div>
    </main>
  );
}
