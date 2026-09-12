/** Public production host for Companion marketing. Visual refs are not hosts. */
export const companionPublicHost = "companion.tironi.xyz";
export const companionPublicOrigin = "https://companion.tironi.xyz";

export function companionCanonicalPath(path: `/${string}`): string {
  return `${companionPublicOrigin}${path}`;
}
