"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, KeyRound, Mail } from "lucide-react";

import { Button, Card, Field, Input, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Mode = "password" | "magic";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();

  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [magicSent, setMagicSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = params.get("suite") ?? "/";

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createClient();

    try {
      if (mode === "password") {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        router.push(next);
        router.refresh();
      } else {
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?suite=${encodeURIComponent(next)}`,
          },
        });
        if (otpError) throw otpError;
        setMagicSent(true);
        toast("Lien de connexion envoyé, vérifiez votre boîte mail.", "info");
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Connexion impossible";
      setError(
        message.includes("Invalid login credentials")
          ? "E-mail ou mot de passe incorrect."
          : message,
      );
    } finally {
      setLoading(false);
    }
  }

  if (magicSent) {
    return (
      <Card glow className="animate-pop p-6 text-center">
        <div className="mx-auto grid size-11 place-items-center rounded-full bg-linear-to-br from-brand-500/20 to-accent-500/15 text-brand-300">
          <Mail className="size-5" />
        </div>
        <p className="mt-4 text-[15px] font-medium">Vérifiez votre boîte mail</p>
        <p className="mt-1.5 text-[13px] text-[var(--text-muted)]">
          Un lien de connexion a été envoyé à <span className="text-[var(--text-primary)]">{email}</span>.
        </p>
        <Button variant="ghost" size="sm" className="mt-4" onClick={() => setMagicSent(false)}>
          Utiliser une autre méthode
        </Button>
      </Card>
    );
  }

  return (
    <Card glow className="p-6">
      <div className="mb-5 flex rounded-[10px] bg-[var(--surface-hover)] p-1 text-[13px]">
        {(
          [
            { key: "password", label: "Mot de passe", icon: KeyRound },
            { key: "magic", label: "Lien magique", icon: Mail },
          ] as const
        ).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setMode(key)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 font-medium transition-all duration-200",
              mode === key
                ? "bg-[var(--surface-overlay)] text-[var(--text-primary)] shadow-[var(--shadow-card)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]",
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Adresse e-mail">
          <Input
            type="email"
            required
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="prenom@antichaos.fr"
          />
        </Field>

        {mode === "password" ? (
          <Field label="Mot de passe">
            <Input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
            />
          </Field>
        ) : null}

        {error ? (
          <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-400 ring-1 ring-rose-500/25">
            {error}
          </p>
        ) : null}

        <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full justify-center">
          {mode === "password" ? "Se connecter" : "Recevoir le lien"}
          {!loading ? <ArrowRight className="size-4" /> : null}
        </Button>
      </form>
    </Card>
  );
}
