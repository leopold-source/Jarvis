"use client";

import { useState } from "react";
import { MessageSquare, Send } from "lucide-react";

import { Avatar, Badge, Button, Card, EmptyState, Textarea, useToast } from "@/components/ui";
import type { Comment, Profile, Project } from "@/lib/database.types";
import { cn, formatRelative } from "@/lib/utils";
import { addComment } from "@/app/(crm)/projets/actions";

type MemberLite = { id: string; full_name: string | null; email: string; role: string };

/**
 * Fil d'échange du projet. Un message peut rester interne ou être partagé avec
 * le client : la bascule est explicite pour éviter toute fuite involontaire.
 */
export function ProjectComments({
  project,
  comments,
  members,
  currentUser,
  onChanged,
}: {
  project: Project;
  comments: Comment[];
  members: MemberLite[];
  currentUser: Profile;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [body, setBody] = useState("");
  const [clientVisible, setClientVisible] = useState(false);
  const [sending, setSending] = useState(false);

  const authorById = new Map(members.map((member) => [member.id, member]));

  async function send() {
    if (!body.trim()) return;
    setSending(true);
    const result = await addComment({
      project_id: project.id,
      entity_type: "project",
      entity_id: project.id,
      body,
      is_client_visible: clientVisible,
    });
    setSending(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    setBody("");
    onChanged();
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <Textarea
          rows={3}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Point d'avancement, question, décision prise…"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") send();
          }}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={clientVisible}
              onChange={(event) => setClientVisible(event.target.checked)}
              className="size-4 accent-[var(--color-brand-500)]"
            />
            Partager avec le client
          </label>
          <span className="text-[11px] text-[var(--text-muted)]">⌘ + Entrée pour envoyer</span>
          <Button
            variant="primary"
            size="sm"
            className="ml-auto"
            loading={sending}
            disabled={!body.trim()}
            onClick={send}
          >
            <Send className="size-3.5" />
            Publier
          </Button>
        </div>
      </Card>

      {comments.length === 0 ? (
        <Card>
          <EmptyState
            icon={<MessageSquare className="size-5" />}
            title="Aucun échange"
            description="Consignez ici les décisions et les points d'avancement du projet."
          />
        </Card>
      ) : (
        <ol className="flex flex-col gap-3">
          {[...comments].reverse().map((comment, index) => {
            const author = authorById.get(comment.author_id);
            const isClientMessage = !author;
            const isMine = comment.author_id === currentUser.id;

            return (
              <li key={comment.id} style={{ ["--i" as string]: index }} className="stagger">
                <Card
                  className={cn(
                    "p-4",
                    isClientMessage && "border-brand-500/30 bg-linear-to-br from-brand-500/6 to-transparent",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <Avatar
                      name={author?.full_name ?? "Client"}
                      email={author?.email ?? comment.author_id}
                      size={30}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-medium">
                          {author?.full_name ?? author?.email ?? "Côté client"}
                          {isMine ? " · vous" : ""}
                        </span>
                        <span className="text-[11px] text-[var(--text-muted)]">
                          {formatRelative(comment.created_at)}
                        </span>
                        {comment.is_client_visible ? (
                          <Badge tone="cyan">Partagé avec le client</Badge>
                        ) : (
                          <Badge tone="stone">Interne</Badge>
                        )}
                      </div>
                      <p className="mt-1.5 text-[13.5px] leading-relaxed whitespace-pre-wrap text-[var(--text-secondary)]">
                        {comment.body}
                      </p>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
