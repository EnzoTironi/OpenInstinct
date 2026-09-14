"use client";

import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";

export function MessageFeedback({ messageId }: { readonly messageId: string }) {
  const { t } = useI18n();
  const params = useParams<{ sessionId: string }>();
  const workspace = useSearchParams().get("space");
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const submit = async (value: "up" | "down") => {
    setBusy(true);
    setError(false);
    try {
      const headers = new Headers({ "content-type": "application/json" });
      if (workspace) headers.set("x-zoen-workspace", workspace);
      const response = await fetch("/api/observability", {
        method: "POST",
        headers,
        body: JSON.stringify({
          recordingId: crypto.randomUUID(),
          batchId: crypto.randomUUID(),
          kind: "feedback",
          route: "/chat/:session",
          sessionId: params.sessionId,
          data: JSON.stringify({ messageId, rating: value }),
        }),
      });
      if (!response.ok) throw new Error("Feedback unavailable");
      setRating(value);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-1 flex items-center gap-1">
      <Button
        aria-label={t("Ajudou")}
        aria-pressed={rating === "up"}
        variant="ghost"
        size="icon"
        disabled={busy}
        onClick={() => void submit("up")}
      >
        <ThumbsUpIcon size={14} />
      </Button>
      <Button
        aria-label={t("Pode melhorar")}
        aria-pressed={rating === "down"}
        variant="ghost"
        size="icon"
        disabled={busy}
        onClick={() => void submit("down")}
      >
        <ThumbsDownIcon size={14} />
      </Button>
      {error && (
        <span role="alert" className="type-caption">
          {t("Tente novamente.")}
        </span>
      )}
    </div>
  );
}
