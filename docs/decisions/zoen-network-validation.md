# Trusted-network conversations: validation

Updated 2026-09-15. This is isolated qualification, not a production deployment.

## Implemented behavior

Connections links to a personal or company network. A person invites another
username; acceptance enables contact with that person's published bot. Company
access follows current organization and source-project membership. Neither path
opens the destination's files, private memory, customer tools or vault.

Both the interface and Executor send through a private Synapse room. The verified
application-service event creates one durable A2A task; native Eve runs the target
bot and publishes its response using that bot's Matrix identity. The caller can
read the response or a bounded pending receipt. Code Mode cannot bypass native
approval. The receiving bot cannot recursively contact another bot with this grant.

A follow-up receives bounded, quoted context from earlier events in the same room.
Blocking a peer, unpublishing a bot, removing source-project membership or closing
a conversation denies further access. Durable cancellation and room-retirement
outboxes survive application-row cascades and retry external cleanup.

## Evidence collected

- `pnpm check`: 1,445 application tests passed, three pre-existing skips; type,
  lint, formatting and unused-code checks passed after the conversation changes.
- `pnpm build`: production Next and Eve build passed.
- Seventeen focused PostgreSQL/Synapse tests passed, including event replay,
  source/destination identity, same-room context, Code Mode approval, nontransitive
  trust, private-file denial, project removal, cancellation and late output.
- Native Eve with `codex/gpt-5.6-luna`, low reasoning: an initial successful batch
  executed six target sessions across three runs. Subsequent validation added a
  stricter check that the answer actually reaches the source web conversation.
  Provider `service_unavailable_error` failures are retained as failures; they are
  not silently retried into the same success count.
- Two independent authenticated browser contexts completed invite, accept, human
  conversation and a follow-up about the preceding question. The target returned
  its random public code and remembered the previous question. Mobile and desktop
  screenshots were inspected. Each context loaded exactly one document; zero
  JavaScript errors. The original sky/sheet presentation is retained.

Local artifact directory:
`/Users/enzotironi/Documents/Codex/Artifacts/zoen/reviews/2026-09-14-pr-113-121/network-matrix-ui/final/`.
`result.json` records navigation/error counts; `03-answer-mobile.png`,
`04-followup-mobile.png` and `05-answer-desktop.png` show the conversation.
No production account, credential, provider message or screenshot is in this proof.

## Reproduce

Run isolated PostgreSQL and the configured Synapse service. Build and start the app
on ports whose Eve callback agrees with the appservice configuration. Then run:

```sh
pnpm test:runtime tests/runtime/matrix-network.integration.ts tests/runtime/matrix-rooms.integration.ts tests/runtime/workspace-network.integration.ts tests/runtime/workspace-boundaries.integration.ts
pnpm eval:agent --url http://127.0.0.1:4367 --suite launch/network --network-scope personal --repeat 3 --timeout 360000
pnpm eval:agent --url http://127.0.0.1:4367 --suite launch/network --network-scope company --repeat 3 --timeout 360000
```

The runner creates and deletes synthetic users, projects and trust edges. It never
supplies a bot response. Each run stores a sanitized `run-N.json` plus
`run-N-matrix.json` with actual Matrix event IDs, distinct identities, native
session IDs and terminal telemetry counts. A `liveDeliveries: 0` in the generic
receipt means no external Telegram/WhatsApp pilot delivery; the Matrix receipt
identifies the real isolated Synapse deliveries explicitly.

The native-eval workflow now provisions Synapse too. The complete launch suite
runs in company scope and the additional network suite runs in personal scope.

## Remaining boundaries

Production activation and a qualified deployed SHA are still pending. E2EE,
federation, native recursive multi-bot chains, vault delegation and WhatsApp
bridging are not proved by these tests. Removing access cannot recall content a
recipient already received. Room membership retirement is not full homeserver
history erasure; that belongs to the account-erasure provider work.

The structural review reports two deliberate exceptions: the generated migration
journal grows when migrations are appended, and the new network conversation
shares a presentation shape with the existing room conversation. They retain
separate RPC/state lifecycles and authorization semantics; both reuse the existing
UI primitives and room stylesheet. No blanket quality acknowledgment was added.
