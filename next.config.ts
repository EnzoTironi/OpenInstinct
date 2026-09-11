import { openInstinctLowMemBuild } from "@shared/environment/env/low-mem-build";
import { Effect, Schema } from "effect";
import { withEve, type EveNextRewriteSections } from "eve/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = openInstinctLowMemBuild
  ? {
      // Fly Depot / constrained builders: cut Next+TS peak RSS (exit 137).
      // CI still runs types:check:app; ignoreBuildErrors is Docker-only.
      typescript: { ignoreBuildErrors: true },
      productionBrowserSourceMaps: false,
      enablePrerenderSourceMaps: false,
      experimental: {
        cpus: 1,
        webpackMemoryOptimizations: true,
        serverSourceMaps: false,
      },
    }
  : {};

const frameworkConfig = withEve(nextConfig);

const eveRoute = "/eve/v1/:path+";

class EveRoutingUnavailable extends Schema.TaggedError<EveRoutingUnavailable>()(
  "EveRoutingUnavailable",
  { message: Schema.String }
) {}

function toRewriteSections(
  rewrites: Awaited<ReturnType<NonNullable<NextConfig["rewrites"]>>>
): EveNextRewriteSections {
  if (Array.isArray(rewrites)) {
    return { beforeFiles: [], afterFiles: rewrites, fallback: [] };
  }

  return rewrites;
}

function isEveNativeRoute(route: {
  readonly source: string;
  readonly destination: string;
}) {
  return route.source === eveRoute && route.destination.endsWith(eveRoute);
}

function channelProxyRewrites(destination: string) {
  return ["telegram", "kapso"].map((channel) => ({
    source: `/api/channels/${channel}`,
    destination: `${destination}/channels/${channel}`,
  }));
}

function scheduledRunProxyRewrites(destination: string) {
  return ["report", "respond"].map((operation) => ({
    source: `/internal/scheduled-run/${operation}`,
    destination: `${destination}/internal/scheduled-run/${operation}`,
  }));
}

const resolveCompanionRewrites = Effect.fn("resolveCompanionRewrites")(
  function* (
    frameworkRewrites: NonNullable<NextConfig["rewrites"]> | undefined
  ) {
    if (!frameworkRewrites) {
      return yield* new EveRoutingUnavailable({
        message:
          "This deployment needs an Eve proxy before enabling channel webhooks.",
      });
    }

    const rewrites = yield* Effect.promise(() =>
      Promise.resolve(frameworkRewrites())
    );

    const sections = toRewriteSections(rewrites);
    const native = sections.beforeFiles?.find(isEveNativeRoute);

    if (!native) {
      return yield* new EveRoutingUnavailable({
        message:
          "Eve's generated route is missing or unsupported. Check the installed Eve routing configuration.",
      });
    }

    const destination = native.destination.slice(0, -eveRoute.length);

    return {
      ...sections,
      beforeFiles: [
        ...(sections.beforeFiles ?? []),
        ...channelProxyRewrites(destination),
        ...scheduledRunProxyRewrites(destination),
      ],
    };
  }
);

export default async function companionConfig(
  ...args: Parameters<typeof frameworkConfig>
) {
  const resolved = await Promise.resolve(frameworkConfig(...args));

  return {
    ...resolved,
    rewrites: () =>
      Effect.runPromise(resolveCompanionRewrites(resolved.rewrites)),
  };
}
