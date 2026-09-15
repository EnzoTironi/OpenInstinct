import { Schema } from "effect";
import type { WorkspaceCapabilitiesSchema } from "@shared/workspaces/capabilities";

export const conversationChannelSchema = Schema.Literals([
  "eve",
  "linq",
  "telegram",
  "kapso",
  "matrix",
]);

type ConversationChannel = typeof conversationChannelSchema.Type;

interface HostCapabilityState {
  readonly channel: ConversationChannel | undefined;
  readonly enabledPlugins: typeof WorkspaceCapabilitiesSchema.Type.enabled;
  readonly googleAccountLabels: readonly string[];
}

export function composeCapabilityStateInstructions(state: HostCapabilityState) {
  const labels = state.googleAccountLabels
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
  const googleEnabled = state.enabledPlugins.includes("google");
  const googleState = googleAccountState(googleEnabled, labels);
  const plugins =
    state.enabledPlugins.length === 0
      ? "none"
      : state.enabledPlugins.join(", ");
  return [
    "Live host capability state for this turn. Treat this list as the account and plugin truth. Saved memory, MEMORY.md, profile notes and earlier conversation are not proof that a connection exists.",
    `Current channel: ${describeChannel(state.channel)}. Channel presentation does not grant another capability.`,
    `Enabled workspace plugins: ${plugins}.`,
    googleState,
    "Tone or style feedback may change presentation. It never rewrites grants, publication, egress, tool limits or host policy.",
    "Visible replies use this host's assistant output and send_message. Ordinary plaintext is not a private side channel.",
    "Match reply length to the task. There is no global two- or three-sentence cap.",
  ].join("\n");
}

function googleAccountState(googleEnabled: boolean, labels: readonly string[]) {
  if (!googleEnabled) {
    return "Google Workspace is not enabled in this workspace this turn. Do not promise Gmail, Calendar or Contacts, and do not treat remembered connection text as live account state.";
  }
  if (labels.length === 0) {
    return "Google Workspace is enabled, but no Google account is connected in this workspace this turn. Do not promise Gmail, Calendar or Contacts until a connection exists.";
  }
  return `Google Workspace is connected this turn for: ${labels
    .map((label) => JSON.stringify(label))
    .join(
      ", "
    )}. Use only these accounts. Do not silently pick another account.`;
}

function describeChannel(channel: ConversationChannel | undefined) {
  switch (channel) {
    case "eve":
      return "web chat";
    case "telegram":
    case "linq":
      return "Telegram";
    case "kapso":
      return "WhatsApp";
    case "matrix":
      return "Matrix";
    case undefined:
      return "the current authenticated channel";
    default: {
      const exhaustive: never = channel;
      throw new Error(`Unhandled channel: ${String(exhaustive)}`);
    }
  }
}
