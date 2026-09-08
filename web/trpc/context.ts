import type { AccessScope } from "@shared/identity/access-scope";

export interface TRPCContext {
  readonly requestHeaders: Headers;
  readonly scope: AccessScope;
}
