import { Effect } from "effect";
import type { BillingWebhookError } from "../../../../server/billing/webhook";
import { handleStripeWebhook } from "../../../../server/billing/webhook";

export const runtime = "nodejs";

function webhookErrorResponse(error: BillingWebhookError) {
  const status =
    error.reason === "invalid_signature"
      ? 400
      : error.reason === "stripe_not_configured"
        ? 503
        : 500;
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
