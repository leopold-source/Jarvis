"use client";

import { useState } from "react";
import { Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";

import { Button, Card, Field, Input, SectionTitle, useToast } from "@/components/ui";
import { changePassword } from "@/app/(crm)/parametres/password-actions";

export function PasswordForm() {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });

  const set = (key: keyof typeof form, value: string) =>
    setForm((state) => ({ ...state, [key]: value }));

  // Un indicateur volontairement simple : il mesure la longueur et la variété,
  // pas la « complexité » au sens des règles arbitraires qui poussent surtout
  // à choisir des mots de passe difficiles à retenir et faciles à deviner.
  const strength = (() => {
    const value = form.next;
    if (!value) return null;
    const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^\w]/].filter((re) => re.test(value)).length;
    const score = Math.min(4, Math.floor(value.length / 5) + variety - 1);
    return [
      { label: "Trop court", tone: "bg-rose-500", width: "20%" },
      { label: "Faible", tone: "bg-orange-500", width: "40%" },
      { label: "Correct", tone: "bg-amber-500", width: "60%" },
      { label: "Bon", tone: "bg-lime-500", width: "80%" },
      { label: "Excellent", tone: "bg-emerald-500", width: "100%" },
    ][Math.max(0, score)];
  })();

  async function submit() {
    if (form.next !== form.confirm) {
      toast("La confirmation ne correspond pas.", "error");
      return;
    }
    setSaving(true);
    const result = await changePassword(form.current, form.next);
    setSaving(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    setForm({ current: "", next: "", confirm: "" });
    toast("Mot de passe modifié.");
  }

  return (
    <Card className="p-5">
      <SectionTitle
        title={
          <span className="flex items-center gap-2">
            <KeyRound className="size-4 text-brand-500 dark:text-brand-300" />
            Mot de passe
          </span>
        }
        description="Au moins 10 caractères. Une phrase dont vous vous souvenez vaut mieux qu'une suite de symboles."
        action={
          <Button variant="ghost" size="sm" onClick={() => setReveal((value) => !value)}>
            {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            {reveal ? "Masquer" : "Afficher"}
          </Button>
        }
      />

      <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
        <Field label="Mot de passe actuel" className="sm:col-span-2">
          <Input
            type={reveal ? "text" : "password"}
            autoComplete="current-password"
            value={form.current}
            onChange={(event) => set("current", event.target.value)}
          />
        </Field>
        <Field label="Nouveau mot de passe">
          <Input
            type={reveal ? "text" : "password"}
            autoComplete="new-password"
            value={form.next}
            onChange={(event) => set("next", event.target.value)}
          />
        </Field>
        <Field label="Confirmation">
          <Input
            type={reveal ? "text" : "password"}
            autoComplete="new-password"
            value={form.confirm}
            onChange={(event) => set("confirm", event.target.value)}
          />
        </Field>
      </div>

      {strength ? (
        <div className="mt-3 flex items-center gap-2.5">
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--surface-hover)]">
            <span
              className={`block h-full rounded-full transition-all duration-500 ease-out ${strength.tone}`}
              style={{ width: strength.width }}
            />
          </span>
          <span className="text-[11.5px] text-[var(--text-muted)]">{strength.label}</span>
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="primary"
          loading={saving}
          disabled={!form.current || !form.next || !form.confirm}
          onClick={submit}
        >
          <ShieldCheck className="size-3.5" />
          Changer le mot de passe
        </Button>
      </div>
    </Card>
  );
}
