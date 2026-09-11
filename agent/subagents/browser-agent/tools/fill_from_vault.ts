import { requireWorkerScope } from "@agent/subagents/browser-agent/lib/access";
import { getKernel } from "@agent/subagents/browser-agent/lib/kernel";
import { requireOwnedBrowserSession } from "@agent/subagents/browser-agent/lib/owned-browser";
import { readVaultItem } from "@db/services/vault";
import { Match } from "effect";
import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  currentKernelPageOrigin,
  fillWithKernelNativeAutofill,
  nativeAutofillTokens,
} from "../lib/autofill/native";
import { vaultAutofillProvider } from "../lib/autofill/provider";
import { materializeAutofillClaims } from "../lib/autofill/service";

const inputSchema = z.object({
  browserSessionId: z.string().trim().min(1).max(500),
  candidateId: z.string().trim().min(1).max(500),
});

const outputSchema = z.object({
  filledClaims: z.number().int().nonnegative(),
  kind: z.enum(["address", "contact", "login", "payment"]),
  origin: z.string(),
  success: z.literal(true),
});

export default defineTool({
  description:
    "Fill a login, card, contact, traveler, or address form with an opaque handle returned by list_vault. Focus one control in the intended form first. Never supply vault fields, selectors, origins, or secret values.",
  inputSchema,
  outputSchema,
  async execute(input, context) {
    const scope = await requireWorkerScope(context);

    await requireOwnedBrowserSession(scope, input.browserSessionId);
    const item = await readVaultItem(scope, input.candidateId);

    if (!item) throw new Error("The selected vault item was not found.");

    if (
      item.kind !== "address" &&
      item.kind !== "contact" &&
      item.kind !== "login" &&
      item.kind !== "payment"
    ) {
      throw new Error(
        "Native browser autofill currently supports only logins, cards, contacts, and addresses."
      );
    }

    if (item.kind === "login") {
      const browser = await getKernel().browsers.retrieve(
        input.browserSessionId,
        {},
        { signal: context.abortSignal }
      );

      if (!browser.profile_save_changes) {
        throw new Error(
          "Login autofill requires a browser created with save_changes: true. Delete this browser, create a writable browser at the same URL, then focus and fill again."
        );
      }
    }

    const origin = await currentKernelPageOrigin({
      browserSessionId: input.browserSessionId,
      signal: context.abortSignal,
    });

    const surfaceKind = Match.value(item.kind).pipe(
      Match.when("payment", () => "payment-card" as const),
      Match.when("login", () => "credentials" as const),
      Match.when("contact", () => "contact" as const),
      Match.orElse(() => "postal-address" as const)
    );

    const tokens = nativeAutofillTokens[item.kind];

    const surface = {
      fields: tokens.map((token) => ({ score: 100, token })),
      id: surfaceKind,
      kind: surfaceKind,
    };

    const claims = await materializeAutofillClaims(
      scope,
      input.candidateId,
      {
        availableTokens: new Set(tokens),
        origin,
        surface,
      },
      vaultAutofillProvider
    );

    const result = await fillWithKernelNativeAutofill({
      browserSessionId: input.browserSessionId,
      claims,
      expectedOrigin: origin,
      kind: item.kind,
      signal: context.abortSignal,
    });

    return {
      filledClaims: result.filledClaims,
      kind: item.kind,
      origin: result.origin,
      success: true as const,
    };
  },
});
