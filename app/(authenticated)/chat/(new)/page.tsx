import { NewChat } from "./_components/new-chat";
import { Logo } from "@web/components/ui/logo";
import { chatStarters } from "../../_lib/chat-starters";

export default async function NewChatPage({
  searchParams,
}: PageProps<"/chat">) {
  const params = await searchParams;
  const starter = chatStarters.find((item) => item.id === params.starter);
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-transparent px-5 py-8 text-foreground sm:px-6">
      <div className="flex w-full max-w-xl flex-col items-center gap-6">
        <Logo className="size-20 shadow-lg" />
        <div className="space-y-3 text-center">
          <h1 className="type-page-title">Pode deixar comigo.</h1>
          <p className="type-supporting-body text-muted-foreground">
            Uma coisa a menos para resolver.
          </p>
        </div>
        <NewChat initialDraft={starter?.text} key={starter?.id ?? "new"} />
      </div>
    </div>
  );
}
