import { getAuthSession } from "@db/services/auth/session";
import { Effect, Schema, Match } from "effect";

import {
  BillingPortalError,
  createCustomerPortalSession,
} from "../../../../server/billing/portal";

const bodySchema = Schema.Struct({
  organizationId: Schema.optionalKey(Schema.String),
});

function portalErrorResponse(error: BillingPortalError) {
  const status = Match.value(error.reason).pipe(
    Match.when("stripe_not_configured", () => 503),
    Match.when("no_customer", () => 404),
    Match.orElse(() => 400)
  );

  return Response.json(
    { error: error.message, reason: error.reason },
    { status }
  );
}

export async function POST(request: Request) {
  const session = await getAuthSession(request.headers);

  if (!session?.user) {
    return Response.json(
      { error: "Sign in to manage billing." },
      { status: 401 }
    );
  }

  const rawBody: unknown = await request.json().catch(() => ({}));

  return Effect.runPromise(
    Schema.decodeUnknownEffect(bodySchema)(rawBody).pipe(
      Effect.mapError(
        () =>
          new BillingPortalError({
            reason: "stripe_failed",
            message: "Invalid portal payload.",
          })
      ),
      Effect.flatMap((body) =>
        createCustomerPortalSession({
          userId: session.user.id,
          organizationId: body.organizationId,
        })
      ),
      Effect.map((result) => Response.json({ url: result.url })),
      Effect.catchTag("BillingPortalError", (error) =>
        Effect.succeed(portalErrorResponse(error))
      )
    ),
    { signal: request.signal }
  );
}
