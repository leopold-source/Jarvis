"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FolderCog, Plus, RefreshCw, Trash2, Webhook, XCircle } from "lucide-react";

import { Badge, Button, Card, Input, SectionTitle, Select, useToast } from "@/components/ui";
import { CALL_KIND, CALL_KIND_ORDER } from "@/lib/constants";
import type { CallKind, CallKindRule, WebhookEvent } from "@/lib/database.types";
import { formatRelative } from "@/lib/utils";
import {
  deleteKindRule,
  reapplyKindRules,
  saveKindRule,
} from "@/app/(crm)/parametres/claap-actions";

/** Un résultat de webhook n'est « bon » que s'il a abouti quelque part. */
const GOOD_OUTCOMES = ["rattache", "en_attente"];

export function ClaapSettings({
  rules,
  events,
  unmappedFolders,
  isAdmin,
}: {
  rules: CallKindRule[];
  events: WebhookEvent[];
  unmappedFolders: string[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [folder, setFolder] = useState("");
  const [kind, setKind] = useState<CallKind>("r1");
  const [busy, setBusy] = useState(false);

  // Un dossier rencontré sans règle est le meilleur point de départ : on le
  // propose plutôt que de laisser saisir un nom au hasard.
  useEffect(() => {
    if (!folder && unmappedFolders.length > 0) setFolder(unmappedFolders[0]);
  }, [unmappedFolders, folder]);

  async function add() {
    setBusy(true);
    const result = await saveKindRule(folder, kind);
    setBusy(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    setFolder("");
    startTransition(() => router.refresh());
  }

  async function remove(id: string) {
    const result = await deleteKindRule(id);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    startTransition(() => router.refresh());
  }

  async function reapply() {
    setBusy(true);
    const result = await reapplyKindRules();
    setBusy(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    toast(`${result.updated} call(s) réétiqueté(s).`);
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-5">
      <Card glow className="p-5">
        <SectionTitle
          title={
            <span className="flex items-center gap-2">
              <FolderCog className="size-4 text-brand-500 dark:text-brand-300" />
              Qualification par dossier
            </span>
          }
          description="Un call rangé dans un dossier Claap prend automatiquement la qualification correspondante. Un dossier sans règle laisse le call à qualifier à la main."
          action={
            isAdmin && rules.length > 0 ? (
              <Button variant="ghost" size="sm" loading={busy} onClick={reapply}>
                <RefreshCw className="size-3.5" />
                Réappliquer
              </Button>
            ) : null
          }
        />

        {rules.length === 0 ? (
          <p className="mt-3 text-[13px] text-[var(--text-muted)]">
            Aucune règle : tous les calls arrivent à qualifier.
          </p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="flex items-center gap-2 rounded-[10px] border border-[var(--border-subtle)] px-3 py-2"
              >
                <span className="flex-1 truncate font-mono text-[12.5px]">{rule.folder_title}</span>
                <span className="text-[var(--text-muted)]">→</span>
                <Badge tone={CALL_KIND[rule.kind].tone}>{CALL_KIND[rule.kind].label}</Badge>
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => remove(rule.id)}
                    aria-label="Supprimer la règle"
                    className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-rose-500"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {unmappedFolders.length > 0 ? (
          <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
            Dossiers rencontrés sans règle :
            {unmappedFolders.map((title) => (
              <button
                key={title}
                type="button"
                onClick={() => setFolder(title)}
                className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 font-mono text-[11px] transition-colors hover:text-brand-500 dark:hover:text-brand-300"
              >
                {title}
              </button>
            ))}
          </p>
        ) : null}

        {isAdmin ? (
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <Input
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
              placeholder="Nom du dossier Claap"
              className="min-w-44 flex-1"
            />
            <Select
              value={kind}
              onChange={(event) => setKind(event.target.value as CallKind)}
              className="w-auto min-w-36"
              aria-label="Qualification"
            >
              {CALL_KIND_ORDER.map((value) => (
                <option key={value} value={value}>
                  {CALL_KIND[value].label}
                </option>
              ))}
            </Select>
            <Button variant="primary" loading={busy} disabled={!folder.trim()} onClick={add}>
              <Plus className="size-3.5" />
              Ajouter
            </Button>
          </div>
        ) : null}
      </Card>

      <Card className="p-5">
        <SectionTitle
          title={
            <span className="flex items-center gap-2">
              <Webhook className="size-4 text-brand-500 dark:text-brand-300" />
              Derniers webhooks reçus
            </span>
          }
          description="Toute requête entrante est tracée, y compris refusée. Si cette liste est vide, aucun appel n'atteint l'application."
        />

        {events.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-[var(--border-strong)] p-3 text-[12.5px] text-[var(--text-muted)]">
            Aucun webhook reçu pour l&apos;instant. Vérifiez l&apos;URL déclarée dans Claap et
            qu&apos;un déploiement a bien eu lieu depuis l&apos;ajout de CLAAP_WEBHOOK_SECRET.
          </p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {events.map((event) => {
              const good = GOOD_OUTCOMES.includes(event.outcome);
              return (
                <li
                  key={event.id}
                  className="flex items-start gap-2 rounded-[10px] border border-[var(--border-subtle)] px-3 py-2"
                >
                  {good ? (
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                  ) : (
                    <XCircle className="mt-0.5 size-3.5 shrink-0 text-rose-500" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[12px]">{event.outcome}</p>
                    {event.detail ? (
                      <p className="text-[11.5px] text-[var(--text-muted)]">{event.detail}</p>
                    ) : null}
                    {!good && event.headers ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[11px] text-brand-500 dark:text-brand-300">
                          En-têtes reçus
                        </summary>
                        <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-[var(--surface-base)] p-2 text-[10.5px] leading-relaxed">
                          {JSON.stringify(event.headers, null, 1)}
                        </pre>
                      </details>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
                    {formatRelative(event.created_at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
