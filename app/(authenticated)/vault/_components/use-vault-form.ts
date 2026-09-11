"use client";

import { api } from "@web/trpc/client";
import { useRouter } from "next/navigation";
import {
  type Dispatch,
  type SetStateAction,
  type SubmitEvent,
  useCallback,
} from "react";
import { type ZodSafeParseResult, z } from "zod";

export function vaultFormErrors<Output>(
  attempted: boolean,
  result: ZodSafeParseResult<Output>
): Partial<Record<string, string[]>> {
  if (!attempted) return {};

  if (result.success) return {};

  return z.flattenError(result.error).fieldErrors;
}

export function patchVaultForm<Form extends object, Key extends keyof Form>(
  setForm: Dispatch<SetStateAction<Form>>,
  key: Key,
  value: Form[Key]
) {
  setForm((current) => ({ ...current, [key]: value }));
}

export function useVaultItemCreate(onSaved: () => void) {
  const router = useRouter();

  const onSuccess = useCallback(() => {
    router.refresh();
    onSaved();
  }, [onSaved, router]);

  return api.vault.create.useMutation({ onSuccess });
}

export function useVaultFormSubmit<Output, Payload>(
  setAttempted: (value: boolean) => void,
  result: ZodSafeParseResult<Output>,
  mutate: (payload: Payload) => void,
  toPayload: (data: Output) => Payload | undefined
) {
  return useCallback(
    (event: SubmitEvent<HTMLFormElement>) => {
      event.preventDefault();
      setAttempted(true);

      if (!result.success) return;
      const payload = toPayload(result.data);

      if (payload === undefined) return;
      mutate(payload);
    },
    [mutate, result, setAttempted, toPayload]
  );
}
