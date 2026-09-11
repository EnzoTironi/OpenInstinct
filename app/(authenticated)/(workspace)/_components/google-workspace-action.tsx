"use client";

import { googleWorkspaceReturnTo } from "@shared/google-workspace/connection";
import { Badge } from "@web/components/ui/badge";
import { Button } from "@web/components/ui/button";
import { api } from "@web/trpc/client";

export function GoogleWorkspaceAction({
  state,
  returnTo,
}: {
  readonly state?: "connected" | "disconnected" | "unavailable";
  readonly returnTo?: string;
}) {
  const returnPath = googleWorkspaceReturnTo(returnTo);

  const update = api.googleWorkspace.update.useMutation({
    onError: () => {
      const query = new URLSearchParams({
        google: "unavailable",
        returnTo: returnPath,
      });

      window.location.assign(`/?${query}`);
    },
    onSuccess: ({ redirectTo }) => {
      window.location.assign(redirectTo);
    },
  });

  if (!state) {
    return <Badge variant="secondary">Loading…</Badge>;
  }

  if (state === "unavailable") {
    return <Badge variant="secondary">Setup required</Badge>;
  }

  const action = state === "connected" ? "disconnect" : "connect";

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
      {state === "connected" ? "Disconnect" : "Connect"}
    </Button>
  );
}
