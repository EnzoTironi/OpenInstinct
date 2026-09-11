import { getAuthSession } from "@db/services/auth/session";
import { Effect, Schema } from "effect";

import {
  BillingCheckoutError,
  createCheckoutSession,
} from "../../../../server/billing/checkout";

const bodySchema = Schema.Struct({
  plan: Schema.Literals(["pro", "org"]),
  organizationId: Schema.optionalKey(Schema.String),
  seatCount: Schema.optionalKey(Schema.Number),
});

const decodeBodySchema = Schema.decodeUnknownEffect(bodySchema);

function checkoutErrorStatus(reason: BillingCheckoutError["reason"]): number {
  if (reason === "stripe_not_configured") {
    return 503;
  }

  if (reason === "org_forbidden" || reason === "org_required") {
    return 403;
  }

  return 400;
}

function checkoutErrorResponse(error: BillingCheckoutError) {
  return Response.json(
    { error: error.message, reason: error.reason },
    { status: checkoutErrorStatus(error.reason) }
  );
}

function invalidCheckoutPayloadError() {
  return new BillingCheckoutError({
    reason: "invalid_plan",
    message: "Invalid checkout payload.",
  });
}

function mapCheckoutBody(
  body: typeof bodySchema.Type,
  sessionUser: {
    readonly id: string;
    readonly email: string;
  }
) {
  return createCheckoutSession({
    userId: sessionUser.id,
    email: sessionUser.email,
    plan: body.plan,
    organizationId: body.organizationId,
    seatCount: body.seatCount,
  });
}

function checkoutSuccessResponse(result: { readonly url: string }) {
  return Response.json({ url: result.url });
}

function catchCheckoutError(error: BillingCheckoutError) {
  return Effect.succeed(checkoutErrorResponse(error));
}

export async function POST(request: Request) {
  const session = await getAuthSession(request.headers);

  if (!session?.user) {
    return Response.json({ error: "Sign in to upgrade." }, { status: 401 });
  }

  const rawBody: unknown = await request.json().catch(nullBody);
  const user = session.user;

  return Effect.runPromise(
    decodeBodySchema(rawBody ?? {}).pipe(
      Effect.mapError(invalidCheckoutPayloadError),
      Effect.flatMap((body) => mapCheckoutBody(body, user)),
      Effect.map(checkoutSuccessResponse),
      Effect.catchTag("BillingCheckoutError", catchCheckoutError)
    ),
    { signal: request.signal }
  );
}

function nullBody() {
  return null;
}
