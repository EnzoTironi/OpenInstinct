# Sim versus Treg and n8n

Recommendation: keep Companion/Eve as the execution foundation. Search its
registry first, selectively adapt missing Sim capabilities, and connect existing
Sim/n8n workflows through bounded adapters. Treg is an interesting API catalog
and routing reference, but its current license is a material obstacle to embedding
it in a service offered to third parties. This is an architectural recommendation,
not vendor selection or permission to install or redistribute code.

| Candidate       | Useful asset                                                                                    | Fit and cost                                                                               | Recommendation                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Sim             | Broad TypeScript tool registry, provider operations, knowledge connectors, workflow integration | Closest language fit; imports depend on Sim's execution, OAuth, secrets and file contracts | Reuse selected capability implementations after dependency/license review; keep the existing Companion authority           |
| Treg            | Provider/endpoint catalog, capability taxonomy, routing and verification metadata               | API discovery is useful; not a personal-assistant routine runtime or universal OAuth layer | Use as a research index; evaluate an authorized hosted service separately or obtain permission before restricted embedding |
| n8n             | Broad application nodes, triggers, existing workflow ecosystem                                  | Nodes depend on the n8n runtime; source includes control flow, AI nodes and versions       | Prefer interoperability with a user's existing instance; don't transplant its runtime into Eve                             |
| Poke/Town/Lindy | Installation flows, routine patterns, controls and outcomes                                     | Public descriptions reveal behavior, not hidden code or reliability                        | Independently implement useful behavior with our own copy and verification                                                 |

## Why Sim is promising but not drop-in

The pinned [Gmail send implementation](https://github.com/simstudioai/sim/blob/4dbf0a0db689373faf52f760bc971c81c6b38c67/apps/sim/tools/gmail/send.ts)
declares hidden credentials, OAuth metadata and an internal operation contract;
it does not provide a standalone Gmail client just by exporting the tool.
Its v1 and v2 exports also explain why registered tool counts exceed distinct
actions. [Shared tool types](https://github.com/simstudioai/sim/blob/4dbf0a0db689373faf52f760bc971c81c6b38c67/apps/sim/tools/types.ts)
reference executor context, secret provenance, OAuth and response conventions.
Porting requires following the actual operation implementation, then adapting the
necessary behavior at Companion's boundary. Do not import the entire registry.

Before a port, inspect transitive imports, auth scopes and token refresh, paging,
rate limits, file handling, response validation, retries and ambiguous writes.
Use Effect's installed APIs rather than keeping a second application execution
model. Qualify one read capability before a scoped write with real evidence.

## License evidence, pinned to this snapshot

- Sim's root [LICENSE](https://github.com/simstudioai/sim/blob/4dbf0a0db689373faf52f760bc971c81c6b38c67/LICENSE)
  is Apache-2.0; preserve required attribution and review its
  [NOTICE](https://github.com/simstudioai/sim/blob/4dbf0a0db689373faf52f760bc971c81c6b38c67/NOTICE).
  The [enterprise subtree](https://github.com/simstudioai/sim/blob/4dbf0a0db689373faf52f760bc971c81c6b38c67/apps/sim/ee/LICENSE)
  has separate restrictive terms. Root licensing does not clear every dependency,
  provider's API terms, trademark, or enterprise file for reuse.
- Treg's [LICENSE](https://github.com/superdesigndev/treg/blob/7bc16c08196aec7c3a668b5e1b13b70905d989fb/LICENSE)
  includes additional terms overriding Apache-2.0 where they conflict. It allows
  internal organizational commercial use but requires prior written authorization
  for specified hosted, managed or embedded offerings to third parties and
  commercially distributed products. Do not describe it as unrestricted Apache.
  Consuming a hosted API has a separate service-terms assessment, not resolved here.
- n8n's root [LICENSE.md](https://github.com/n8n-io/n8n/blob/4b36c51940cd9cba882ff71947822c1428325497/LICENSE.md)
  uses Sustainable Use terms with internal-business/noncommercial restrictions;
  enterprise files and some components may have other licenses. Check the exact
  component and proposed distribution. A source listing is not permission to
  offer n8n as Companion's embedded workflow service.

This package stores factual discovery metadata and links, not copied vendor
implementations, example provider responses, credentials, or a vendor source fork.
Before shipping reused code, assess the actual files and intended use against
the current license. No legal clearance is asserted by this document.
