import styles from "../../_components/panel.module.css";
import { MessageSquareIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import {
  combineChatUsage,
  formatChatUsage,
} from "@app/(authenticated)/chat/_lib/chat-usage";
import { Alert, AlertDescription } from "@web/components/ui/alert";
import { Badge } from "@web/components/ui/badge";
import { Button } from "@web/components/ui/button";
import { listChats } from "@db/services/chats";
import { requireRequestScope } from "@web/auth/request-scope";

export const dynamic = "force-dynamic";

export default async function AllChatsPage() {
  const scope = await requireRequestScope();
  const chats = await listChats(scope);
  const totalUsage = combineChatUsage(chats.map((chat) => chat.usage));
  const imessageSessionId = chats.find(
    (chat) => chat.channel === "channel:linq"
  )?.sessionId;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>De onde a gente parou</p>
          <h1 className="type-page-title">Suas conversas.</h1>
          <p className="type-supporting-body mt-1 text-muted-foreground">
            Todas as conversas deste espaço · Uso {formatChatUsage(totalUsage)}
          </p>
        </div>
        <Button nativeButton={false} render={<Link href="/chat" />} size="sm">
          <PlusIcon />
          Nova conversa
        </Button>
      </header>

      <section aria-label="Histórico de conversas" className="grid gap-2">
        {chats.length === 0 ? (
          <Alert>
            <MessageSquareIcon />
            <AlertDescription>
              Ainda não há conversas. Seu primeiro pedido começa aqui.
            </AlertDescription>
          </Alert>
        ) : (
          chats.map((chat) => (
            <Button
              key={chat.sessionId}
              nativeButton={false}
              render={
                <Link href={`/chat/${encodeURIComponent(chat.sessionId)}`} />
              }
              variant="surface"
            >
              <MessageSquareIcon
                className={
                  chat.sessionId === imessageSessionId
                    ? "size-4 shrink-0 text-information"
                    : "size-4 shrink-0 text-muted-foreground"
                }
              />
              <span className="min-w-0 flex-1 truncate">
                {chat.sessionId === imessageSessionId ? "iMessage" : chat.title}
              </span>
              {chat.sessionId === imessageSessionId ? (
                <Badge variant="information">Conversa principal</Badge>
              ) : null}
              <span className="hidden shrink-0 type-caption text-muted-foreground sm:block">
                {formatChatUsage(chat.usage)}
              </span>
              <time
                className="hidden shrink-0 type-caption text-muted-foreground sm:block"
                dateTime={chat.updatedAt}
              >
                {formatChatDate(chat.updatedAt)}
              </time>
            </Button>
          ))
        )}
      </section>
    </div>
  );
}

function formatChatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}
