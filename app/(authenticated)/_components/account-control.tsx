"use client";

import { reauthenticationDestination } from "@web/auth/channel/client";
import { authClient } from "@web/auth/client";
import { Alert, AlertDescription } from "@web/components/ui/alert";
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@web/components/ui/sidebar";
import { LogOutIcon, UserIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export function AuthenticatedAccountControl() {
  const { data: session } = authClient.useSession();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!session?.user) return null;

  const accountLabel = session.user.name || "Signed in";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          render={<Link href="/account" />}
          tooltip="Account, channels, and plan"
        >
          <UserIcon />
          <span>{accountLabel}</span>
        </SidebarMenuButton>
        <SidebarMenuAction
          aria-label="Sign out"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setFailed(false);
            void Promise.allSettled([authClient.signOut()]).then(
              ([outcome]) => {
                const destination = reauthenticationDestination(outcome, "/");

                if (destination) {
                  window.location.assign(destination);

                  return undefined;
                }

                setFailed(true);
                setBusy(false);

                return undefined;
              }
            );
          }}
          title="Sign out"
          type="button"
        >
          <LogOutIcon />
        </SidebarMenuAction>
        {failed ? (
          <Alert variant="destructive">
            <AlertDescription>
              Unable to sign out. Check your connection and try again.
            </AlertDescription>
          </Alert>
        ) : null}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
