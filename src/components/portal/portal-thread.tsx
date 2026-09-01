"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Send } from "lucide-react";

import { Avatar, Button, Card, EmptyState, Textarea, useToast } from "@/components/ui";
import type { Comment, Profile } from "@/lib/database.types";
import { cn, formatRelative } from "@/lib/utils";
import { postClientComment } from "@/app/portail/actions";

export function PortalThread({
  projectId,
  comments,
  currentUser,
}: {
  projectId: string;
  comments: Comment[];
  currentUser: Profile;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    if (!body.trim()) return;
    setSending(true);
    const result = await postClientComment(projectId, body);
    setSending(false);
    if (!result.ok) {
      toast(result.error, "error");
      return;
    }
    setBody("");
    toast("Message envoyé à l'équipe Antichaos.");
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <Textarea
          rows={3}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Une question, une remarque sur un livrable…"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") send();
          }}
        />
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] text-[var(--text-muted)]">
            Votre message est visible par l&apos;équipe projet.
          </span>
          <Button variant="primary" size="sm" loading={sending} disabled={!body.trim()} onClick={send}>
            <Send className="size-3.5" />
            Envoyer
          </Button>
        </div>
      </Card>

      {comments.length === 0 ? (
        <Card>
          <EmptyState
            icon={<MessageSquare className="size-5" />}
            title="Aucun échange pour l'instant"
            description="Utilisez ce fil pour poser vos questions : l'équipe vous répond directement ici."
          />
        </Card>
      ) : (
        <ol className="flex flex-col gap-3">
          {comments.map((comment, index) => {
            const isMine = comment.author_id === currentUser.id;
            return (
              <li key={comment.id} style={{ ["--i" as string]: index }} className="stagger">
                <Card
                  className={cn(
                    "p-4",
                    isMine
                      ? "border-brand-500/25 bg-linear-to-br from-brand-500/6 to-transparent"
                      : undefined,
                  )}
                >
                  <div className="flex items-start gap-3">
                    <Avatar
                      name={isMine ? currentUser.full_name : "Antichaos"}
                      email={isMine ? currentUser.email : "equipe@antichaos.fr"}
                      size={30}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-medium">
                          {isMine ? "Vous" : "Équipe Antichaos"}
                        </span>
                        <span className="text-[11px] text-[var(--text-muted)]">
                          {formatRelative(comment.created_at)}
                        </span>
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
