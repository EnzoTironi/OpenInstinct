import { Alert, AlertDescription, AlertTitle } from "@web/components/ui/alert";
import { Badge } from "@web/components/ui/badge";
import { Button } from "@web/components/ui/button";
import type { EveAuthorizationPart } from "eve/react";
import {
  CheckCircleIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  XCircleIcon,
} from "lucide-react";
import { createElement } from "react";

export function AuthorizationPrompt({
  part,
}: {
  readonly part: EveAuthorizationPart;
}) {
  const isAuthorized =
    part.state === "completed" && part.outcome === "authorized";

  const isCompleted = part.state === "completed";

  const instructions = part.authorization?.instructions;

  const shouldShowInstructions = shouldShowAuthorizationInstructions(
    instructions,
    part.description
  );

  return (
    <Alert variant={authorizationAlertVariant(isAuthorized, isCompleted)}>
      {createElement(authorizationIcon(isAuthorized, isCompleted))}
      <AlertTitle>{authorizationTitle(part)}</AlertTitle>
      <AlertDescription>
        <p>{authorizationDescription(part)}</p>
        {shouldShowInstructions ? <p>{instructions}</p> : null}
        <AuthorizationUserCode part={part} />
        <AuthorizationSignInButton part={part} />
      </AlertDescription>
    </Alert>
  );
}

function authorizationIcon(isAuthorized: boolean, isCompleted: boolean) {
  if (isAuthorized) {
    return CheckCircleIcon;
  }

  if (isCompleted) {
    return XCircleIcon;
  }

  return KeyRoundIcon;
}

function authorizationAlertVariant(
  isAuthorized: boolean,
  isCompleted: boolean
): "success" | "destructive" | "information" {
  if (isAuthorized) {
    return "success";
  }

  if (isCompleted) {
    return "destructive";
  }

  return "information";
}

function shouldShowAuthorizationInstructions(
  instructions: string | undefined,
  description: string
): boolean {
  return instructions !== undefined && instructions !== description;
}

function AuthorizationUserCode({
  part,
}: {
  readonly part: EveAuthorizationPart;
}) {
  if (part.state !== "required") {
    return null;
  }

  const userCode = part.authorization?.userCode;

  if (!userCode) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span>Code</span>
      <Badge variant="outline">
        <code className="type-compact-code">{userCode}</code>
      </Badge>
    </div>
  );
}

function AuthorizationSignInButton({
  part,
}: {
  readonly part: EveAuthorizationPart;
}) {
  if (part.state !== "required") {
    return null;
  }

  const url = part.authorization?.url;

  if (!url) {
    return null;
  }

  return (
    <Button
      render={
        <a
          aria-label={`Sign in with ${part.displayName}`}
          href={url}
          rel="noreferrer"
          target="_blank"
        />
      }
      size="sm"
    >
      <ExternalLinkIcon />
      Sign in with {part.displayName}
    </Button>
  );
}

function authorizationTitle(part: EveAuthorizationPart): string {
  if (part.state === "required") return `Connect ${part.displayName}`;

  if (part.outcome === "authorized") return `${part.displayName} connected`;

  return `${part.displayName} authorization ${formatAuthorizationOutcome(part.outcome)}`;
}

function authorizationDescription(part: EveAuthorizationPart): string {
  if (part.state === "required") return part.description;

  if (part.outcome === "authorized") return `${part.displayName} connected.`;
  const tail = part.reason !== undefined ? ` (${part.reason})` : "";

  return `${part.displayName} authorization ${formatAuthorizationOutcome(part.outcome)}${tail}.`;
}

function formatAuthorizationOutcome(
  outcome: NonNullable<EveAuthorizationPart["outcome"]>
): string {
  switch (outcome) {
    case "authorized":
      return "authorized";
    case "declined":
      return "declined";
    case "failed":
      return "failed";
    case "timed-out":
      return "timed out";
  }

  throw new Error("Unsupported authorization outcome.");
}
