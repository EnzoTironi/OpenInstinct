"use client";

import { googleWorkspaceReturnTo } from "@shared/google-workspace/connection";
import { Badge } from "@web/components/ui/badge";
import { Button } from "@web/components/ui/button";
import { api } from "@web/trpc/client";

function redirectWithGoogleUnavailable(returnPath: string) {
  const query = new URLSearchParams({
    google: "unavailable",
    returnTo: returnPath,
  });

  window.location.assign(`/?${query}`);
}

function redirectTo(redirectTo: string) {
  window.location.assign(redirectTo);
}

function workspaceActionLabel(state: "connected" | "disconnected") {
  if (state === "connected") {
    return "Disconnect";
  }

  return "Connect";
}

function workspaceAction(state: "connected" | "disconnected") {
  if (state === "connected") {
    return "disconnect";
  }

  return "connect";
}

function GoogleWorkspaceLoadingBadge() {
  return <Badge variant="secondary">Loading…</Badge>;
}

function GoogleWorkspaceUnavailableBadge() {
  return <Badge variant="secondary">Setup required</Badge>;
}

function GoogleWorkspaceConnectButton({
  state,
  returnPath,
}: {
  readonly returnPath: string;
  readonly state: "connected" | "disconnected";
}) {
  const update = api.googleWorkspace.update.useMutation({
    onError: () => {
      redirectWithGoogleUnavailable(returnPath);
    },
    onSuccess: ({ redirectTo: next }) => {
      redirectTo(next);
    },
  });

  const action = workspaceAction(state);

  return (
    <Button
      disabled={update.isPending}
      onClick={() => {
        update.mutate({ action, returnTo: returnPath });
      }}
      size="sm"
      type="button"
      variant="outline"
    >
      {workspaceActionLabel(state)}
    </Button>
  );
}

export function GoogleWorkspaceAction({
  state,
  returnTo,
}: {
  readonly state?: "connected" | "disconnected" | "unavailable";
  readonly returnTo?: string;
}) {
  const returnPath = googleWorkspaceReturnTo(returnTo);

  if (!state) {
    return <GoogleWorkspaceLoadingBadge />;
  }

  if (state === "unavailable") {
    return <GoogleWorkspaceUnavailableBadge />;
  }

  return <GoogleWorkspaceConnectButton returnPath={returnPath} state={state} />;
}
