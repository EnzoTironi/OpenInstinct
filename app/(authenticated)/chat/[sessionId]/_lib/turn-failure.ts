import { isTurnFailureEvent, type MessageStreamEvent } from "eve/client";

const turnBoundaryTypes = new Set([
  "turn.completed",
  "turn.cancelled",
  "message.received",
]);

function modelCallFailureMessage(code: string, message: string) {
  if (code === "MODEL_CALL_FAILED") {
    return "The model is temporarily unavailable. Please try again.";
  }

  return message;
}

function turnFailureMessage(event: MessageStreamEvent): string | undefined {
  if (!(isTurnFailureEvent(event) && event.type === "turn.failed")) {
    return undefined;
  }

  return modelCallFailureMessage(event.data.code, event.data.message);
}

function isTurnBoundary(event: MessageStreamEvent) {
  return turnBoundaryTypes.has(event.type);
}

/** null = keep scanning; undefined = stop without failure; string = failure */
function scanEventForFailure(
  event: MessageStreamEvent | undefined
): string | undefined | null {
  if (!event) {
    return null;
  }

  const failure = turnFailureMessage(event);

  if (failure !== undefined) {
    return failure;
  }

  if (isTurnBoundary(event)) {
    return undefined;
  }

  return null;
}

export function getLatestTurnFailure(
  events: readonly MessageStreamEvent[]
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const result = scanEventForFailure(events[index]);

    if (result !== null) {
      return result;
    }
  }

  return undefined;
}
