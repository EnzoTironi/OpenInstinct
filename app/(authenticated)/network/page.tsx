import { requireRequestScope } from "@web/auth/request-scope";
import { accessScopeForUser } from "@shared/identity/access-scope";
import { NetworkPanel } from "./network-panel";

export default async function NetworkPage() {
  const scope = await requireRequestScope();
  return (
    <NetworkPanel
      personal={
        scope.workspaceId === accessScopeForUser(scope.userId).workspaceId
      }
    />
  );
}
