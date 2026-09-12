"use client";

import { useState } from "react";
import { authClient } from "@web/auth/client";
import { api } from "@web/trpc/client";
import { Alert, AlertDescription } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";

interface LinkedChannelIdentity {
  readonly id: string;
  readonly channel: "telegram" | "kapso";
  readonly senderId: string;
}

export function LinkedChannels({
  identities,
}: {
  readonly identities: readonly LinkedChannelIdentity[];
}) {
  const [selected, setSelected] = useState<string>();
  const [lastAccess, setLastAccess] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const selectedIdentity = identities.find(
    (identity) => identity.id === selected
  );
  const revoke = api.accountChannels.revoke.useMutation({
    onSuccess(result) {
      if (result.status === "last_access") {
        setLastAccess(true);
        return;
      }
      setSigningOut(true);
      void authClient.signOut().finally(() => {
        window.location.assign("/sign-in?reason=channel-unlinked");
      });
    },
  });
  return (
    <div className="space-y-3">
      {signingOut ? (
        <Alert>
          <AlertDescription>
            Channel disconnected. Signing you out…
          </AlertDescription>
        </Alert>
      ) : null}
      {identities.length === 0 ? (
        <p className="type-supporting-body text-muted-foreground">
          No messengers linked yet. Use “Link another channel” below to connect
          Telegram or WhatsApp.
        </p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {identities.map((identity) => (
            <li
              key={identity.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div className="min-w-0">
                <p className="type-supporting-body font-medium">
                  {identity.channel === "telegram" ? "Telegram" : "WhatsApp"}
                </p>
                <p className="type-caption break-all text-muted-foreground">
                  {identity.senderId}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={
                  revoke.isPending || signingOut || identities.length < 2
                }
                onClick={() => {
                  revoke.reset();
                  setLastAccess(false);
                  setSelected(identity.id);
                }}
              >
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      )}
      {identities.length === 1 || lastAccess ? (
        <Alert>
          <AlertDescription>
            This is your last sign-in channel. Link another channel before
            disconnecting it.
          </AlertDescription>
        </Alert>
      ) : null}
      {selectedIdentity ? (
        <section
          className="space-y-3 rounded-xl border p-4"
          aria-label="Confirm channel disconnection"
        >
          <p className="type-supporting-body">
            Disconnect{" "}
            {selectedIdentity.channel === "telegram" ? "Telegram" : "WhatsApp"}{" "}
            ({selectedIdentity.senderId})? You will be signed out on all
            browsers. Use a remaining linked channel to sign in again.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="destructive"
              disabled={revoke.isPending || signingOut || lastAccess}
              onClick={() => {
                revoke.mutate({ identityId: selectedIdentity.id });
              }}
            >
              {revoke.isPending ? "Disconnecting…" : "Disconnect and sign out"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={revoke.isPending || signingOut}
              onClick={() => {
                setSelected(undefined);
                setLastAccess(false);
                revoke.reset();
              }}
            >
              Cancel
            </Button>
          </div>
        </section>
      ) : null}
      {revoke.error ? (
        <Alert variant="destructive">
          <AlertDescription>{revoke.error.message}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
