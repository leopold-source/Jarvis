"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Info, ShieldCheck, UserPlus } from "lucide-react";

import {
  Avatar,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  Select,
  useToast,
} from "@/components/ui";
import { ROLE_LABEL } from "@/lib/constants";
import type { AppRole, Profile } from "@/lib/database.types";
import { formatDate } from "@/lib/utils";
import {
  inviteUser,
  setMemberActive,
  updateMemberCompany,
  updateMemberRole,
} from "@/app/(crm)/equipe/actions";

type CompanyLite = { id: string; name: string };

const ROLE_TONE: Record<AppRole, "violet" | "indigo" | "cyan"> = {
  admin: "violet",
  member: "indigo",
  client: "cyan",
};

export function TeamManager({
  profiles,
  companies,
  currentUserId,
  invitesEnabled,
}: {
  profiles: Profile[];
  companies: CompanyLite[];
  currentUserId: string;
  invitesEnabled: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [inviting, setInviting] = useState(false);

  const staff = profiles.filter((profile) => profile.role !== "client");
  const clients = profiles.filter((profile) => profile.role === "client");
  const companyById = new Map(companies.map((company) => [company.id, company.name]));

  async function changeRole(profile: Profile, role: AppRole) {
    const result = await updateMemberRole(profile.id, role);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast(`${profile.full_name ?? profile.email} est désormais ${ROLE_LABEL[role].toLowerCase()}.`);
    startTransition(() => router.refresh());
  }

  async function changeCompany(profile: Profile, companyId: string) {
    const result = await updateMemberCompany(profile.id, companyId || null);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast("Rattachement mis à jour.");
    startTransition(() => router.refresh());
  }

  async function toggleActive(profile: Profile) {
    const result = await setMemberActive(profile.id, !profile.is_active);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast(profile.is_active ? "Accès suspendu." : "Accès réactivé.");
    startTransition(() => router.refresh());
  }

  function renderRow(profile: Profile) {
    const isSelf = profile.id === currentUserId;
    return (
      <li
        key={profile.id}
        className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--surface-hover)]/50"
      >
        <Avatar name={profile.full_name} email={profile.email} size={34} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium">
            {profile.full_name ?? "—"}
            {isSelf ? <span className="text-[var(--text-muted)]"> · vous</span> : null}
          </p>
          <p className="truncate text-[11.5px] text-[var(--text-muted)]">
            {profile.email} · arrivé le {formatDate(profile.created_at)}
          </p>
        </div>

        {!profile.is_active ? <Badge tone="rose">Suspendu</Badge> : null}

        {profile.role === "client" ? (
          <Select
            value={profile.company_id ?? ""}
            onChange={(event) => changeCompany(profile, event.target.value)}
            className="w-auto min-w-44"
            aria-label={`Entreprise de ${profile.email}`}
          >
            <option value="">Aucune entreprise</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </Select>
        ) : null}

        <Select
          value={profile.role}
          onChange={(event) => changeRole(profile, event.target.value as AppRole)}
          disabled={isSelf}
          className="w-auto min-w-40"
          aria-label={`Rôle de ${profile.email}`}
        >
          <option value="admin">Administrateur</option>
          <option value="member">Collaborateur</option>
          <option value="client">Client</option>
        </Select>

        <Button variant="ghost" size="sm" disabled={isSelf} onClick={() => toggleActive(profile)}>
          {profile.is_active ? "Suspendre" : "Réactiver"}
        </Button>
      </li>
    );
  }

  return (
    <>
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-400" />
          <p className="max-w-xl text-[12.5px] leading-relaxed text-[var(--text-muted)]">
            <span className="text-[var(--text-secondary)]">Administrateur</span> : accès complet, y compris les
            suppressions. <span className="text-[var(--text-secondary)]">Collaborateur</span> : tout le CRM et les
            projets. <span className="text-[var(--text-secondary)]">Client</span> : lecture seule des projets de son
            entreprise, limitée à ce que vous partagez. Ces règles sont appliquées directement en base par les
            politiques RLS de Supabase.
          </p>
        </div>
        <Button variant="primary" onClick={() => setInviting(true)}>
          <UserPlus className="size-4" />
          Inviter
        </Button>
      </Card>

      {!invitesEnabled ? (
        <Card className="flex items-start gap-2.5 border-amber-500/25 bg-amber-500/8 p-4">
          <Info className="mt-0.5 size-4 shrink-0 text-amber-400" />
          <p className="text-[12.5px] leading-relaxed text-amber-200/90">
            Les invitations par e-mail nécessitent la variable d&apos;environnement{" "}
            <code className="rounded bg-black/25 px-1 font-mono text-[11.5px]">SUPABASE_SERVICE_ROLE_KEY</code>.
            Ajoutez-la dans Vercel (Settings → Environment Variables) depuis Supabase → Project Settings → API.
            En attendant, créez les comptes depuis le tableau de bord Supabase.
          </p>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <div className="border-b border-[var(--border-subtle)] px-4 py-2.5">
          <p className="text-[12.5px] font-medium">Équipe interne ({staff.length})</p>
        </div>
        <ul className="divide-y divide-[var(--border-subtle)]">{staff.map(renderRow)}</ul>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-[var(--border-subtle)] px-4 py-2.5">
          <p className="text-[12.5px] font-medium">Accès clients ({clients.length})</p>
        </div>
        {clients.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12.5px] text-[var(--text-muted)]">
            Aucun accès client. Invitez un interlocuteur et rattachez-le à son entreprise pour ouvrir son portail.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">{clients.map(renderRow)}</ul>
        )}
      </Card>

      <InviteDialog
        open={inviting}
        companies={companies}
        onClose={() => setInviting(false)}
        onInvited={(message) => {
          setInviting(false);
          toast(message);
          startTransition(() => router.refresh());
        }}
      />

      {clients.length > 0 ? (
        <p className="text-[11.5px] text-[var(--text-muted)]">
          Rappel : un client sans entreprise rattachée ne voit aucun projet.{" "}
          {clients.filter((client) => !client.company_id).length > 0
            ? `${clients.filter((client) => !client.company_id).length} compte(s) dans ce cas.`
            : ""}
        </p>
      ) : null}
    </>
  );
}

function InviteDialog({
  open,
  companies,
  onClose,
  onInvited,
}: {
  open: boolean;
  companies: CompanyLite[];
  onClose: () => void;
  onInvited: (message: string) => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ email: "", full_name: "", role: "member" as AppRole, company_id: "" });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    setSaving(true);
    const result = await inviteUser({
      email: form.email,
      full_name: form.full_name,
      role: form.role,
      company_id: form.role === "client" ? form.company_id || null : null,
      redirectTo: `${window.location.origin}/auth/callback`,
    });
    setSaving(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    setForm({ email: "", full_name: "", role: "member", company_id: "" });
    onInvited(result.message ?? "Invitation envoyée.");
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Inviter un utilisateur"
      description="Il recevra un e-mail pour définir son mot de passe et accéder à son espace."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" loading={saving} onClick={submit}>
            Envoyer l&apos;invitation
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="Adresse e-mail">
          <Input
            type="email"
            value={form.email}
            onChange={(event) => set("email", event.target.value)}
            placeholder="prenom@entreprise.fr"
            autoFocus
          />
        </Field>
        <Field label="Nom complet">
          <Input value={form.full_name} onChange={(event) => set("full_name", event.target.value)} />
        </Field>
        <Field label="Rôle">
          <Select value={form.role} onChange={(event) => set("role", event.target.value as AppRole)}>
            <option value="member">Collaborateur — CRM et projets</option>
            <option value="admin">Administrateur — accès complet</option>
            <option value="client">Client — portail en lecture seule</option>
          </Select>
        </Field>
        {form.role === "client" ? (
          <Field
            label="Entreprise du client"
            hint="Détermine les projets auxquels ce compte aura accès."
          >
            <Select value={form.company_id} onChange={(event) => set("company_id", event.target.value)}>
              <option value="">Sélectionner…</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}
