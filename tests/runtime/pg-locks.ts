import { setTimeout as pause } from "node:timers/promises";

import type { Client } from "pg";

export async function waitForBlocked(
  sql: Client,
  blocker: number,
  pattern: string
) {
  const deadline = Date.now() + 5000;

  // Each observation waits for the preceding SQL snapshot; parallel polling cannot establish lock order.
  /* oxlint-disable eslint/no-await-in-loop */
  while (Date.now() < deadline) {
    const result = await sql.query<{ pid: number }>(
      "SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)) AND query LIKE $2",
      [blocker, pattern]
    );

    const [blocked] = result.rows;

    if (blocked) return blocked.pid;
    await pause(20);
  }

  /* oxlint-enable eslint/no-await-in-loop */
  throw new Error(`Expected blocked SQL operation: ${pattern}`);
}
