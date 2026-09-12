/** Current production host for Zoen marketing. Visual refs are not hosts. */
export const companionPublicHost = "zoen.tironi.xyz";
export const companionPublicOrigin = "https://zoen.tironi.xyz";

export function companionCanonicalPath(path: `/${string}`): string {
  return `${companionPublicOrigin}${path}`;
}
