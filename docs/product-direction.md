# Product direction: the final lens

2026-09-08. A product review inspired by Steve Jobs's emphasis on focus and an
integrated experience. This is our interpretation, not a quotation or a claim
about what he would have decided. Proposed product direction; not shipped behavior.

## One promise

**Send it something you need handled. Trust it to follow through.**

The user should feel less responsible for supervising software. They describe
an outcome, contribute a missing detail when necessary, authorize what needs their
decision, and receive a useful result. The product remembers enough to make the
next interaction easier. It stays quiet when it has nothing useful to add.

WhatsApp and Telegram are the front door. The same assistant works through both.
Effect, Eve, Kernel, MCP and ontology are implementation choices supporting that
promise. They should not become the onboarding curriculum.

## The critique of our plan

The architecture is thoughtful, but a list of fifteen implementation packages
cannot carry the product story. We risk making users configure an agent platform
before they experience an assistant. We also risk treating voice, memory, browser
work and integrations as disconnected demonstrations.

Focus requires choosing what receives launch-quality attention. Keep the ambitious
architecture, but make the first complete experience unmistakable. Generality
belongs in the shared runtime; it does not require a menu of every capability on
day one. Personal and professional scenarios stay in evals, never separate handlers.

## Design the whole interaction

An illustrative acceptance scenario, not a specialized calendar product:

1. The user sends a voice note: “Find an hour next week for focused work. Mornings
   are best, and remind me ten minutes before.”
2. The assistant acknowledges the actual request. If Calendar is disconnected,
   it explains the immediate benefit and provides one secure connection link.
   It does not request unrelated Gmail or contacts access.
3. Consent completes and the conversation resumes automatically. The user should
   not have to repeat the request or paste tokens back into chat.
4. The assistant proposes a concrete slot with the relevant time zone and reminder.
   It asks for approval only if the current instruction and grant do not already
   authorize that exact action. Missing material details are resolved before action.
5. The user says “Make it Thursday instead.” The assistant updates the pending
   intent; an approval for the old slot cannot authorize the new one.
6. The event and reminder are confirmed through actual destination state. The
   result says what happened, when, and provides a useful link.
7. A later correction or cancellation works, including after a process restart.
   Remembering mornings respects the user's memory preference and is inspectable
   and reversible. The assistant does not infer permanent permission from one task.

Run the same behavioral contract on research, document and browser tasks as those
capabilities become qualified. The question is whether the user can delegate,
correct and rely on completion without learning a new interface for each tool.

## Seven product decisions

### 1. Deliver value before asking for setup

First contact must do useful work that needs no connection. When a request does
need access, ask for that connection at the point of need, explain its purpose,
and resume the original task when the grant arrives. No mandatory dashboard tour,
provider key form, model picker or broad “connect everything” screen for end users.
Operator installation remains explicit, documented and secure.

### 2. Make conversation the primary control

People can say “stop,” “what are you working on?”, “forget that,” “remind me,” and
“disconnect my calendar.” These reach the same services as web controls. A small
account page handles permissions, connections, memory, usage, files and recovery.
A task detail view is available when the work is complex or uncertain.

Ordinary conversation must not require selecting a workspace, thread type, agent,
model, runtime or skill. Keep distinct task context internally and ask about the
task only when ambiguity matters. The web chat can remain useful without becoming
a second mandatory product.

### 3. Take care of the handoffs

The awkward seams are part of our product: opening consent from WhatsApp, returning
from the browser, resolving a pending approval, handling expired login, uploading
an unsupported file, correcting a transcript and waiting during a long action.
Each needs intentional copy and a recovery path.

A successful OAuth callback is not sufficient. The original conversation must
continue. A finished tool call is not sufficient. The user must receive an accurate
result. An opaque download URL is not sufficient. The intended user must be able
to open the artifact, and nobody else should inherit access accidentally.

### 4. Make trust tangible

Show enough to decide: target, consequence and any material amount/date/recipient.
Honor explicit instructions and bounded standing grants without repeatedly asking
the same question. Do not turn approval into theatre or hide meaningful authority.

Completion means verified completion. If a provider times out after submission,
say the result is being checked rather than inviting a second submission. Recovery
is our responsibility as far as the provider permits; unresolved outcomes stay
visible. Memory can explain its source and accept correction. Privacy controls
work through the full lifecycle, including backup restoration.

### 5. Prefer considered defaults

Ship one recommended model configuration, one assistant personality and one clear
way to connect an account. Advanced execution choices can be exposed later when
they help users make a meaningful trade-off. Do not silently switch a user's chosen
execution profile to a separately billed provider.

Use the best qualified tool for the task. API, MCP and browser work should feel
like the same assistant. Retain Kernel as the first browser candidate; make its
boundaries replaceable inside the code without requiring the user to manage them.
Self-hosting is an operator experience with a supported, tested recipe.

### 6. Treat silence and latency as product features

Acknowledge useful intent; do not narrate every tool invocation. Provide a progress
update when it helps the user decide to wait or intervene. Do not stream fragments
that create notification noise. Send one clear completion and avoid repeating it
through several hooks or channels.

Proactivity starts with requested reminders and explicit watches. Quiet hours,
frequency limits, pause and cancel are part of the first usable behavior. Unchanged
state does not deserve a new notification. Personality is warm and concise, without
invented intimacy, praise or certainty. Measure comprehension and time saved as well
as response speed.

### 7. Finish the details before widening the surface

Quoted replies point to the correct message. Long results have usable summaries
and accessible artifacts. Voice transcription is correctable; critical names and
dates are checked. A reconnect does not lose the task. Unsupported capabilities
have honest alternatives. Loading, empty, expired, denied and failed states receive
the same care as the successful path.

Do not replace this work with branding, a larger integration count or speculative
framework design. Every launch feature needs an end-to-end owner and a real user
journey that demonstrates its value.

## What earns a place in release 1

| Launch focus                             | What must feel complete                                                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| WhatsApp and Telegram                    | Start, continue, correct, stop and receive results; deliberate adaptation to each channel                                  |
| Text, voice notes and useful attachments | Understand input, clarify important ambiguity and deliver readable output                                                  |
| Calendar and explicit reminders          | Connect when needed, act within permission, confirm results, change/cancel and recover                                     |
| Durable memory                           | Remember permitted preferences, show sources, correct and forget                                                           |
| Account and connection controls          | Verified channel linking, recovery, revocation, export/delete and clear usage limits                                       |
| Dependable operation                     | Isolation, budgets, notification restraint, failure recovery and a supported self-host recipe                              |
| Kernel browser tasks, conditional        | Add only after the same identity, action, privacy, cost and recovery gates pass; not a prerequisite for every installation |

Build and test complete journeys incrementally. Text-only engineering demos can
precede voice and files; they do not count as the finished first release. A
Telegram pilot may precede WhatsApp activation, but is explicitly a limited pilot.
No real-user admission bypasses the required identity, privacy and operations gates.

The following remain expansion work: arbitrary user-installed MCPs/CLIs, general
personal computers, a marketplace, live voice calls, payments, group/household
sharing, BYO ChatGPT execution and the Zoen connector. Preserve their architectural
fit. Do not build their screens, abstract engines or placeholder source now.
Existing browser/Google/UI code remains a reuse asset; defer exposure rather than
destroying useful implementation indiscriminately.

## How this changes execution

The engineering package table in the blueprint remains a dependency map. It is
not a requirement to finish every subsystem before touching the user experience.
The current development priority is to connect and polish existing product flows.
Record unresolved recovery and provider limits in the runtime evidence rather
than blocking all product implementation on exhaustive qualification. Keep focused
checks and independent review for changes; schedule comprehensive crash, chaos,
load and provider qualification for release readiness. This changes development
order, not the real-user admission gates below.

Implement the smallest complete cross-package slice and test it immediately:

1. Real text request → verified identity → Eve response → durable delivery → restart.
2. Connection at point of need → return to the same task → permitted action → verified result.
3. Correction/cancellation → remembered preference → scheduled follow-through → forget/revoke.
4. Voice/files and second-channel parity → adverse conditions → release readiness.

An internal demo may use an explicitly limited feature set, but never fabricated
provider output, a privileged identity bypass or an implied production guarantee.
Finish the remaining declared release scope before advertising it. Effect adoption
is still required across owned application logic; demonstrate it through real
consumer slices rather than postponing product feedback until a wholesale rewrite.

Before adding or keeping a feature, answer:

- Which part of the promise becomes better for the user?
- Can it be understood without learning our architecture?
- Can a considered default remove a choice?
- Is its failure/return path as coherent as its success path?
- Can a supported library provide it without a second authority or runtime?
- Which real journey and observation justify its cost?

If those answers are weak, reduce or defer the feature. If a critical trust or
recovery property is missing, complete it rather than hiding it behind a cleaner UI.

## The product acceptance review

Review the product from a new conversation through completion, return, correction
and failure. The demonstration must include a real provider result, a process
restart, a permission revocation and an ambiguous external failure. Check the same
sequence on both launch channels and with a second account isolated from the first.

Ask a fresh tester to complete a task without coaching. Observe what they think
will happen, when they trust it is done, where they get stuck and whether they can
correct or stop it. Follow up over repeated use: fewer interventions, useful
follow-through and less time supervising are the intended outcomes. Publish numeric
claims only after a declared workload and baseline support them.

The success criterion is that people return because it reliably removes work.
The number of adapters, services or available models is not a substitute for that.
