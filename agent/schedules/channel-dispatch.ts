import { Effect } from "effect";
import { defineSchedule, type ScheduleToFn } from "eve/schedules";
import telegram from "@agent/channels/telegram";
import kapso from "@agent/channels/kapso";
import { channelPrincipal } from "@agent/lib/channel-session";
import { Messaging } from "../../server/messaging";
import { ChannelTransport } from "../../server/channels/transport";
import { drainAuthPrompts, dispatchItem } from "../../server/channels/dispatch";
import { serverRuntime } from "../../server/runtime";

const dispatchChannels = Effect.fn("dispatchChannels")(function* (
  to: ScheduleToFn
) {
  const transport = yield* ChannelTransport;
  const messaging = yield* Messaging;
  yield* dispatchItem("auth-prompts", drainAuthPrompts);
  for (const channel of ["telegram", "kapso"] as const) {
    const candidates = yield* transport.inboxCandidates(channel, 25);
    yield* Effect.forEach(
      candidates,
      (identity) =>
        dispatchItem(
          identity.id,
          Effect.gen(function* () {
            const claim = yield* messaging.claimInbox({
              identityId: identity.id,
              leaseSeconds: 30,
            });
            if (!claim) return;
            // The destination validates this lease and loads its stored payload.
            yield* Effect.tryPromise({
              try: () =>
                to(channel === "telegram" ? telegram : kapso, {
                  identityId: identity.id,
                  id: claim.id,
                  leaseToken: claim.leaseToken,
                }).send("", { auth: channelPrincipal(identity) }),
              catch: () => new Error("Channel handoff could not be confirmed."),
            }).pipe(
              Effect.catch(() =>
                Effect.logError("Scheduled channel handoff failed", {
                  inboxId: claim.id,
                })
              )
            );
          })
        ),
      { concurrency: 4, discard: true }
    );
    const outbound = yield* transport.outboxCandidates(channel, 25);
    yield* Effect.forEach(
      outbound,
      (identity) =>
        dispatchItem(identity.id, transport.drainOutbox(identity.id)),
      { concurrency: 4, discard: true }
    );
  }
});

export default defineSchedule({
  cron: "* * * * *",
  run({ to, waitUntil }) {
    waitUntil(serverRuntime.runPromise(dispatchChannels(to)));
  },
});
