"use client";

import type { UserContent } from "ai";
import {
  Client,
  defaultMessageReducer,
  isCurrentTurnBoundaryEvent,
  type InputResponse,
  type MessageStreamEvent,
  type RespondTurnOptions,
  type SendTurnOptions,
} from "eve/client";
import type { EveMessageData, UseEveAgentStatus } from "eve/react";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  readLatestSessionHistory,
  readOlderSessionHistory,
  type SessionHistoryPage,
} from "../_lib/session-history";
import type { ChatAgent } from "./chat-agent";

const client = new Client({ host: "" });

const messageReducer = defaultMessageReducer();

const emptyEvents: readonly MessageStreamEvent[] = [];

export function useSessionAgent(sessionId: string): ChatAgent {
  const state = useSessionState(sessionId);
  const operations = useSessionOperations(sessionId, state);
  const older = useOlderHistory(sessionId, state);

  return buildChatAgent(sessionId, state, operations, older);
}

interface SessionState {
  readonly catchUp: (signal?: AbortSignal) => Promise<void>;
  readonly data: EveMessageData;
  readonly error: Error | undefined;
  readonly events: readonly MessageStreamEvent[];
  readonly history: SessionHistoryPage | undefined;
  readonly historyRef: RefObject<SessionHistoryPage | undefined>;
  readonly operationRef: RefObject<Promise<void> | undefined>;
  readonly runOperation: (operation: () => Promise<void>) => Promise<void>;
  readonly setError: Dispatch<SetStateAction<Error | undefined>>;
  readonly setHistory: Dispatch<SetStateAction<SessionHistoryPage | undefined>>;
  readonly setStatus: Dispatch<SetStateAction<UseEveAgentStatus>>;
  readonly status: UseEveAgentStatus;
}

interface SessionOperations {
  readonly respond: ChatAgent["respond"];
  readonly resume: ChatAgent["resume"];
  readonly send: ChatAgent["send"];
}

interface OlderHistory {
  readonly hasOlder: boolean;
  readonly isLoadingOlder: boolean;
  readonly loadOlder: () => Promise<void>;
}

function useSessionState(sessionId: string): SessionState {
  const [history, setHistory] = useState<SessionHistoryPage>();
  const [status, setStatus] = useState<UseEveAgentStatus>("resuming");
  const [error, setError] = useState<Error>();
  const historyRef = useRef(history);
  const operationRef = useRef<Promise<void> | undefined>(undefined);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  const followActiveTurn = useCallback(
    async (startIndex: number, signal?: AbortSignal) => {
      await followActiveTurnStream(
        sessionId,
        startIndex,
        signal,
        historyRef,
        setHistory,
        setStatus
      );
    },
    [sessionId]
  );

  const runOperation = useCallback((operation: () => Promise<void>) => {
    return enqueueOperation(operationRef, operation);
  }, []);

  const catchUp = useCallback(
    async (signal?: AbortSignal) => {
      await catchUpStream(
        sessionId,
        signal,
        historyRef,
        setHistory,
        followActiveTurn
      );
    },
    [followActiveTurn, sessionId]
  );

  useEffect(() => {
    return bootstrapSession(
      sessionId,
      historyRef,
      setHistory,
      setStatus,
      setError,
      followActiveTurn,
      runOperation
    );
  }, [followActiveTurn, runOperation, sessionId]);

  const events = eventsFromHistory(history);
  const data = useMemo(() => reduceSessionMessages(events), [events]);

  return {
    catchUp,
    data,
    error,
    events,
    history,
    historyRef,
    operationRef,
    runOperation,
    setError,
    setHistory,
    setStatus,
    status,
  };
}

function useSessionOperations(
  sessionId: string,
  state: SessionState
): SessionOperations {
  const resume = useCallback(() => {
    return runResumeOperation(
      state.runOperation,
      state.catchUp,
      state.setStatus,
      state.setError
    );
  }, [state.catchUp, state.runOperation, state.setError, state.setStatus]);

  const send = useCallback(
    async <TOutput>(
      message: string | UserContent,
      options?: SendTurnOptions<TOutput>
    ) => {
      await sendTurn(
        sessionId,
        message,
        options,
        state.historyRef,
        state.operationRef,
        state.runOperation,
        state.setHistory,
        state.setStatus,
        state.setError,
        resume
      );
    },
    [
      resume,
      sessionId,
      state.historyRef,
      state.operationRef,
      state.runOperation,
      state.setError,
      state.setHistory,
      state.setStatus,
    ]
  );

  const respond = useCallback(
    async <TOutput>(
      inputResponses: readonly InputResponse[],
      options?: RespondTurnOptions<TOutput>
    ) => {
      await respondTurn(
        sessionId,
        inputResponses,
        options,
        state.historyRef,
        state.runOperation,
        state.setHistory,
        state.setStatus,
        state.setError
      );
    },
    [
      sessionId,
      state.historyRef,
      state.runOperation,
      state.setError,
      state.setHistory,
      state.setStatus,
    ]
  );

  return { respond, resume, send };
}

function useOlderHistory(sessionId: string, state: SessionState): OlderHistory {
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  const loadOlder = useCallback(async () => {
    await loadOlderHistory(
      sessionId,
      state.historyRef,
      isLoadingOlder,
      setIsLoadingOlder,
      state.setHistory,
      state.setError
    );
  }, [
    isLoadingOlder,
    sessionId,
    state.historyRef,
    state.setError,
    state.setHistory,
  ]);

  return {
    hasOlder: hasOlderHistory(state.history),
    isLoadingOlder,
    loadOlder,
  };
}

function buildChatAgent(
  sessionId: string,
  state: SessionState,
  operations: SessionOperations,
  older: OlderHistory
): ChatAgent {
  return {
    cancel: createCancel(sessionId),
    data: state.data,
    error: state.error,
    events: state.events,
    hasOlder: older.hasOlder,
    isLoadingOlder: older.isLoadingOlder,
    loadOlder: older.loadOlder,
    respond: operations.respond,
    resume: operations.resume,
    send: operations.send,
    status: state.status,
  };
}

function eventsFromHistory(
  history: SessionHistoryPage | undefined
): readonly MessageStreamEvent[] {
  return history?.events ?? emptyEvents;
}

async function followActiveTurnStream(
  sessionId: string,
  startIndex: number,
  signal: AbortSignal | undefined,
  historyRef: RefObject<SessionHistoryPage | undefined>,
  setHistory: Dispatch<SetStateAction<SessionHistoryPage | undefined>>,
  setStatus: Dispatch<SetStateAction<UseEveAgentStatus>>
) {
  const session = client.sessions.attach(sessionId, {
    streamIndex: startIndex,
  });

  let nextIndex = startIndex;

  for await (const event of session.stream({ signal, startIndex })) {
    nextIndex += 1;
    appendSessionEvent(historyRef, setHistory, event, nextIndex);
    setStatus("streaming");

    if (isCurrentTurnBoundaryEvent(event)) break;
  }
}

async function catchUpStream(
  sessionId: string,
  signal: AbortSignal | undefined,
  historyRef: RefObject<SessionHistoryPage | undefined>,
  setHistory: Dispatch<SetStateAction<SessionHistoryPage | undefined>>,
  followActiveTurn: (startIndex: number, signal?: AbortSignal) => Promise<void>
) {
  const current = historyRef.current;

  if (!current) return;

  const session = client.sessions.attach(sessionId, {
    streamIndex: current.endIndex,
  });

  let nextIndex = current.endIndex;
  let latest = current.events.at(-1);

  for await (const event of session.stream({
    follow: false,
    signal,
    startIndex: nextIndex,
  })) {
    nextIndex += 1;
    latest = event;
    appendSessionEvent(historyRef, setHistory, event, nextIndex);
  }

  if (latest && !isCurrentTurnBoundaryEvent(latest)) {
    await followActiveTurn(nextIndex, signal);
  }
}

function enqueueOperation(
  operationRef: RefObject<Promise<void> | undefined>,
  operation: () => Promise<void>
) {
  const activeOperation = operationRef.current;

  if (activeOperation) return activeOperation;

  const promise = operation().finally(() => {
    clearOperationRef(operationRef, promise);
  });

  operationRef.current = promise;

  return promise;
}

function clearOperationRef(
  operationRef: RefObject<Promise<void> | undefined>,
  promise: Promise<void>
) {
  if (operationRef.current === promise) {
    operationRef.current = undefined;
  }
}

function bootstrapSession(
  sessionId: string,
  historyRef: RefObject<SessionHistoryPage | undefined>,
  setHistory: Dispatch<SetStateAction<SessionHistoryPage | undefined>>,
  setStatus: Dispatch<SetStateAction<UseEveAgentStatus>>,
  setError: Dispatch<SetStateAction<Error | undefined>>,
  followActiveTurn: (startIndex: number, signal?: AbortSignal) => Promise<void>,
  runOperation: (operation: () => Promise<void>) => Promise<void>
) {
  const controller = new AbortController();

  void readLatestSessionHistory(sessionId, controller.signal)
    .then((latest) => {
      applyLatestHistory(
        latest,
        controller.signal,
        historyRef,
        setHistory,
        setStatus,
        followActiveTurn,
        runOperation
      );

      return undefined;
    })
    .catch((cause: unknown) => {
      applyBootstrapError(cause, controller.signal, setError, setStatus);

      return undefined;
    });

  return () => {
    controller.abort();
  };
}

function applyLatestHistory(
  latest: SessionHistoryPage,
  signal: AbortSignal,
  historyRef: RefObject<SessionHistoryPage | undefined>,
  setHistory: Dispatch<SetStateAction<SessionHistoryPage | undefined>>,
  setStatus: Dispatch<SetStateAction<UseEveAgentStatus>>,
  followActiveTurn: (startIndex: number, signal?: AbortSignal) => Promise<void>,
  runOperation: (operation: () => Promise<void>) => Promise<void>
) {
  if (signal.aborted) return;

  historyRef.current = latest;
  setHistory(latest);
  const tail = latest.events.at(-1);

  if (!tail || isCurrentTurnBoundaryEvent(tail)) {
    setStatus("ready");

    return;
  }

  setStatus("streaming");
  void runOperation(() =>
    continueActiveTurn(latest.endIndex, signal, followActiveTurn, setStatus)
  );
}

async function continueActiveTurn(
  endIndex: number,
  signal: AbortSignal,
  followActiveTurn: (startIndex: number, signal?: AbortSignal) => Promise<void>,
  setStatus: Dispatch<SetStateAction<UseEveAgentStatus>>
) {
  await followActiveTurn(endIndex, signal);

  if (!signal.aborted) {
    setStatus("ready");
  }
}

function applyBootstrapError(
  cause: unknown,
  signal: AbortSignal,
  setError: Dispatch<SetStateAction<Error | undefined>>,
  setStatus: Dispatch<SetStateAction<UseEveAgentStatus>>
) {
  if (signal.aborted) return;

  setError(toError(cause));
  setStatus("error");
}

function runResumeOperation(
  runOperation: (operation: () => Promise<void>) => Promise<void>,
  catchUp: (signal?: AbortSignal) => Promise<void>,
  setStatus: Dispatch<SetStateAction<UseEveAgentStatus>>,
  setError: Dispatch<SetStateAction<Error | undefined>>
) {
  return runOperation(() => resumeCatchUp(catchUp, setStatus, setError));
}

async function resumeCatchUp(
  catchUp: (signal?: AbortSignal) => Promise<void>,
  setStatus: Dispatch<SetStateAction<UseEveAgentStatus>>,
  setError: Dispatch<SetStateAction<Error | undefined>>
) {
  setStatus("resuming");
  setError(undefined);

  try {
    await catchUp();
    setStatus("ready");
  } catch (cause) {
    setError(toError(cause));
    setStatus("error");
  }
}

async function sendTurn<TOutput>(
  sessionId: string,
  message: string | UserContent,
  options: SendTurnOptions<TOutput> | undefined,
  historyRef: RefObject<SessionHistoryPage | undefined>,
  operationRef: RefObject<Promise<void> | undefined>,
  runOperation: (operation: () => Promise<void>) => Promise<void>,
  setHistory: Dispatch<SetStateAction<SessionHistoryPage | undefined>>,
  setStatus: Dispatch<SetStateAction<UseEveAgentStatus>>,
  setError: Dispatch<SetStateAction<Error | undefined>>,
  resume: () => Promise<void>
) {
  const activeOperation = operationRef.current;

  if (activeOperation && options?.turnPolicy === "steer") {
    await steerActiveTurn(
      sessionId,
      message,
      options,
      historyRef,
      activeOperation,
      resume
    );

    return;
  }

  await runOperation(() =>
    sendFreshTurn(
      sessionId,
      message,
      options,
      historyRef,
      setHistory,
      setStatus,
      setError
    )
  );
}

async function steerActiveTurn<TOutput>(
  sessionId: string,
  message: string | UserContent,
  options: SendTurnOptions<TOutput>,
  historyRef: RefObject<SessionHistoryPage | undefined>,
  activeOperation: Promise<void>,
  resume: () => Promise<void>
) {
  const current = historyRef.current;

  if (!current) throw new Error("The conversation is still loading.");

  const session = client.sessions.attach(sessionId, {
    streamIndex: current.endIndex,
  });

  await session.send(message, options);
  await activeOperation;
  await resume();
}

async function sendFreshTurn<TOutput>(
  sessionId: string,
  message: string | UserContent,
  options: SendTurnOptions<TOutput> | undefined,
  historyRef: RefObject<SessionHistoryPage | undefined>,
  setHistory: Dispatch<SetStateAction<SessionHistoryPage | undefined>>,
  setStatus: Dispatch<SetStateAction<UseEveAgentStatus>>,
  setError: Dispatch<SetStateAction<Error | undefined>>
) {
  const current = historyRef.current;

  if (!current) throw new Error("The conversation is still loading.");

  setError(undefined);
  setStatus("submitted");

  const session = client.sessions.attach(sessionId, {
    streamIndex: current.endIndex,
  });

  let nextIndex = current.endIndex;

  try {
    const response = await session.send(message, options);

    for await (const event of response) {
      nextIndex += 1;
      appendSessionEvent(historyRef, setHistory, event, nextIndex);
      setStatus("streaming");
    }

    setStatus("ready");
  } catch (cause) {
    setError(toError(cause));
    setStatus("error");
    throw cause;
  }
}

async function respondTurn<TOutput>(
  sessionId: string,
  inputResponses: readonly InputResponse[],
  options: RespondTurnOptions<TOutput> | undefined,
  historyRef: RefObject<SessionHistoryPage | undefined>,
  runOperation: (operation: () => Promise<void>) => Promise<void>,
  setHistory: Dispatch<SetStateAction<SessionHistoryPage | undefined>>,
  setStatus: Dispatch<SetStateAction<UseEveAgentStatus>>,
  setError: Dispatch<SetStateAction<Error | undefined>>
) {
  await runOperation(() =>
    respondFreshTurn(
      sessionId,
      inputResponses,
      options,
      historyRef,
      setHistory,
      setStatus,
      setError
    )
  );
}

async function respondFreshTurn<TOutput>(
  sessionId: string,
  inputResponses: readonly InputResponse[],
  options: RespondTurnOptions<TOutput> | undefined,
  historyRef: RefObject<SessionHistoryPage | undefined>,
  setHistory: Dispatch<SetStateAction<SessionHistoryPage | undefined>>,
  setStatus: Dispatch<SetStateAction<UseEveAgentStatus>>,
  setError: Dispatch<SetStateAction<Error | undefined>>
) {
  const current = historyRef.current;

  if (!current) throw new Error("The conversation is still loading.");

  setError(undefined);
  setStatus("submitted");

  const session = client.sessions.attach(sessionId, {
    streamIndex: current.endIndex,
  });

  let nextIndex = current.endIndex;

  try {
    const response = await session.respond(inputResponses, options);

    for await (const event of response) {
      nextIndex += 1;
      appendSessionEvent(historyRef, setHistory, event, nextIndex);
      setStatus("streaming");
    }

    setStatus("ready");
  } catch (cause) {
    setError(toError(cause));
    setStatus("error");
    throw cause;
  }
}

async function loadOlderHistory(
  sessionId: string,
  historyRef: RefObject<SessionHistoryPage | undefined>,
  isLoadingOlder: boolean,
  setIsLoadingOlder: Dispatch<SetStateAction<boolean>>,
  setHistory: Dispatch<SetStateAction<SessionHistoryPage | undefined>>,
  setError: Dispatch<SetStateAction<Error | undefined>>
) {
  const current = historyRef.current;

  if (!current || current.startIndex === 0 || isLoadingOlder) return;

  setIsLoadingOlder(true);

  try {
    const older = await readOlderSessionHistory(sessionId, current.startIndex);
    setHistory((latest) => mergeOlderHistory(latest, older));
  } catch (cause) {
    setError(toError(cause));
  } finally {
    setIsLoadingOlder(false);
  }
}

function mergeOlderHistory(
  latest: SessionHistoryPage | undefined,
  older: SessionHistoryPage
): SessionHistoryPage | undefined {
  if (!latest) return latest;

  return {
    ...latest,
    events: [...older.events, ...latest.events],
    startIndex: older.startIndex,
  };
}

function reduceSessionMessages(
  events: readonly MessageStreamEvent[]
): EveMessageData {
  return events.reduce(
    (current, event) => messageReducer.reduce(current, event),
    messageReducer.initial()
  );
}

function createCancel(sessionId: string) {
  return async () => await client.sessions.attach(sessionId).cancel();
}

function hasOlderHistory(history: SessionHistoryPage | undefined): boolean {
  return (history?.startIndex ?? 0) > 0;
}

function appendSessionEvent(
  historyRef: RefObject<SessionHistoryPage | undefined>,
  setHistory: Dispatch<SetStateAction<SessionHistoryPage | undefined>>,
  event: MessageStreamEvent,
  endIndex: number
) {
  setHistory((current) => {
    const next = nextHistoryPage(current, event, endIndex);

    if (next) historyRef.current = next;

    return next;
  });
}

function nextHistoryPage(
  current: SessionHistoryPage | undefined,
  event: MessageStreamEvent,
  endIndex: number
): SessionHistoryPage | undefined {
  if (!current) return current;

  if (current.events.some((candidate) => candidate.meta.id === event.meta.id)) {
    return { ...current, endIndex };
  }

  return {
    ...current,
    endIndex,
    events: [...current.events, event],
  };
}

function toError(cause: unknown) {
  if (cause instanceof Error) return cause;

  return new Error("The session request failed.");
}
