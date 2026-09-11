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

export default function companionConfig(
  ...args: Parameters<typeof frameworkConfig>
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const resolved = yield* Effect.promise(() =>
        Promise.resolve(frameworkConfig(...args))
      );

      const frameworkRewrites = resolved.rewrites;

      return {
        ...resolved,
        rewrites: () =>
          Effect.runPromise(
            Effect.gen(function* () {
              if (!frameworkRewrites) {
                return yield* new EveRoutingUnavailable({
                  message:
                    "This deployment needs an Eve proxy before enabling channel webhooks.",
                });
              }

              const rewrites = yield* Effect.promise(() =>
                Promise.resolve(frameworkRewrites())
              );

              const sections: EveNextRewriteSections = Array.isArray(rewrites)
                ? { beforeFiles: [], afterFiles: rewrites, fallback: [] }
                : rewrites;

              const native = sections.beforeFiles?.find(
                (route) => route.source === eveRoute
              );

              if (!native?.destination.endsWith(eveRoute)) {
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
                  ...["telegram", "kapso"].map((channel) => ({
                    source: `/api/channels/${channel}`,
                    destination: `${destination}/channels/${channel}`,
                  })),
                  ...["report", "respond"].map((operation) => ({
                    source: `/internal/scheduled-run/${operation}`,
                    destination: `${destination}/internal/scheduled-run/${operation}`,
                  })),
                ],
              };
            })
          ),
      };
    })
  );
}
