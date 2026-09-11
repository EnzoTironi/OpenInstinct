import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { buttonVariants } from "@web/components/ui/button";
import { Effect, Result } from "effect";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { inspectPersonalMemory } from "../../../server/personal-memory/export";
import { serverRuntime } from "../../../server/runtime";

type MemorySnapshot = Effect.Success<ReturnType<typeof inspectPersonalMemory>>;

function ProfileEntries({
  profile,
}: {
  readonly profile: readonly (readonly [string, string])[];
}) {
  if (profile.length === 0) {
    return (
      <p className="type-supporting-body text-muted-foreground">
        No profile details saved.
      </p>
    );
  }

  return (
    <dl className="type-supporting-body grid gap-2">
      {profile.map(([field, value]) => (
        <div key={field} className="grid gap-1 sm:grid-cols-2">
          <dt className="text-muted-foreground capitalize">
            {field.replaceAll(/([A-Z])/g, " $1")}
          </dt>
          <dd className="wrap-break-word">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function noteDocumentContent(content: string): string {
  return (
    content.replace(/^<!--[^\n]*-->\r?\n/u, "") ||
    "No notes saved in this document."
  );
}

function AssistantNotes({
  notes,
}: {
  readonly notes: MemorySnapshot["notes"];
}) {
  if (notes.status === "unresolved") {
    return (
      <p className="type-supporting-body text-muted-foreground">
        Notes have not been located for this account yet. Continue a
        conversation with your assistant, then reload. This does not mean no
        notes are stored.
      </p>
    );
  }

  if (notes.documents.length === 0) {
    return (
      <p className="type-supporting-body text-muted-foreground">
        No notes saved in the located memory.
      </p>
    );
  }

  return (
    <>
      {notes.documents.map((document) => (
        <pre
          key={document.version}
          className="type-supporting-body rounded-lg bg-muted p-3 wrap-break-word whitespace-pre-wrap"
        >
          {noteDocumentContent(document.content)}
        </pre>
      ))}
    </>
  );
}

function PersonalMemoryBody({
  snapshot,
}: {
  readonly snapshot: MemorySnapshot;
}) {
  const profile = Object.entries(snapshot.profile).filter(
    (entry): entry is [string, string] => entry[1] !== null
  );

  return (
    <section
      aria-labelledby="personal-memory-heading"
      className="space-y-4 rounded-xl border p-4 sm:p-6"
    >
      <div className="space-y-2">
        <h2 id="personal-memory-heading" className="type-section-title">
          Personal memory
        </h2>
        <p className="type-supporting-body text-muted-foreground">
          Your saved profile and assistant notes. The download includes these
          records; conversations, files, connected accounts and schedules are
          excluded.
        </p>
      </div>
      <h3 className="type-supporting-body font-medium">Saved profile</h3>
      <ProfileEntries profile={profile} />
      <Link
        href="/personal-info"
        className={buttonVariants({ variant: "outline" })}
      >
        Edit or clear profile details
      </Link>
      <h3 className="type-supporting-body font-medium">Assistant notes</h3>
      <p className="type-supporting-body text-muted-foreground">
        To correct or forget a saved fact, tell your assistant in your private
        conversation which fact to change or remove from saved memory. Your
        assistant can update both profile details and notes. Earlier
        conversations and downloaded copies remain separate.
      </p>
      <AssistantNotes notes={snapshot.notes} />
      <a
        href="/api/account/personal-memory/export"
        download
        className={buttonVariants({ variant: "outline" })}
      >
        Download personal memory (JSON)
      </a>
    </section>
  );
}

export async function PersonalMemorySection() {
  const result = await serverRuntime.runPromise(
    inspectPersonalMemory(await headers()).pipe(Effect.result)
  );

  if (Result.isFailure(result)) {
    if (result.failure.reason === "unauthenticated") {
      redirect("/sign-in?callbackUrl=%2Faccount");
    }

    return (
      <Alert variant="destructive">
        <AlertTitle>Couldn&apos;t load personal memory</AlertTitle>
        <AlertDescription>Reload this page to try again.</AlertDescription>
      </Alert>
    );
  }

  return <PersonalMemoryBody snapshot={result.success} />;
}
