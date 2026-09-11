import { ensureScope } from "@db/services/scope";
import { claimSession } from "@db/services/sessions";
import { defineHook } from "eve/hooks";

import { scopeFromPrincipal } from "../../../../shared/identity/principal-scope";

export default defineHook({
  events: {
    async "session.started"(_event, ctx) {
      const initiator = ctx.session.auth.initiator;

      if (!initiator) return;

      const scope = scopeFromPrincipal(initiator);
      await ensureScope(scope);
      await claimSession(scope, ctx.session.id);
    },
  },
});
