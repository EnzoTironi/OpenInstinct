# Customer MCP and OpenAPI connectors

Date: 2026-09-15. Status: implemented; local provider-fixture validation. A customer provider pilot and native Eve reasoning evaluation remain launch gates.

## One catalog and explicit authority

An authenticated workspace owner or administrator connects a public HTTPS service in Space → Tools. MCP uses the pinned MCP SDK's Streamable HTTP transport; OpenAPI imports a supplied JSON document. Connections also appear on the Connections screen. Eve can discover authorized connection IDs, revisions and operation schemas through `workspace.tools.connections` in the existing Executor catalog. A service definition cannot request a second agent loop or grant permissions.

The person chooses owner-only access or sharing with the workspace's members and bound groups. Owner-only credentials are unavailable in a group, including a group message from the owner. External bot file grants never imply connector access. Tokens are encrypted with an authenticated envelope tied to this feature, workspace, connection and revision. The database owns credentials, grants and operation receipts; Git contains only the published manifest, schemas and opaque references. Password inputs and test results are excluded from session replay. Known credential echoes in provider metadata/output are redacted before storage or return.

A member or group may propose a tool and skill in Git. An authenticated administrator publishes them. The manifest pins the connection revision and operation schemas. Imported remote tools always require a native Eve approval, regardless of names, descriptions, read-only hints, HTTP method or provider annotations. Code Mode discovers/describes them and returns `call_required`; the approved action runs through the same Executor entrypoint. Remote actions cannot be hidden inside customer JavaScript.

The connector owner must remain a member of both the workspace and, for work spaces, its organization. Database foreign keys erase the connection and its receipts when either membership is removed. Rejoining does not resurrect credentials. Account/workspace deletion and replay of the erasure journal use the same ownership cascades.

## Delivery and revocation

Every native action uses its Eve session/call identity as a durable invocation key. An atomic claim is committed before network dispatch. Repeated requests return the validated original result; changed arguments conflict. An interrupted or uncertain claim never sends again. The model receives an explicit uncertain-outcome message and must ask the user to verify the provider before authorizing another action. The app's test button also retains its invocation key while retrying the same reviewed arguments.

Workspace authority, publication and connection revision are checked at use. MCP rechecks authorization after its initialization handshake and before the tool call. Output is checked and committed under membership/connection locks. Revocation clears cached results. It cannot undo an action already sent to a third-party service; such a result is withheld and marked uncertain. The SDK does not receive an OAuth provider or retry permission. Eight remote actions may run per process, with a 35-second total deadline including queue time; the underlying network and MCP lifetimes are also bounded and cancelled.

## Egress

The transport accepts public HTTPS on port 443, rejects credentials in URLs, pins a validated DNS address to the TLS request, and keeps the original host for certificate validation. Every DNS answer must be public. It rejects private/metadata/reserved addresses, redirects and compressed responses. It uses no ambient proxy or cookies. Requests are limited to 64 KiB and response streams to 512 KiB; JSON outputs have the customer schema owner's smaller 64 KiB limit. MCP requests remain on the approved endpoint and expose no sampling, roots or elicitation capability. Resource links and media are never dereferenced implicitly.

The implementation targets the installed SDK's 2025 Streamable HTTP protocol, including JSON and SSE responses. It does not claim the separate 2026 protocol revision. See the [MCP 2025 transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

## Supported import subset

- MCP: Streamable HTTP with an optional owner-supplied bearer token; at most 100 operations over five dependent catalog pages. Structured output is validated; tools without a declared output schema return bounded serialized content.
- OpenAPI: JSON 3.0/3.1, explicit HTTPS base endpoint, GET/POST/PUT/PATCH/DELETE, scalar path/query parameters, optional JSON object body, and JSON object responses declared as 200/201. Server overrides, ambient header/cookie parameters, remote references, multipart/binary and non-JSON responses are not imported.
- Both reuse the customer JSON Schema owner: bounded objects/arrays/scalars, no references, regexes or executable extensions, and explicit `additionalProperties: false` on objects.
- Generic OAuth discovery/refresh and provider-specific credential exchange are not part of this connector import path. Existing first-party Google/model connections retain their dedicated flows.

Validation verifies the pinned definition and connection without causing a remote write. Code examples still run in QuickJS. A remote service test is a separate, explicitly labeled action with real arguments; validating a remote definition is not presented as a successful live-provider test.

## Evidence

`tests/runtime/customer-connectors.integration.ts` uses isolated PostgreSQL, real Git publication, QuickJS discovery, native Executor dispatch and an actual local HTTP provider fixture. It covers MCP JSON/SSE, OpenAPI writes, lost responses, concurrent delivery, changed arguments, stale descriptors, revocation during a handshake/response, owner-only versus workspace/group access, encrypted credentials, cross-envelope rejection, and donor removal/rejoin. Group proposals and their pinned skills use the existing publication boundary.

`server/connectors/public-fetch.test.ts` maps Node's HTTPS socket boundary to a local HTTP fixture and verifies the selected public IP, original TLS identity, private/mixed DNS rejection, redirect rejection, stream limits and cancellation. This is an isolated adapter proof, not a live TLS/DNS-rebinding attack against the production network. `openapi.test.ts` and `credentials.test.ts` cover malformed contracts and credential echoes. Native model behavior, a real customer provider and deployed operational limits remain separate acceptance gates; these tests must not be labeled a live customer qualification.

The production Next.js build was exercised in mobile Chromium (390 × 844), with an isolated synthetic account: import a connection, select an operation, save the Git proposal, validate the definition, publish, revoke and close the sheet. The journey made one document request, with no JavaScript errors. It caught and fixed a form button that did not submit. The UI check did not contact an external provider; HTTP execution is covered by the separate integration fixture above.

The structural review retains the streaming transport lifecycle in one function and the protocol fixture in one test server. Their size reflects cancellation, bounded streaming and protocol handling; splitting them solely for a metric would obscure resource ownership. Generated Drizzle snapshots and the two short server teardown callbacks are deliberate structural duplication. React components reported as unused by the call-graph scanner are rendered by their route owners and checked by Knip and the browser journey.
