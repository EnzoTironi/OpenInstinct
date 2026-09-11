import {
  Question,
  QuestionActions,
  QuestionDescription,
  QuestionInput,
  QuestionOption,
  QuestionOptions,
  QuestionPrompt,
  type QuestionResponse,
  QuestionSubmit,
} from "@web/components/ai-elements/question";
import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { Button } from "@web/components/ui/button";
import type { InputResponse } from "eve/client";
import type { EveDynamicToolPart, EveMessageInputRequest } from "eve/react";

import type { RespondToAgentInput } from "./types";

export function QuestionRequest({
  canRespond,
  inputRequest,
  inputResponse,
  onInputResponses,
}: {
  readonly canRespond: boolean;
  readonly inputRequest: EveMessageInputRequest;
  readonly inputResponse?: InputResponse;
  readonly onInputResponses: RespondToAgentInput;
}) {
  const selectedOption = findSelectedOption(inputRequest, inputResponse);
  const hasOptions = optionCount(inputRequest) > 0;
  const acceptsFreeform = acceptsFreeformAnswer(inputRequest, hasOptions);

  return (
    <Question
      defaultValue={questionDefaultValue(inputResponse)}
      disabled={!canRespond || inputResponse !== undefined}
      onSubmit={submitQuestionResponse(inputRequest, onInputResponses)}
    >
      <QuestionPrompt>{inputRequest.prompt}</QuestionPrompt>
      <QuestionOptionsList
        hasOptions={hasOptions}
        inputRequest={inputRequest}
      />
      {acceptsFreeform ? (
        <QuestionInput aria-label="Answer" placeholder="Type your answer…" />
      ) : null}
      <QuestionResponseFooter
        inputResponse={inputResponse}
        selectedOptionLabel={selectedOption?.label}
      />
    </Question>
  );
}

function findSelectedOption(
  inputRequest: EveMessageInputRequest,
  inputResponse: InputResponse | undefined
) {
  return inputRequest.options?.find(optionMatchesResponse(inputResponse));
}

function optionMatchesResponse(inputResponse: InputResponse | undefined) {
  return (option: { readonly id: string }) =>
    option.id === inputResponse?.optionId;
}

function optionCount(inputRequest: EveMessageInputRequest): number {
  return inputRequest.options?.length ?? 0;
}

function acceptsFreeformAnswer(
  inputRequest: EveMessageInputRequest,
  hasOptions: boolean
): boolean {
  return inputRequest.allowFreeform === true || !hasOptions;
}

function questionDefaultValue(inputResponse: InputResponse | undefined) {
  return {
    selectedValues: inputResponse?.optionId ? [inputResponse.optionId] : [],
    text: inputResponse?.text ?? "",
  };
}

function submitQuestionResponse(
  inputRequest: EveMessageInputRequest,
  onInputResponses: RespondToAgentInput
) {
  return ({ selectedValues, text }: QuestionResponse) =>
    onInputResponses([
      {
        optionId: selectedValues[0],
        requestId: inputRequest.requestId,
        text,
      },
    ]);
}

function QuestionOptionsList({
  hasOptions,
  inputRequest,
}: {
  readonly hasOptions: boolean;
  readonly inputRequest: EveMessageInputRequest;
}) {
  if (!hasOptions) {
    return null;
  }

  return (
    <QuestionOptions
      className="flex-col items-stretch"
      aria-label={inputRequest.prompt}
    >
      {inputRequest.options?.map((option) => (
        <QuestionOption
          className="justify-start text-left"
          key={option.id}
          value={option.id}
        >
          <span>
            <span className="block">{option.label}</span>
            {option.description ? (
              <span className="block type-caption opacity-70">
                {option.description}
              </span>
            ) : null}
          </span>
        </QuestionOption>
      ))}
    </QuestionOptions>
  );
}

function QuestionResponseFooter({
  inputResponse,
  selectedOptionLabel,
}: {
  readonly inputResponse: InputResponse | undefined;
  readonly selectedOptionLabel: string | undefined;
}) {
  if (inputResponse) {
    return (
      <QuestionDescription>
        Responded:{" "}
        {selectedOptionLabel ?? inputResponse.text ?? inputResponse.optionId}
      </QuestionDescription>
    );
  }

  return (
    <QuestionActions>
      <QuestionSubmit>Answer</QuestionSubmit>
    </QuestionActions>
  );
}

export function InputRequestActions({
  canRespond,
  onInputResponses,
  part,
}: {
  readonly canRespond: boolean;
  readonly onInputResponses: RespondToAgentInput;
  readonly part: EveDynamicToolPart;
}) {
  const inputRequest = part.toolMetadata?.eve?.inputRequest;

  if (!inputRequest) return null;

  const inputResponse = part.toolMetadata.eve.inputResponse;
  const selectedOption = findSelectedOption(inputRequest, inputResponse);

  return (
    <Alert variant="warning">
      <AlertTitle>{inputRequest.prompt}</AlertTitle>
      <AlertDescription>
        <InputRequestBody
          canRespond={canRespond}
          inputRequest={inputRequest}
          inputResponse={inputResponse}
          onInputResponses={onInputResponses}
          selectedOptionLabel={selectedOption?.label}
        />
      </AlertDescription>
    </Alert>
  );
}

function InputRequestBody({
  canRespond,
  inputRequest,
  inputResponse,
  onInputResponses,
  selectedOptionLabel,
}: {
  readonly canRespond: boolean;
  readonly inputRequest: EveMessageInputRequest;
  readonly inputResponse: InputResponse | undefined;
  readonly onInputResponses: RespondToAgentInput;
  readonly selectedOptionLabel: string | undefined;
}) {
  if (inputResponse) {
    return (
      <p>
        Responded:{" "}
        {selectedOptionLabel ?? inputResponse.text ?? inputResponse.optionId}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {inputRequest.options?.map((option) => (
        <Button
          disabled={!canRespond}
          key={option.id}
          onClick={respondWithOption(option.id, inputRequest, onInputResponses)}
          size="sm"
          type="button"
          variant={option.style === "danger" ? "destructive" : "default"}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

function respondWithOption(
  optionId: string,
  inputRequest: EveMessageInputRequest,
  onInputResponses: RespondToAgentInput
) {
  return () => {
    void onInputResponses([
      {
        optionId,
        requestId: inputRequest.requestId,
      },
    ]);
  };
}
