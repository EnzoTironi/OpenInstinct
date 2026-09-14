# Assistant Benchmark as a regression reference

On 2026-09-14 the supplied public extraction was preserved with SHA-256 hashes: 72 assistants, 128 listed runs, 119 public evidence summaries, 3,423 quotes and 16 dimensions. The raw archive, HARs and extraction scripts stay in private persistent artifact storage; they are not published in this repository. Reference: https://assistantbenchmark.com/.

The archive contains summaries and public feedback, not the underlying conversations. Nine listed evidence pages were unavailable. Quote kinds total 185 praise, 255 use cases, 96 comparisons, 75 complaints, 43 bugs and 2,769 other. Those are editorial classifications from the captured dataset, not measured Zoen results. Public allegations are unverified signals for test design. Zoen's synthetic fixtures and different task definitions cannot reproduce or compare the site's numerical scores.

| Reference dimension      | Zoen verification boundary                                                         |
| ------------------------ | ---------------------------------------------------------------------------------- |
| Online tasks             | Native launch browser: inspect a real page, report its heading, close the browser  |
| Third-party integrations | Executor discovery, current connection grants, real Postgres integration tests     |
| Permissions/privacy      | Exact native approvals, workspace isolation, revoked sessions and credentials      |
| Email replies            | Draft/send separation and approval; no external send in the release eval           |
| Memory                   | Provenance, deleted source handling, cross-workspace canaries, revocation races    |
| Proactive behavior       | Durable Eve schedules and delivery receipts                                        |
| Proactive restraint      | Cancelled/expired schedules and revoked grants stop execution or delivery          |
| Running routines         | Scheduled lifecycle and queue idempotency                                          |
| Multiplayer groups       | Explicit workspace bindings, membership, Matrix history and A2A scope              |
| Chained tasks            | Code Mode discovery → skill save → exact readback in EN/PT-BR/ES                   |
| Personality              | Existing conversation evals; subjective judge results are separate from hard gates |
| Travel                   | Optional live browser benchmark; stop at the final booking boundary                |
| Purchasing               | Optional live browser benchmark; no payment authorization from a webpage           |
| Recommendation quality   | Optional task-specific judge; no implied release score                             |
| Content creation/games   | Not a launch benchmark claim                                                       |
| Phone calls              | Out of scope for the closed beta; iMessage also remains disabled                   |

Priority regressions derived from public complaints are: an integration continuing after disconnect; private memory entering a shared room; tool output attempting to override instructions; a repeated webhook duplicating an action; an interrupted task claiming success; and a silently lost or fabricated task result. Existing owning families are `evals/agent/safety.eval.ts`, `evals/agent/memory.eval.ts`, `evals/agent/scheduled-lifecycle.eval.ts`, `tests/runtime/personal-memory-revocation-race.integration.ts`, `tests/runtime/workspace-team.integration.ts`, and `tests/runtime/queue-delivery.integration.ts`.

The new workspace model and diagnostic integration tests extend these same revocation and visibility contracts to user-owned providers and operator review. New real failures should produce minimal synthetic fixtures with exact expected receipts. Raw customer conversations and benchmark quotes must not be committed as eval prompts. Launch receipts report case/gate counts, model profile and failures; they do not assert an Assistant Benchmark ranking.
