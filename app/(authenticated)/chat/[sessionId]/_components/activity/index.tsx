"use client";

import {
  collectSubagentSessions,
  getSubagentStatus,
  type SubagentSession,
  type SubagentStatus,
} from "@app/_lib/subagent-sessions";
import type { ChatUsage } from "@shared/chat/schema";
import { cn } from "@web/components/class-names";
import { Button } from "@web/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@web/components/ui/sheet";
import type { MessageStreamEvent } from "eve/client";
import { ListTreeIcon } from "lucide-react";
import {
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { TraceView } from "../../_lib/trace-view";
import { ActivityCard } from "./card";
import { TracePreview } from "./preview";
import { useChatUsage } from "./use-chat-usage";

const emptyEventsBySession = new Map<string, readonly MessageStreamEvent[]>();

export function SubagentPanel({
  events,
  historyComplete,
  initialUsage,
  onTraceViewChange,
  sessionId,
  traceView,
}: {
  readonly events: readonly MessageStreamEvent[];
  readonly historyComplete: boolean;
  readonly initialUsage?: ChatUsage;
  readonly onTraceViewChange: (view: TraceView) => void;
  readonly sessionId?: string;
  readonly traceView: TraceView;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const [mobileOpen, setMobileOpen] = useState(false);
  const traceCloseButton = useRef<HTMLButtonElement>(null);
  const restoreFocusId = useRef<string | undefined>(undefined);
  const sessions = useMemo(() => collectSubagentSessions(events), [events]);

  const usage = useChatUsage({
    events,
    historyComplete,
    initialUsage,
    sessionId,
  });

  const statuses = useMemo(() => sessionStatuses(sessions), [sessions]);
  const workingCount = countWorkingSessions(statuses);
  const doneCount = sessions.length - workingCount;
  const selected = findSelectedSession(sessions, selectedId);

  useEffect(() => {
    return manageTraceFocus(
      selectedId,
      restoreFocusId,
      traceCloseButton,
      setSelectedId
    );
  }, [selectedId]);

  const activity = (
    <ActivityCard
      doneCount={doneCount}
      eventsBySession={emptyEventsBySession}
      onSelect={(childSessionId) => {
        restoreFocusId.current = childSessionId;
        setSelectedId(childSessionId);
      }}
      onTraceViewChange={onTraceViewChange}
      sessions={sessions}
      statuses={statuses}
      traceView={traceView}
      usage={usage}
      workingCount={workingCount}
    />
  );

  return (
    <>
      <DesktopActivityRail activity={activity} selected={selected} />
      <MobileActivityOpener setMobileOpen={setMobileOpen} />
      <DesktopTraceRail
        onClose={() => {
          setSelectedId(undefined);
        }}
        selected={selected}
        traceCloseButton={traceCloseButton}
      />
      <MobileActivitySheet
        activity={activity}
        mobileOpen={mobileOpen}
        onClose={() => {
          setSelectedId(undefined);
        }}
        selected={selected}
        setMobileOpen={setMobileOpen}
      />
    </>
  );
}

function sessionStatuses(sessions: readonly SubagentSession[]) {
  return new Map(
    sessions.map((session) => [
      session.childSessionId,
      getSubagentStatus([], session),
    ])
  );
}

function countWorkingSessions(statuses: Map<string, SubagentStatus>): number {
  return [...statuses.values()].filter(isWorkingStatus).length;
}

function isWorkingStatus(status: SubagentStatus): boolean {
  return status === "starting" || status === "working";
}

function findSelectedSession(
  sessions: readonly SubagentSession[],
  selectedId: string | undefined
) {
  return sessions.find((session) => session.childSessionId === selectedId);
}

function manageTraceFocus(
  selectedId: string | undefined,
  restoreFocusId: RefObject<string | undefined>,
  traceCloseButton: RefObject<HTMLButtonElement | null>,
  setSelectedId: Dispatch<SetStateAction<string | undefined>>
) {
  if (!window.matchMedia("(min-width: 48rem)").matches) return undefined;

  if (!selectedId) {
    return restoreTaskButtonFocus(restoreFocusId);
  }

  return focusTraceCloseButton(traceCloseButton, setSelectedId);
}

function restoreTaskButtonFocus(restoreFocusId: RefObject<string | undefined>) {
  const taskId = restoreFocusId.current;

  if (!taskId) return undefined;

  const frame = requestAnimationFrame(() => {
    focusTaskButton(taskId);
    restoreFocusId.current = undefined;
  });

  return () => {
    cancelAnimationFrame(frame);
  };
}

function focusTaskButton(taskId: string) {
  document
    .querySelector<HTMLButtonElement>(
      `[data-task-session="${CSS.escape(taskId)}"]`
    )
    ?.focus();
}

function focusTraceCloseButton(
  traceCloseButton: RefObject<HTMLButtonElement | null>,
  setSelectedId: Dispatch<SetStateAction<string | undefined>>
) {
  const frame = requestAnimationFrame(() => {
    traceCloseButton.current?.focus();
  });

  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      setSelectedId(undefined);
    }
  };

  window.addEventListener("keydown", closeOnEscape);

  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("keydown", closeOnEscape);
  };
}

function DesktopActivityRail({
  activity,
  selected,
}: {
  readonly activity: ReactNode;
  readonly selected: SubagentSession | undefined;
}) {
  return (
    <aside
      aria-hidden={selected !== undefined}
      className={cn(
        "relative hidden h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-linear md:block",
        selected ? "w-0" : "w-80"
      )}
    >
      <div
        className={cn(
          "absolute inset-y-0 right-0 flex w-80 items-start p-3 transition-[opacity,transform] duration-200",
          selected
            ? "pointer-events-none translate-x-6 opacity-0"
            : "translate-x-0 opacity-100"
        )}
      >
        {activity}
      </div>
    </aside>
  );
}

function MobileActivityOpener({
  setMobileOpen,
}: {
  readonly setMobileOpen: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <Button
      aria-label="Open activity panel"
      className="absolute top-2 right-3 z-30 md:hidden"
      onClick={() => {
        setMobileOpen(true);
      }}
      size="icon-sm"
      type="button"
      variant="ghost"
    >
      <ListTreeIcon />
    </Button>
  );
}

function DesktopTraceRail({
  onClose,
  selected,
  traceCloseButton,
}: {
  readonly onClose: () => void;
  readonly selected: SubagentSession | undefined;
  readonly traceCloseButton: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <aside
      aria-hidden={!selected}
      className={cn(
        "relative hidden h-full shrink-0 overflow-hidden border-l bg-background transition-[width] duration-200 ease-linear md:block",
        selected ? "w-1/2 min-w-80" : "w-0 border-l-0"
      )}
    >
      <div
        className={cn(
          "absolute inset-y-0 right-0 flex w-full min-w-80 flex-col transition-[opacity,transform] duration-200",
          selected
            ? "translate-x-0 opacity-100"
            : "pointer-events-none translate-x-6 opacity-0"
        )}
      >
        <DesktopSelectedTrace
          onClose={onClose}
          selected={selected}
          traceCloseButton={traceCloseButton}
        />
      </div>
    </aside>
  );
}

function DesktopSelectedTrace({
  onClose,
  selected,
  traceCloseButton,
}: {
  readonly onClose: () => void;
  readonly selected: SubagentSession | undefined;
  readonly traceCloseButton: RefObject<HTMLButtonElement | null>;
}) {
  if (!selected) return null;

  return (
    <TracePreview
      closeButtonRef={traceCloseButton}
      key={selected.childSessionId}
      onClose={onClose}
      session={selected}
    />
  );
}

function MobileActivitySheet({
  activity,
  mobileOpen,
  onClose,
  selected,
  setMobileOpen,
}: {
  readonly activity: ReactNode;
  readonly mobileOpen: boolean;
  readonly onClose: () => void;
  readonly selected: SubagentSession | undefined;
  readonly setMobileOpen: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <Sheet
      onOpenChange={(open) => {
        setMobileOpen(open);

        if (!open) {
          onClose();
        }
      }}
      open={mobileOpen}
    >
      <SheetContent
        className="h-[85svh] w-full gap-0 p-0 sm:max-w-none"
        side="bottom"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{sheetTitle(selected)}</SheetTitle>
          <SheetDescription>{sheetDescription(selected)}</SheetDescription>
        </SheetHeader>
        <MobileSheetBody
          activity={activity}
          onClose={onClose}
          selected={selected}
        />
      </SheetContent>
    </Sheet>
  );
}

function sheetTitle(selected: SubagentSession | undefined): string {
  if (selected) return `${selected.name} trace`;

  return "Agent activity";
}

function sheetDescription(selected: SubagentSession | undefined): string {
  if (selected) return "Full trace for the selected subagent";

  return "Conversation views, sources, and live task statuses";
}

function MobileSheetBody({
  activity,
  onClose,
  selected,
}: {
  readonly activity: ReactNode;
  readonly onClose: () => void;
  readonly selected: SubagentSession | undefined;
}) {
  if (!selected) return activity;

  return (
    <TracePreview
      key={selected.childSessionId}
      onClose={onClose}
      session={selected}
    />
  );
}
