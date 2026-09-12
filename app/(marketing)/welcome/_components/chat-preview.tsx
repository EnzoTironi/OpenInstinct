import { Logo } from "@web/components/ui/logo";

const thread = [
  {
    from: "user",
    text: "Preciso do que chegou no Telegram hoje — só o que pede resposta.",
  },
  {
    from: "companion",
    text: "Três threads. Duas são urgentes. Quer que eu rascunhe as respostas?",
  },
  {
    from: "user",
    text: "Sim. Me avisa antes de enviar.",
  },
  {
    from: "companion",
    text: "Combinado. Rascunhos prontos — nada sai sem a sua aprovação.",
  },
] as const;

export function ChatPreview() {
  return (
    <figure className="mx-auto w-full max-w-md">
      <div className="rounded-[1.75rem] bg-card p-5 shadow-sm ring-1 ring-foreground/10">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-primary/10">
            <Logo />
          </span>
          <div className="min-w-0">
            <p className="type-label">Companion</p>
            <p className="type-caption text-muted-foreground">
              Telegram · WhatsApp
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          {thread.map((message) => {
            const fromUser = message.from === "user";
            return (
              <p
                className={
                  fromUser
                    ? "type-supporting-body ml-8 rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-primary-foreground"
                    : "type-supporting-body mr-8 rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5"
                }
                key={message.text}
              >
                {message.text}
              </p>
            );
          })}
        </div>
      </div>
      <figcaption className="sr-only">
        Exemplo de conversa: o Companion resume o dia e pede aprovação antes de
        enviar.
      </figcaption>
    </figure>
  );
}
