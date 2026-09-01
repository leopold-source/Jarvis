"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Linkedin, Mail, Phone, Users } from "lucide-react";

import {
  Avatar,
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  Field,
  Input,
  SearchInput,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";
import { DEAL_STAGE } from "@/lib/constants";
import type { Contact, DealStage } from "@/lib/database.types";
import { formatDate, normalize } from "@/lib/utils";
import { updateContact } from "@/app/(crm)/contacts/actions";

type CompanyLite = { id: string; name: string };
type DealLite = { id: string; name: string; stage: DealStage; contact_id: string | null };

export function ContactsTable({
  contacts,
  companies,
  deals,
}: {
  contacts: Contact[];
  companies: CompanyLite[];
  deals: DealLite[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("toutes");
  const [selected, setSelected] = useState<Contact | null>(null);

  useEffect(() => {
    const id = params.get("contact");
    if (!id) return;
    const match = contacts.find((contact) => contact.id === id);
    if (match) setSelected(match);
  }, [params, contacts]);

  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c.name])), [companies]);
  const dealsByContact = useMemo(() => {
    const map = new Map<string, DealLite[]>();
    for (const deal of deals) {
      if (!deal.contact_id) continue;
      map.set(deal.contact_id, [...(map.get(deal.contact_id) ?? []), deal]);
    }
    return map;
  }, [deals]);

  const filtered = useMemo(() => {
    const needle = normalize(search.trim());
    return contacts.filter((contact) => {
      if (companyFilter !== "toutes" && contact.company_id !== companyFilter) return false;
      if (!needle) return true;
      const company = contact.company_id ? companyById.get(contact.company_id) : "";
      return normalize(
        [contact.full_name, contact.email, contact.phone, contact.job_title, company]
          .filter(Boolean)
          .join(" "),
      ).includes(needle);
    });
  }, [contacts, search, companyFilter, companyById]);

  return (
    <>
      <Card className="flex flex-wrap items-center gap-2.5 p-3.5">
        <SearchInput value={search} onChange={setSearch} placeholder="Nom, e-mail, poste…" className="min-w-56 flex-1" />
        <Select
          value={companyFilter}
          onChange={(event) => setCompanyFilter(event.target.value)}
          className="w-auto min-w-48"
          aria-label="Filtrer par entreprise"
        >
          <option value="toutes">Toutes les entreprises</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </Select>
        <span className="ml-auto text-[12.5px] text-[var(--text-muted)]">
          {filtered.length} contact{filtered.length > 1 ? "s" : ""}
        </span>
      </Card>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Users className="size-5" />}
            title="Aucun contact"
            description="Les contacts apparaissent dès qu'un lead est converti en affaire."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[13.5px]">
              <thead className="text-[11.5px] tracking-wide text-[var(--text-muted)] uppercase">
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="px-4 py-2.5 font-medium">Contact</th>
                  <th className="px-4 py-2.5 font-medium">Entreprise</th>
                  <th className="px-4 py-2.5 font-medium">Coordonnées</th>
                  <th className="px-4 py-2.5 font-medium">Affaires</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {filtered.map((contact, index) => (
                  <tr
                    key={contact.id}
                    onClick={() => setSelected(contact)}
                    style={{ ["--i" as string]: index % 30 }}
                    className="stagger cursor-pointer transition-colors hover:bg-[var(--surface-hover)]/60"
                  >
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2.5">
                        <Avatar name={contact.full_name} email={contact.email} size={30} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{contact.full_name || "Sans nom"}</span>
                          {contact.job_title ? (
                            <span className="block truncate text-[11.5px] text-[var(--text-muted)]">
                              {contact.job_title}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                      {contact.company_id ? companyById.get(contact.company_id) ?? "—" : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="flex flex-col gap-0.5 text-[11.5px] text-[var(--text-muted)]">
                        {contact.email ? (
                          <span className="inline-flex items-center gap-1 truncate">
                            <Mail className="size-3" />
                            {contact.email}
                          </span>
                        ) : null}
                        {contact.phone ? (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="size-3" />
                            {contact.phone}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="flex flex-wrap gap-1">
                        {(dealsByContact.get(contact.id) ?? []).slice(0, 2).map((deal) => (
                          <Badge key={deal.id} tone={DEAL_STAGE[deal.stage].tone}>
                            {DEAL_STAGE[deal.stage].short}
                          </Badge>
                        ))}
                        {(dealsByContact.get(contact.id) ?? []).length === 0 ? (
                          <span className="text-[var(--text-muted)]">—</span>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ContactDrawer
        contact={selected}
        companies={companies}
        deals={selected ? dealsByContact.get(selected.id) ?? [] : []}
        onClose={() => setSelected(null)}
        onSaved={() => startTransition(() => router.refresh())}
      />
    </>
  );
}

function ContactDrawer({
  contact,
  companies,
  deals,
  onClose,
  onSaved,
}: {
  contact: Contact | null;
  companies: CompanyLite[];
  deals: DealLite[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    job_title: "",
    linkedin_url: "",
    company_id: "",
    notes: "",
  });

  useEffect(() => {
    if (!contact) return;
    setForm({
      first_name: contact.first_name ?? "",
      last_name: contact.last_name ?? "",
      email: contact.email ?? "",
      phone: contact.phone ?? "",
      job_title: contact.job_title ?? "",
      linkedin_url: contact.linkedin_url ?? "",
      company_id: contact.company_id ?? "",
      notes: contact.notes ?? "",
    });
  }, [contact]);

  if (!contact) return null;

  function set(key: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (!contact) return;
    setSaving(true);
    const result = await updateContact(contact.id, {
      first_name: form.first_name || null,
      last_name: form.last_name || null,
      email: form.email || null,
      phone: form.phone || null,
      job_title: form.job_title || null,
      linkedin_url: form.linkedin_url || null,
      company_id: form.company_id || null,
      notes: form.notes || null,
    });
    setSaving(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast("Contact mis à jour.");
    onSaved();
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={contact.full_name || "Contact"}
      subtitle={contact.job_title ?? undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <Avatar name={contact.full_name} email={contact.email} size={48} />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-medium">{contact.full_name || "Sans nom"}</p>
            <p className="text-[12px] text-[var(--text-muted)]">
              Ajouté le {formatDate(contact.created_at, "long")}
            </p>
          </div>
          {contact.linkedin_url ? (
            <a
              href={contact.linkedin_url}
              target="_blank"
              rel="noreferrer"
              className="ml-auto rounded-lg p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-brand-300"
              aria-label="Profil LinkedIn"
            >
              <Linkedin className="size-4" />
            </a>
          ) : null}
        </div>

        {deals.length > 0 ? (
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-[var(--text-secondary)]">Affaires liées</p>
            <ul className="space-y-1.5">
              {deals.map((deal) => (
                <li key={deal.id}>
                  <Link
                    href={`/affaires?affaire=${deal.id}`}
                    className="flex items-center justify-between gap-3 rounded-[10px] border border-[var(--border-subtle)] px-3 py-2 text-[13px] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]/50"
                  >
                    <span className="truncate">{deal.name}</span>
                    <Badge tone={DEAL_STAGE[deal.stage].tone}>{DEAL_STAGE[deal.stage].short}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Prénom">
            <Input value={form.first_name} onChange={(event) => set("first_name", event.target.value)} />
          </Field>
          <Field label="Nom">
            <Input value={form.last_name} onChange={(event) => set("last_name", event.target.value)} />
          </Field>
          <Field label="E-mail">
            <Input type="email" value={form.email} onChange={(event) => set("email", event.target.value)} />
          </Field>
          <Field label="Téléphone">
            <Input value={form.phone} onChange={(event) => set("phone", event.target.value)} />
          </Field>
          <Field label="Poste">
            <Input value={form.job_title} onChange={(event) => set("job_title", event.target.value)} />
          </Field>
          <Field label="Entreprise">
            <Select value={form.company_id} onChange={(event) => set("company_id", event.target.value)}>
              <option value="">—</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="LinkedIn" className="sm:col-span-2">
            <Input value={form.linkedin_url} onChange={(event) => set("linkedin_url", event.target.value)} />
          </Field>
        </div>

        <Field label="Notes">
          <Textarea rows={6} value={form.notes} onChange={(event) => set("notes", event.target.value)} />
        </Field>

        <p className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-muted)]">
          <Building2 className="size-3.5" />
          Modifier l&apos;entreprise déplace ce contact dans un autre compte.
        </p>
      </div>
    </Drawer>
  );
}
