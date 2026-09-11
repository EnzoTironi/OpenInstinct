"use client";

import { authClient } from "@web/auth/client";
import { Alert, AlertDescription } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";
import { api } from "@web/trpc/client";
import type { Effect } from "effect";
import { useState } from "react";

import type { readLinkedChannelIdentities } from "../../../server/accounts/controls";

type LinkedIdentity = Effect.Success<
  ReturnType<typeof readLinkedChannelIdentities>
>[number];

function channelLabel(channel: LinkedIdentity["channel"]): string {
  if (channel === "telegram") return "Telegram";

  return "WhatsApp";
}

function SigningOutAlert({ signingOut }: { readonly signingOut: boolean }) {
  if (!signingOut) return null;

  return (
    <Alert>
      <AlertDescription>
        Channel disconnected. Signing you out…
      </AlertDescription>
    </Alert>
  );
}

function LastAccessAlert({
  identities,
  lastAccess,
}: {
  readonly identities: readonly LinkedIdentity[];
  readonly lastAccess: boolean;
}) {
  if (identities.length !== 1 && !lastAccess) return null;

  return (
    <Alert>
      <AlertDescription>
        This is your last sign-in channel. Link another channel before
        disconnecting it.
      </AlertDescription>
    </Alert>
  );
}

function RevokeErrorAlert({
  message,
}: {
  readonly message: string | undefined;
}) {
  if (!message) return null;

  return (
    <Alert variant="destructive">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function LinkedIdentityRow({
  identity,
  disabled,
  onDisconnect,
}: {
  readonly identity: LinkedIdentity;
  readonly disabled: boolean;
  readonly onDisconnect: (id: string) => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="type-supporting-body font-medium">
          {channelLabel(identity.channel)}
        </p>
        <p className="type-caption break-all text-muted-foreground">
          {identity.senderId}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => {
          onDisconnect(identity.id);
        }}
      >
        Disconnect
      </Button>
    </li>
  );
}

function LinkedIdentityList({
  identities,
  revokePending,
  signingOut,
  onSelect,
}: {
  readonly identities: readonly LinkedIdentity[];
  readonly revokePending: boolean;
  readonly signingOut: boolean;
  readonly onSelect: (id: string) => void;
}) {
  if (identities.length === 0) {
    return (
      <p className="type-supporting-body text-muted-foreground">
        No messengers linked yet. Use “Link another channel” below to connect
        Telegram or WhatsApp.
      </p>
    );
  }

  return (
    <ul className="divide-y rounded-xl border">
      {identities.map((identity) => (
        <LinkedIdentityRow
          key={identity.id}
          disabled={revokePending || signingOut || identities.length < 2}
          identity={identity}
          onDisconnect={onSelect}
        />
      ))}
    </ul>
  );
}

function ConfirmDisconnect({
  identity,
  revokePending,
  signingOut,
  lastAccess,
  onConfirm,
  onCancel,
}: {
  readonly identity: LinkedIdentity;
  readonly revokePending: boolean;
  readonly signingOut: boolean;
  readonly lastAccess: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <section
      className="space-y-3 rounded-xl border p-4"
      aria-label="Confirm channel disconnection"
    >
      <p className="type-supporting-body">
        Disconnect {channelLabel(identity.channel)} ({identity.senderId})? You
        will be signed out on all browsers. Use a remaining linked channel to
        sign in again.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          disabled={revokePending || signingOut || lastAccess}
          onClick={onConfirm}
        >
          {revokePending ? "Disconnecting…" : "Disconnect and sign out"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={revokePending || signingOut}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </section>
  );
}

function handleRevokeSuccess(
  status: string,
  setLastAccess: (value: boolean) => void,
  setSigningOut: (value: boolean) => void
) {
  if (status === "last_access") {
    setLastAccess(true);

    return;
  }

  setSigningOut(true);
  void authClient.signOut().finally(() => {
    window.location.assign("/sign-in?reason=channel-unlinked");
  });
}

export function LinkedChannels({
  identities,
}: {
  readonly identities: Effect.Success<
    ReturnType<typeof readLinkedChannelIdentities>
  >;
}) {
  const [selected, setSelected] = useState<string>();
  const [lastAccess, setLastAccess] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const selectedIdentity = identities.find(
    (identity) => identity.id === selected
  );

  const revoke = api.accountChannels.revoke.useMutation({
    onSuccess(result) {
      handleRevokeSuccess(result.status, setLastAccess, setSigningOut);
    },
  });

  return (
    <div className="space-y-3">
      <SigningOutAlert signingOut={signingOut} />
      <LinkedIdentityList
        identities={identities}
        revokePending={revoke.isPending}
        signingOut={signingOut}
        onSelect={(id) => {
          revoke.reset();
          setLastAccess(false);
          setSelected(id);
        }}
      />
      <LastAccessAlert identities={identities} lastAccess={lastAccess} />
      {selectedIdentity ? (
        <ConfirmDisconnect
          identity={selectedIdentity}
          lastAccess={lastAccess}
          revokePending={revoke.isPending}
          signingOut={signingOut}
          onCancel={() => {
            setSelected(undefined);
            setLastAccess(false);
            revoke.reset();
          }}
          onConfirm={() => {
            revoke.mutate({ identityId: selectedIdentity.id });
          }}
        />
      ) : null}
      <RevokeErrorAlert message={revoke.error?.message} />
    </div>
  );
}
