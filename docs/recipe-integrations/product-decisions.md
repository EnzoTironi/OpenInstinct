# Product decisions and proposed contracts

These decisions were agreed with the user in the recipe research conversation on 2026-09-08. They guide future implementation; this documentation does not establish that the behavior exists in the app.

## Agreed experience

Use a Poke-style recipe gallery and conversation as the primary experience. Users choose an outcome, connect accounts, answer the few missing questions, review what will happen, and activate a routine. They can ask the assistant to change, explain, pause, resume or diagnose it. The visual workflow builder may remain hidden indefinitely; supporting an eventual canvas is not a requirement.

The agent should have tools to discover recipes and capabilities, create and inspect routines, validate and edit their definitions, preview behavior, activate and pause execution, and diagnose failures. These are semantic capabilities; the names are not a mandate for a new framework or one tool per verb.

Show an animated preview of the saved definition. A preview represents planned behavior and must say so. During a real run, animate actual persisted execution events. Never infer completion from elapsed animation time. Provide a text equivalent, reduced-motion behavior, visible state and conversational controls.

Adopt Town's useful routine patterns and support Sim/n8n workflows through explicit integrations. Do not promise lossless conversion of arbitrary graphs. For external workflows, show the observable boundary and summary; do not invent internal step progress that the external system does not report.

## Proposed domain boundary

| Concept | Meaning |
| --- | --- |
| Recipe | Versioned template describing an outcome, required capabilities, configurable inputs, defaults, and evidence expectations |
| Installed routine | User-owned configuration: recipe version, trigger/timezone, connected accounts, settings, grants, destination and lifecycle |
| Skill | Reusable procedure/instructions; it does not itself own a schedule or permission grant |
| Run | One execution with its input/cursor, definition version, step outcomes, attempts and delivery evidence |

Resolve these concepts into existing owning types when implementing. Do not create parallel schemas just because this table exists. Start with the smallest definition supported by real recipes: gather data, filter deterministically, reason where useful, propose/perform an authorized action, report the outcome.

For example, a morning briefing definition binds a selected calendar and mailbox, timezone, delivery destination, schedule and content preferences. The user sees “read today's calendar → select important email → send your briefing.” Editing the conversation changes the saved definition and invalidates any stale preview. Future template changes must not silently broaden an installed routine's grants.

## Authority and interoperability

All Companion surfaces use the same semantic authorization and execution path. Credentials are account-bound secrets, never model-generated tool arguments. External content cannot authorize writes or replace the routine's instructions. Use bounded user grants where already authorized; do not add repeated approval prompts for actions the user has authorized within that scope.

A Sim/n8n workflow holding its own credentials can perform effects outside Companion. Companion cannot enforce an approval after those effects occur. Choose explicitly between a bounded grant covering the external execution and an external workflow that returns proposals/data for Companion to execute. Authenticate requests and callbacks, bind them to the user and run, reject replays, bound execution cost, and retain correlation IDs. Webhook acceptance, external completion and verified delivery are separate states.

A future adapter should prove one real round trip before expanding: submit a known workflow version, receive/poll its correlated result, handle cancellation and timeout honestly, and confirm any destination effect. Unknown external effects after a timeout must remain unknown; automatic replay may duplicate them.
