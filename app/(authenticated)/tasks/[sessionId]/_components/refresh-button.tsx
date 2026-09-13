"use client";

import { useI18n } from "@web/i18n/context";

import { RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@web/components/ui/button";

export function RefreshButton() {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      aria-label={t("Atualizar atividade")}
      disabled={pending}
      onClick={() => {
        startTransition(() => {
          router.refresh();
        });
      }}
      size="icon"
      type="button"
      variant="outline"
    >
      <RefreshCwIcon
        aria-hidden="true"
        className={pending ? "animate-spin" : undefined}
      />
    </Button>
  );
}
