import { BotIcon, MailIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  getTokenResponse,
  NoValidTokenError,
  UserAuthorizationRequiredError,
} from "@vercel/connect";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { getGatewayModel } from "@db/services/settings";
import { env } from "@shared/environment";
import { googleWorkspaceTokenParams } from "@shared/google-workspace/connection";
import { requireRequestScope } from "@web/auth/request-scope";
import { GoogleWorkspaceAction } from "./_components/google-workspace-action";
import { HomeOverview } from "./_components/home-overview";
import { ModelSelector } from "./_components/model-selector";

export default async function Page({ searchParams }: PageProps<"/">) {
  const google = (await searchParams).google;
  const scope = await requireRequestScope();
  const [googleWorkspace, gatewayModel] = await Promise.all([
    readGoogleWorkspaceConnection(scope.userId),
    getGatewayModel(scope),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8">
      <HomeOverview />

      {google === "unavailable" ? (
        <Alert>
          <MailIcon />
          <AlertTitle>Google Workspace unavailable</AlertTitle>
          <AlertDescription>
            This deployment does not have a working Google OAuth connector yet.
          </AlertDescription>
        </Alert>
      ) : null}

      <GoogleWorkspaceSection connection={googleWorkspace} />

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
}: {
  readonly connection?: GoogleWorkspaceConnection;
}) {
  const state = connection?.state;
  const description =
    state === "connected"
      ? (connection?.accountLabel ?? "Gmail, Calendar, and Contacts connected.")
      : state === "unavailable"
        ? "Attach a Vercel Connect Google OAuth connector to enable this."
        : "Gmail, Calendar, and Contacts through your Google account.";

  return (
    <WorkspaceSection headingId="connections-heading" title="Connections">
      <div className="divide-y divide-border/50 border-y border-border/50">
        <ConnectorRow
          action={<GoogleWorkspaceAction state={state} />}
          description={description}
          icon={<MailIcon />}
          label="Google Workspace"
        />
      </div>
    </WorkspaceSection>
  );
}

interface GoogleWorkspaceConnection {
  readonly accountLabel: string | null;
  readonly state: "connected" | "disconnected" | "unavailable";
}

async function readGoogleWorkspaceConnection(
  userId: string
): Promise<GoogleWorkspaceConnection> {
  try {
    const response = await getTokenResponse(
      env.GOOGLE_CONNECTOR_UID,
      googleWorkspaceTokenParams(userId),
      { forceRefresh: true }
    );
    const claims = z
      .object({ email: z.string().optional() })
      .safeParse(response.claims);
    return {
      accountLabel:
        response.name ?? (claims.success ? (claims.data.email ?? null) : null),
      state: "connected",
    };
  } catch (error) {
    if (
      error instanceof UserAuthorizationRequiredError ||
      error instanceof NoValidTokenError
    ) {
      return { accountLabel: null, state: "disconnected" };
    }
    return { accountLabel: null, state: "unavailable" };
  }
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
