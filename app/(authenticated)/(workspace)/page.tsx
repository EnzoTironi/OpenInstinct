import { BotIcon, MailIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Effect, Result } from "effect";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";
import { getGatewayModel } from "@db/services/settings";
import { googleWorkspaceReturnTo } from "@shared/google-workspace/connection";
import { serverRuntime } from "../../../server/runtime";
import { readGoogleWorkspaceConnection } from "../../../server/google-workspace";
import { requireRequestScope } from "@web/auth/request-scope";
import { GoogleWorkspaceAction } from "./_components/google-workspace-action";
import { HomeOverview } from "./_components/home-overview";
import { ModelSelector } from "./_components/model-selector";

export default async function Page({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const google = params.google;
  const returnTo = googleWorkspaceReturnTo(params.returnTo);
  const scope = await requireRequestScope();
  const [googleWorkspace, gatewayModel] = await Promise.all([
    serverRuntime.runPromise(
      readGoogleWorkspaceConnection(scope).pipe(Effect.result)
    ),
    getGatewayModel(scope),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8">
      {returnTo !== "/" ? (
        <Button
          className="self-start"
          nativeButton={false}
          render={<Link href={returnTo} />}
          variant="outline"
        >
          Return to conversation
        </Button>
      ) : null}
      <HomeOverview />

      {google === "unavailable" ? (
        <Alert>
          <MailIcon />
          <AlertTitle>Google connection unavailable</AlertTitle>
          <AlertDescription>
            Your Google connection couldn’t be updated. You can return to your
            conversation and keep chatting.
          </AlertDescription>
        </Alert>
      ) : null}

      {Result.isFailure(googleWorkspace) ? (
        <Alert>
          <MailIcon />
          <AlertTitle>Couldn’t load your Google connection</AlertTitle>
          <AlertDescription>Reload this page to try again.</AlertDescription>
        </Alert>
      ) : (
        <GoogleWorkspaceSection
          connection={googleWorkspace.success}
          returnTo={returnTo}
        />
      )}

      <details className="rounded-lg border border-border/50 p-4">
        <summary className="cursor-pointer type-label">
          Advanced settings
        </summary>
        <div className="mt-3">
          <ConnectorRow
            action={<ModelSelector modelId={gatewayModel} />}
            description="Choose the model used when this installation runs through AI Gateway."
            icon={<BotIcon />}
            label="AI Gateway model"
          />
        </div>
      </details>
    </div>
  );
}

function GoogleWorkspaceSection({
  connection,
  returnTo,
}: {
  readonly connection: Effect.Success<
    ReturnType<typeof readGoogleWorkspaceConnection>
  >;
  readonly returnTo: string;
}) {
  const state = connection.state;
  const description =
    state === "connected"
      ? "Gmail, Calendar, and Contacts connected."
      : state === "unavailable"
        ? "Google connections aren’t enabled on this installation yet."
        : "Gmail, Calendar, and Contacts through your Google account.";

  return (
    <WorkspaceSection headingId="connections-heading" title="Connections">
      <div className="divide-y divide-border/50 border-y border-border/50">
        <ConnectorRow
          action={<GoogleWorkspaceAction returnTo={returnTo} state={state} />}
          description={description}
          icon={<MailIcon />}
          label="Google Workspace"
        />
      </div>
    </WorkspaceSection>
  );
}

function WorkspaceSection({
  children,
  headingId,
  title,
}: {
  readonly children: ReactNode;
  readonly headingId: string;
  readonly title: string;
}) {
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 className="type-section-title" id={headingId}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function ConnectorRow({
  action,
  description,
  icon,
  label,
}: {
  readonly action: ReactNode;
  readonly description: string;
  readonly icon: ReactNode;
  readonly label: string;
}) {
  return (
    <div className="flex items-center gap-3 py-4">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50 text-muted-foreground">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="type-label">{label}</p>
        <p className="truncate type-caption text-muted-foreground">
          {description}
        </p>
      </div>
      {action}
    </div>
  );
}
