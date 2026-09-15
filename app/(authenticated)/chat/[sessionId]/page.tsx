import { notFound } from "next/navigation";
import { ChatSession } from "./_components/chat-session";
import { readChat } from "@db/services/chats";
import { isSessionOwned } from "@db/services/sessions";
import { requireRequestScope } from "@web/auth/request-scope";

export default async function ChatSessionPage({
  params,
}: PageProps<"/chat/[sessionId]">) {
  const { sessionId } = await params;
  const scope = await requireRequestScope();
  if (!(await isSessionOwned(scope, sessionId))) notFound();
  const chat = await readChat(scope, sessionId);
  return (
    <ChatSession
      initialUsage={chat?.usage}
      key={sessionId}
      sessionId={sessionId}
    />
  );
}
