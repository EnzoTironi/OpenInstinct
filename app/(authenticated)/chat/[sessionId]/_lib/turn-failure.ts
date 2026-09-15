import { isTurnFailureEvent, type MessageStreamEvent } from "eve/client";

export const chatFailureCopy = {
  generic: "Unable to complete the request.",
  runtimeUnavailable:
    "The agent runtime is unavailable. Try again in a moment.",
  modelUnavailable: "The model is temporarily unavailable. Please try again.",
  modelCredits:
    "The model provider has no remaining credits. Check billing and try again.",
  modelRejected:
    "The model provider rejected this request. Check the configured model connection.",
} as const;

export type ChatFailureCopy =
  (typeof chatFailureCopy)[keyof typeof chatFailureCopy];

const chatFailureCopyValues: readonly string[] = Object.values(chatFailureCopy);

export function isChatFailureCopy(message: string): message is ChatFailureCopy {
  return chatFailureCopyValues.includes(message);
}

export function userFacingFailureCopy(message: string): ChatFailureCopy {
  return isChatFailureCopy(message) ? message : chatFailureCopy.generic;
}

export function getLatestTurnFailure(
  events: readonly MessageStreamEvent[]
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) continue;

    if (isTurnFailureEvent(event) && event.type === "turn.failed") {
      return event.data.code === "MODEL_CALL_FAILED"
        ? modelAccessFailureMessage(event.data.message)
        : event.data.message;
    }
    if (
      event.type === "turn.completed" ||
      event.type === "turn.cancelled" ||
      event.type === "message.received"
    ) {
      return undefined;
    }
  }
  return undefined;
}

export function modelAccessFailureMessage(detail: string) {
  if (
    /usage limit|quota|insufficient.*(?:credit|balance)|\b402\b/iu.test(detail)
  ) {
    return chatFailureCopy.modelCredits;
  }
  if (
    /unauthori[sz]ed|authentication|invalid.*(?:key|token)|\b40[13]\b/iu.test(
      detail
    )
  ) {
    return chatFailureCopy.modelRejected;
  }
  return chatFailureCopy.modelUnavailable;
}
