# Native parallel work: September 9 qualification

This increment uses Eve 0.49.0 native Tasks, the installed PostgreSQL Workflow
world, the existing authenticated Codex Spark provider and the application's real
composition. It does not add a scheduler or a second conversation engine.

## Implemented boundaries

Generic workers retain native task and child-session identifiers. Only the root
can deliver a user message, reaction or parent approval response. Required worker
choices use the native `request-input` execution mode; the live bounded question
schema is validated before publishing an input request, including after reload.
The shared sandbox is acquired lazily from the originating native context, so two
workers do not create competing containers and an ordinary greeting does not
allocate one.

The package patch exposes `ctx.session.taskReport?.cohortId` only during a settled
root task-delivery turn. The application derives a delivery identifier from that
native cohort and session. Web delivery records the claim through public Eve
state; repeated attempts return a receipt rather than another message. The web
projection also deduplicates explicit delivery identifiers across replay. Ordinary
messages retain their existing behavior.

Private-channel delivery uses the same derived identifier in both the message
tool and completion fallback. An identity-scoped transaction preserves the first
outbox payload and its receipts when subsequent wording differs. It revalidates
identity and membership before returning an existing receipt. Provider I/O stays
outside that transaction. This is application outbox evidence, not a claim of
exactly-once delivery by an external messenger.

Eve marks native task-origin `message.received` events with `source: "task"`.
Ordinary inputs cannot supply this provenance. The conversational view hides
recognized native envelopes without depending on an earlier receipt that may be
outside the loaded history page. Identical text written by the user stays visible;
an update quoting a completion does not mark its own task finished.

## Observed execution

A real authenticated session started two generic workers, alpha and beta. Both
published distinct pending questions. While they waited, the root answered a
separate arithmetic question without restarting or cancelling either worker. A
subsequent request cancelled alpha alone; beta remained parked on its original
question.

The Eve process was stopped with SIGTERM and a new process started against the
same PostgreSQL database. Answering beta's original request resumed the original
child, resolved its input and completed it. The child did not call the delivery
tool. The root attempted three sends for the settled cohort: one produced a
message, two returned the same delivery receipt. A later ordinary question
received its answer without a task delivery identifier or another worker launch.

The production Next.js interface loaded this persisted, paginated history using
a real authenticated browser session. Desktop and mobile checks confirmed one
visible report before and after reload, hidden native control envelopes and
receipts, no horizontal overflow and no JavaScript errors. The first browser run
exposed the missing-receipt pagination bug; its failure was retained before the
correction and rerun. Independent review covered the application delivery and
projection boundaries.

## Limits and remaining gates

The initial launch also contained an unnecessary model attempt to resume an
already busy worker. Eve rejected it with `AGENT_BUSY`; the broad launch oracle
failed and that evidence remains retained. The subsequent cancellation/restart
scenario is a qualified subset, not a clean pass for the entire model journey.
The rendered wording also used internal status vocabulary; instructions were
corrected, but this does not establish a general language-quality guarantee.

The restart above is a graceful process restart. It does not qualify prompt
automatic recovery after SIGKILL. The installed Graphile Worker lock expiry is
four hours; its cleanup polling adds further delay. Manual unlocking of a proven
dead worker is assisted recovery and must not be presented as automatic recovery.
There is no fabricated timestamp, lock or provider response in this evidence.

Private-channel external delivery, groups, correction races, arbitrary crash
windows between completion and delivery, and the interrupted application-to-Eve
acceptance handoff require their own evidence. These results do not complete all
release gates in the [blueprint](companion-blueprint.md).
