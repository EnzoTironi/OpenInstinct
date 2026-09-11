import type { SubagentStatus } from "@app/_lib/subagent-sessions";
import { Badge } from "@web/components/ui/badge";

export function agentLabel(name: string) {
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

const statusBadgeVariant = {
  cancelled: "secondary",
  complete: "success",
  failed: "destructive",
  ready: "success",
  starting: "information",
  working: "information",
} as const satisfies Record<
  SubagentStatus,
  "destructive" | "information" | "secondary" | "success"
>;

export function StatusIndicator({
  status,
}: {
  readonly status: SubagentStatus;
}) {
  return <Badge variant={statusBadgeVariant[status]}>{status}</Badge>;
}
