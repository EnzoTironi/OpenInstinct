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
import type { EveMessagePart } from "eve/react";

import { AttachmentPart } from "./attachment";
import { AuthorizationPrompt } from "./authorization";
import { InputRequestActions, QuestionRequest } from "./input-request";
import type { RespondToAgentInput } from "./types";

export function AgentMessagePart({
  canRespond,
  onInputResponses,
  part,
  showCaret,
  userVisibleOnly,
}: {
  readonly canRespond: boolean;
  readonly onInputResponses: RespondToAgentInput;
  readonly part: EveMessagePart;
  readonly showCaret: boolean;
  readonly userVisibleOnly: boolean;
}) {
  switch (part.type) {
    case "step-start":
      return null;
    case "text":
      return (
        <MessageResponse caret="block" isAnimating={showCaret}>
          {part.text}
        </MessageResponse>
      );
    case "reasoning":
      return (
        <Reasoning defaultOpen isStreaming={part.state === "streaming"}>
          <ReasoningTrigger />
          <ReasoningContent>{part.text}</ReasoningContent>
        </Reasoning>
      );
    case "file":
      return <AttachmentPart part={part} />;
    case "authorization":
      return <AuthorizationPrompt part={part} />;
    case "dynamic-tool": {
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
          <div className="space-y-3">
            {inputRequest.kind === "tool-approval" ? (
              <ToolInput input={part.input} />
            ) : null}
            <InputRequestActions
              canRespond={canRespond}
              part={part}
              onInputResponses={onInputResponses}
            />
          </div>
        );
      }

      return (
        <Tool
          defaultOpen={
            part.state === "approval-requested" ||
            part.state === "approval-responded"
          }
        >
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
  }

  throw new Error("Unsupported agent message part.");
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
