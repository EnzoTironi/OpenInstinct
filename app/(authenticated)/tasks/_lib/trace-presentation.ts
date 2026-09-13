import { z } from "zod";

const statusLabels = {
  cancelled: { label: "Cancelada", variant: "secondary" },
  error: { label: "Erro", variant: "destructive" },
  failure: { label: "Não concluída", variant: "warning" },
  running: { label: "Em andamento", variant: "information" },
  success: { label: "Concluída", variant: "success" },
} as const;
const traceStatusSchema = z.enum([
  "cancelled",
  "error",
  "failure",
  "running",
  "success",
]);

export function traceStatusLabel(status: string) {
  const parsed = traceStatusSchema.safeParse(status);
  return parsed.success
    ? statusLabels[parsed.data]
    : { label: status, variant: "secondary" as const };
}

export function formatTraceDuration(durationMs: number | null) {
  if (durationMs === null) return "—";
  if (durationMs < 1000) return "<1s";
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60)}s`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}
