import { Effect, Schema } from "effect";
import { getAuthSession } from "@db/services/auth/session";
import {
  BillingCheckoutError,
  createCheckoutSession,
} from "../../../../server/billing/checkout";

const bodySchema = Schema.Struct({
  plan: Schema.Literals(["pro", "org"]),
  organizationId: Schema.optionalKey(Schema.String),
  seatCount: Schema.optionalKey(Schema.Number),
});

function checkoutErrorResponse(error: BillingCheckoutError) {
  const status =
    error.reason === "stripe_not_configured"
      ? 503
      : error.reason === "org_forbidden" || error.reason === "org_required"
        ? 403
        : 400;
  return Response.json(
    { error: error.message, reason: error.reason },
    { status }
  );
}

export async function POST(request: Request) {
  const session = await getAuthSession(request.headers);
  if (!session?.user) {
    return Response.json({ error: "Sign in to upgrade." }, { status: 401 });
  }

  const rawBody: unknown = await request.json().catch(() => null);
  return Effect.runPromise(
    Schema.decodeUnknownEffect(bodySchema)(rawBody ?? {}).pipe(
      Effect.mapError(
        () =>
          new BillingCheckoutError({
            reason: "invalid_plan",
            message: "Invalid checkout payload.",
          })
      ),
      Effect.flatMap((body) =>
        createCheckoutSession({
          userId: session.user.id,
          email: session.user.email,
          plan: body.plan,
          organizationId: body.organizationId,
          seatCount: body.seatCount,
        })
      ),
      Effect.map((result) => Response.json({ url: result.url })),
      Effect.catchTag("BillingCheckoutError", (error) =>
        Effect.succeed(checkoutErrorResponse(error))
      )
    ),
    { signal: request.signal }
  );
}
