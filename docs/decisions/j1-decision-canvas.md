# J1 Decision Canvas — personal follow-through

Date: 2026-09-15. Gate: G0 (P00). Status: structure adopted; **measured
baseline and live rules are pending Enzo**. Do not treat placeholder cells as
product semantics.

Follows the plan's Decision Canvas fields (decision, trigger, actor, confirmer,
baseline human effort, required evidence `R(d)`, source/freshness, Actions,
error cost, execution mode, outcome evidence).

## Intended job

Use a current agreement, prepare the correct artifact, obtain the needed
decision, send on an authorized channel, and keep the outcome for the next
turn. First live door for proving the assistant is `/chat` on the application
Postgres. Gmail and WhatsApp are later G2 sources, not G0 blockers.

## Canvas

| Field                 | Current record                                                                                                            | Owner                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Decision              | Deliver the agreed artifact to the agreed recipient                                                                       | Enzo supplies the real-world meaning    |
| Trigger               | The person asks Zoen to follow through on a named commitment                                                              | Implementation may draft; Enzo confirms |
| Actor                 | Accountable user (host-resolved), not a model-supplied `userId`                                                           | Host                                    |
| Confirmer             | Same person on a native approval that binds recipient, artifact revision, connection, and operation                       | Host + Eve approval                     |
| Baseline human effort | **Not measured.** Do not invent minutes or a 50% reduction yet                                                            | Enzo                                    |
| `R(d)`                | Current commitment revision, recipient identity, artifact revision, authorized channel, and any deadline the person named | G1/G2                                   |
| Source / freshness    | `/chat` turn is the G0 source. Gmail/WhatsApp coverage is P12/P13                                                         | —                                       |
| Resulting Actions     | Propose/accept commitment, prepare delivery, record outcome (defined in P04)                                              | G1                                      |
| Error cost            | Wrong recipient or stale artifact is high; retry after uncertain send is high                                             | —                                       |
| Execution mode        | Prepare without effects; approve; short transaction; existing outbox                                                      | G1                                      |
| Outcome evidence      | Provider receipt distinct from obligation discharge                                                                       | G2                                      |

## J2 / J3 (initial, not this slice)

- **J2:** Agreement revisions and explicit acceptances among consenting people.
  Silence is not acceptance. Private constraints stay private.
- **J3:** Adult grant to review specified incoming conversations and send a
  minimal alert to a chosen helper. Suspicion is an assessment, not identity.

## Explicitly not decided here

Manual-effort minutes, holdout job set, Google/WhatsApp pairing, or treating
Mem0 facts as the commitment authority.
