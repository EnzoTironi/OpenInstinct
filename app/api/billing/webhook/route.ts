import { Effect, Match } from "effect";

import type { BillingWebhookError } from "../../../../server/billing/webhook";
import { handleStripeWebhook } from "../../../../server/billing/webhook";

export const runtime = "nodejs";

function webhookErrorResponse(error: BillingWebhookError) {
  const status = Match.value(error.reason).pipe(
    Match.when("invalid_signature", () => 400),
    Match.when("stripe_not_configured", () => 503),
    Match.orElse(() => 500)
  );

  return Response.json({ error: error.message }, { status });
}

export async function POST(request: Request) {
  return Effect.runPromise(
    handleStripeWebhook(request).pipe(
      Effect.map((result) => Response.json(result)),
      Effect.catchTag("BillingWebhookError", (error) =>
        Effect.succeed(webhookErrorResponse(error))
      )
    ),
    { signal: request.signal }
  );
}
