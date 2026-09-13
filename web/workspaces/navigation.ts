export function workspaceHref(href: string, workspaceId: string | null) {
  if (!workspaceId || !href.startsWith("/") || href.startsWith("//"))
    return href;
  const url = new URL(href, "https://zoen.invalid");
  if (!url.searchParams.has("space"))
    url.searchParams.set("space", workspaceId);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Resolved per request and per tab; never persisted in a shared cookie. */
export function browserWorkspaceHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const workspaceId = new URLSearchParams(window.location.search).get("space");
  return workspaceId ? { "x-zoen-workspace": workspaceId } : {};
}
