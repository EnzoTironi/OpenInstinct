# Versioned customer tools in Executor

Date: 2026-09-15. Status: bounded code tools implemented and integration-tested. Remote MCP/OpenAPI registration is described in [Customer connectors](adr-customer-connectors.md).

## Publication and use

A person or a bound group proposes `proposals/tools/<slug>.json` through the existing workspace repository. The app exposes proposals and published tools under Space → Tools. `workspace-save` can create proposals, and `describe.tool({path: "customer.tool.definition"})` exposes the owning manifest schema to Eve. Group messages do not gain management authority.

An authenticated owner or administrator validates the definition, runs its examples in QuickJS, then publishes `tools/<slug>.json`. Publication repeats validation and the tests; it atomically removes the proposal and records the author and operation receipt in Git/PostgreSQL. Direct writes to a published tool are rejected. Concurrent edits use the existing workspace-head comparison; retries return the original receipt.

Executor adds the current publication to its existing catalog. Its ID is `custom.<slug>.v<content digest>`; skills can pin that complete ID in `requires`. Disabling removes the current manifest. Rollback validates and restores historical content as a new Git commit, making its original content ID callable again. Old revisions are never callable merely because they remain in Git. A tool retained from an earlier discovery checks the current manifest and authorization before use and before returning the result.

## Execution boundary

Customer JavaScript runs only in the existing pinned QuickJS isolate. It receives a JSON input object and returns a schema-validated JSON object. There is no environment, host filesystem, network, credential broker, package loader or host execution fallback. CPU interrupts, memory/stack bounds, host-call limits, cancellation and a wall deadline apply. A separate four-slot customer computation limit prevents deadlock when all four outer Code Mode slots invoke customer computations.

A definition may declare existing workspace read dependencies. Every call is mediated by `invokeWorkspaceTool` with current workspace authorization and capability checks. Other customer tools, Google tools and native mutations cannot be nested inside this code. External bot grants do not inherit customer code execution from a file grant. Disabling the files capability removes customer tools from discovery.

Input/output JSON Schema uses a bounded subset: objects, arrays, strings, numbers, integers and booleans; no references, regexes or executable extensions. Objects require `additionalProperties: false`. Test examples use declared dependency fixtures. Passing these examples validates the definition; it does not establish a real provider action.

## Evidence and limits

`tests/runtime/customer-tools.integration.ts` exercises personal publication, repeat-safe publication, a skill pinned to the tool ID, four simultaneous nested Code Mode calls, another personal workspace, stale descriptors after disable, rollback, member proposals, direct-write rejection, bound-group use and membership removal. Malicious code attempts environment access, filesystem access, an infinite loop and an undeclared dependency. The existing repository and skill integration suites cover Git concurrency and permission boundaries.

A local browser proof uses a synthetic user in `companion_runtime_test`, not Google OAuth. Mobile UI transitions create, test, publish and disable a tool without another document request. It is not an end-to-end Eve reasoning or live-provider pass. Remote connector fixture proofs are recorded separately in [Customer connectors](adr-customer-connectors.md). A customer provider pilot and native agent evals remain separate acceptance gates.
