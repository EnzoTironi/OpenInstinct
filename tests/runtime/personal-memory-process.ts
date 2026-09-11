import { Effect, Result, Schema } from "effect";

import { db } from "../../db";
import { inspectPersonalMemory } from "../../server/personal-memory/export";
import { serverRuntime } from "../../server/runtime";

const decodeSyncSchema = Schema.decodeUnknownSync(Schema.Uint8Array);

const chunks: Buffer[] = [];

for await (const chunk of process.stdin)
  chunks.push(Buffer.from(decodeSyncSchema(chunk)));

const cookie = Buffer.concat(chunks).toString("utf8");

try {
  const result = await serverRuntime.runPromise(
    inspectPersonalMemory(new Headers({ cookie })).pipe(Effect.result)
  );

  process.stdout.write(
    JSON.stringify(
      Result.isSuccess(result)
        ? { status: "Success", snapshot: result.success }
        : { status: "Failure", reason: result.failure.reason }
    )
  );
} finally {
  await serverRuntime.dispose();
  await db.$client.end();
}
