import type { SubagentStatus } from "@app/_lib/subagent-sessions";
import { Badge } from "@web/components/ui/badge";
import { useI18n } from "@web/i18n/context";

export function agentLabel(name: string) {
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

export function StatusIndicator({
  status,
}: {
  readonly status: SubagentStatus;
}) {
  const { t } = useI18n();
  const variant =
    status === "working" || status === "starting"
      ? "information"
      : status === "failed"
        ? "destructive"
        : status === "cancelled"
          ? "secondary"
          : "success";

  return <Badge variant={variant}>{t(status)}</Badge>;
}
