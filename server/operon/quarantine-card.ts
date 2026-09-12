import { z } from "zod";
import { offerCopy, quarantineCardMessage } from "./copy";

const emailRegisterApprovalInput = z.object({
  card: z.string().min(1),
  viewedDigest: z.string().length(64),
});

export function renderEmailRegisterApproval(input: unknown) {
  const { card, viewedDigest } = emailRegisterApprovalInput.parse(input);
  return quarantineCardMessage(card, viewedDigest);
}

export function renderEmailRegisterCard(input: unknown) {
  const { card, viewedDigest } = emailRegisterApprovalInput.parse(input);
  return `${card}\n\n${viewedDigest}`;
}

export function approvalOptionLabel(
  toolName: string,
  option: { readonly id: string; readonly label: string }
) {
  if (toolName === "email-register" && option.id === "approve") {
    return offerCopy;
  }
  return option.label;
}
