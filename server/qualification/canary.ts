/**
 * Scan sanitized diagnostics for planted secret canaries. A hit means the
 * payload is not safe to export. Live traces, replays and screenshots stay
 * out of this checkout; this is the fixture contract.
 */
export function scanSecretCanaries(
  serialized: string,
  planted: readonly string[]
): readonly string[] {
  return planted.filter(
    (canary) => canary.length > 0 && serialized.includes(canary)
  );
}
