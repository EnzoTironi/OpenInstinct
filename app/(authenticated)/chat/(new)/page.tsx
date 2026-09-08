import { NewChat } from "./_components/new-chat";

export default function NewChatPage() {
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-background px-4 pb-[10vh] text-foreground sm:px-6">
      <div className="flex w-full max-w-xl flex-col items-center gap-6">
        <div className="space-y-2 text-center">
          <h1 className="type-page-title">What can I help you with?</h1>
          <p className="type-supporting-body text-muted-foreground">
            Think something through, remember what matters, or plan a reminder.
          </p>
        </div>
        <NewChat />
      </div>
    </div>
  );
}
