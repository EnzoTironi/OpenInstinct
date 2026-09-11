export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");

  if (!origin) return true;

  const parsedOrigin = parseOriginHeader(origin);

  if (!parsedOrigin) return false;

  const requestUrl = new URL(request.url);
  const allowedOrigins = collectAllowedOrigins(request, requestUrl);

  return allowedOrigins.has(parsedOrigin.origin);
}

function parseOriginHeader(origin: string) {
  try {
    return new URL(origin);
  } catch {
    return null;
  }
}

function collectAllowedOrigins(request: Request, requestUrl: URL) {
  const allowedOrigins = new Set([requestUrl.origin]);

  const protocol =
    firstForwardedValue(request.headers.get("x-forwarded-proto")) ??
    requestUrl.protocol;

  addForwardedHostOrigin(
    allowedOrigins,
    protocol,
    request.headers.get("x-forwarded-host")
  );
  addForwardedHostOrigin(allowedOrigins, protocol, request.headers.get("host"));

  return allowedOrigins;
}

function addForwardedHostOrigin(
  allowedOrigins: Set<string>,
  protocol: string,
  value: string | null
) {
  const host = firstForwardedValue(value);

  if (!host) return;

  try {
    allowedOrigins.add(
      new URL(`${normalizeProtocol(protocol)}//${host}`).origin
    );
  } catch {
    return;
  }
}

function firstForwardedValue(value: string | null) {
  const first = value?.split(",", 1)[0]?.trim();

  return first?.length ? first : undefined;
}

function normalizeProtocol(protocol: string) {
  return protocol.endsWith(":") ? protocol : `${protocol}:`;
}
