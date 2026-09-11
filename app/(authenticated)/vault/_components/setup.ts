"use client";

import { parseVaultSetupSearchParams } from "@shared/vault/schema";
import { useSearchParams } from "next/navigation";

export function useVaultSetup() {
  const searchParams = useSearchParams();

  const requestedSetup = parseVaultSetupSearchParams(
    Object.fromEntries(searchParams.entries())
  );

  return requestedSetup.success ? requestedSetup.data : undefined;
}
