# Catalog coverage and refresh procedure

Added reference: [Pally](pally.md). All 51 gallery detail pages were read; 44 typed connection, channel, device, infrastructure and MCP entries were added. The separate Pally source index contains 92 guide/comparison URLs, not 92 audited articles. Public OAuth discovery was read; authenticated operations were not tested. The advertised entry-points JSON was inaccessible. Recipe inventory total: 171; public integration/surface inventory total: 1,566.

Added reference: [Flip](flip.md). Six declared provider/channel entries and eight descriptive recipe patterns were added from its public pages. There is no complete public integration registry in the inspected sources; payment claims differ between the homepage and articles and remain unresolved.

Snapshot date: 2026-09-08. “Full” is bounded to the explicit public surface below. This is not an exhaustive catalog of every competitor in the market, authenticated marketplace, community server, private workflow or runtime operation.

| Source | Captured scope | Limit |
| --- | --- | --- |
| Sim | All 5,475 explicit entries in the pinned tool registry; 290 import families; 65 knowledge connectors | Includes versions/internal tools/utilities; excludes unregistered code and implicit tools; not live tested |
| Treg | 3,185 unique endpoint IDs across 66 providers in all provider YAML catalogs, including extended catalogs | Not 3,185 verified integrations; aliases/adapters/contracts/pricing metadata are not endpoint rows |
| n8n | All 694 `.node.ts` paths in `packages/nodes-base/nodes` and `packages/@n8n/nodes-langchain/nodes`; 327 immediate source families | Includes versions, utility nodes and broad AI categories; excludes community packages and operation-level enumeration |
| Poke | All four pages of the public Integrate category: 43 entries | Mixes provider connections and recipes; private/community MCP servers not enumerable |
| Town | All 59 entries on its public integration directory | Includes two “coming soon” entries and channels/device surfaces; no action-level registry |
| Lindy | 1,407 named entries across all 15 pages linked by the public integrations directory | Public names/variants, not authenticated enabled actions; some page renders include a promotional card and expose 99 names rather than 100 |
| Instinct | Seven Workspace products explicitly named in its privacy policy | No complete public connector/recipe catalog was found; device access is not evidence of a native API integration |

Public directory sources: [Poke](https://poke.com/recipes?category=integrate), [Town](https://www.town.com/integrations), [Lindy](https://www.lindy.ai/integrations), [Instinct](https://instinct.com/privacy-policy). Repository revisions and file counts are in [sources.json](sources.json).

The separate recipe inventory captures all 73 entries across Poke's seven-page All gallery, including connection recipes; 23 Town stock routines plus one explicitly retired routine; and 15 Lindy routines/templates. Poke's All gallery also includes Parallel Web Systems, which was absent from the Integrate filter snapshot. Treat the gallery and filtered directory as different surfaces. Lindy's wider use-case library, Sim template gallery and n8n community workflows are not exhaustively inventoried here. Instinct does not expose a complete public recipe catalog in the inspected sources.

## Extraction method

GitHub recursive trees were retrieved with `truncated: false`. Sim registry entries were parsed across wrapped lines and imports resolved including `as` aliases. Comments were removed before checking that no registry syntax remained unparsed. Tool IDs retain versions; provider-family counts do not deduplicate products across naming variants. Knowledge connectors use their separate registry.

Treg's 95 catalog YAML files were fetched at the pinned revision. Files with a top-level `provider` yielded endpoint IDs; both curated and extended files are represented. Non-provider metadata files were excluded. IDs were checked for uniqueness. Vendor `verified` fields and example responses were deliberately not promoted to our live evidence. n8n inventory uses path suffix and two explicit source roots; counts are source counts, not deployed node counts.

Poke, Town and Lindy were enumerated through public browser pagination. These directories were accessible in the browser even where direct HTTP retrieval failed. No sign-in, private account access, installation or provider execution was needed. Entries retain page-level provenance when a detail URL is unavailable.

To refresh, fetch each repository's new revision and complete tree, repeat the same extraction, compare added/removed IDs, recheck license files and update `sources.json`. For public sites, traverse every visible page until no next page remains; inspect loading states before extracting labels. Verify row counts, duplicates and URL provenance. Do not silently merge source variants into one provider. Build a reviewed alias map only when a real consumer needs it.

## Evidence boundaries

Listed → exact action inspected → account connected → authorized call exercised → outcome independently observed are different stages. These inventories prove only the first stage, with a small implementation inspection for Sim's reuse assessment. Unavailable services block their integration profile; synthetic data may exercise pure transformations but cannot establish provider behavior.
