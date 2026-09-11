# Repository-owned Oxlint rules

The `next` plugin is a local adaptation of the Next.js architecture rules from the Merit Systems Foundation repository at commit `712131d17f4089097c4636e0dc924be1a108cb96`.

It is kept local because this public repository cannot depend on Foundation's internal packages. The adaptation supports both root-level `app/` and `src/app/` Next.js projects. Rule activation belongs in the root Oxlint config (`oxlint.config.ts`).

The `architecture` plugin enforces the repository's production dependency direction across `agent`, `app`, `db`, `shared`, and `web`. Root `proxy.ts` is treated as web-owned. Violations are reported on static imports and exports, dynamic imports, and Vitest or Jest module mocks.

The `anti-slop` plugin vendors the generic rules, shared helpers, Effect plugin, and vendor assets from [`dmmulroy/anti-slop`](https://github.com/dmmulroy/anti-slop) at commit `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`. Its MIT license is included in the plugin folder. Upstream colocated rule tests ship under `rules/` and `effect/rules/`. Refresh those whenever the vendored source is updated.
