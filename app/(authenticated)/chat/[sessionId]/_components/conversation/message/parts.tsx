import { MessageResponse } from "@web/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@web/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@web/components/ai-elements/tool";
import type { EveDynamicToolPart, EveMessagePart } from "eve/react";

import { AttachmentPart } from "./attachment";
import { AuthorizationPrompt } from "./authorization";
import { InputRequestActions, QuestionRequest } from "./input-request";
import type { RespondToAgentInput } from "./types";

interface AgentMessagePartProps {
  readonly canRespond: boolean;
  readonly onInputResponses: RespondToAgentInput;
  readonly part: EveMessagePart;
  readonly showCaret: boolean;
  readonly userVisibleOnly: boolean;
}

export function AgentMessagePart(props: AgentMessagePartProps) {
  switch (props.part.type) {
    case "step-start":
      return null;
    case "text":
      return (
        <MessageResponse caret="block" isAnimating={props.showCaret}>
          {props.part.text}
        </MessageResponse>
      );
    case "reasoning":
      return (
        <Reasoning defaultOpen isStreaming={props.part.state === "streaming"}>
          <ReasoningTrigger />
          <ReasoningContent>{props.part.text}</ReasoningContent>
        </Reasoning>
      );
    case "file":
      return <AttachmentPart part={props.part} />;
    case "authorization":
      return <AuthorizationPrompt part={props.part} />;
    case "dynamic-tool":
      return renderDynamicToolPart(props);
  }

  throw new Error("Unsupported agent message part.");
}

function renderDynamicToolPart({
  canRespond,
  onInputResponses,
  part,
  userVisibleOnly,
}: AgentMessagePartProps) {
  if (part.type !== "dynamic-tool") {
    throw new Error("Expected dynamic-tool part.");
  }

  const inputRequest = part.toolMetadata?.eve?.inputRequest;

  if (inputRequest?.kind === "question") {
    return (
      <QuestionRequest
        canRespond={canRespond}
        inputRequest={inputRequest}
        inputResponse={part.toolMetadata?.eve?.inputResponse}
        onInputResponses={onInputResponses}
      />
    );
  }

  if (userVisibleOnly && inputRequest) {
    return (
      <VisibleInputRequestBody
        canRespond={canRespond}
        onInputResponses={onInputResponses}
        part={part}
        showToolInput={inputRequest.kind === "tool-approval"}
      />
    );
  }

  return (
    <Tool defaultOpen={isToolDefaultOpen(part.state)}>
      <ToolHeader status={part.state} title={part.toolName} />
      <ToolContent>
        <ToolInput input={part.input} />
        <InputRequestActions
          canRespond={canRespond}
          part={part}
          onInputResponses={onInputResponses}
        />
        <ToolOutput errorText={part.errorText} output={part.output} />
      </ToolContent>
    </Tool>
  );
}

function VisibleInputRequestBody({
  canRespond,
  onInputResponses,
  part,
  showToolInput,
}: {
  readonly canRespond: boolean;
  readonly onInputResponses: RespondToAgentInput;
  readonly part: EveDynamicToolPart;
  readonly showToolInput: boolean;
}) {
  return (
    <div className="space-y-3">
      {showToolInput ? <ToolInput input={part.input} /> : null}
      <InputRequestActions
        canRespond={canRespond}
        part={part}
        onInputResponses={onInputResponses}
      />
    </div>
  );
}

function isToolDefaultOpen(state: EveDynamicToolPart["state"]): boolean {
  return state === "approval-requested" || state === "approval-responded";
}

export function partKey(part: EveMessagePart, index: number): string {
  switch (part.type) {
    case "authorization":
      return `authorization:${part.turnId}:${String(part.stepIndex)}:${part.name}`;
    case "dynamic-tool":
      return part.toolCallId;
    default:
      return `${part.type}:${String(index)}`;
  }
}
