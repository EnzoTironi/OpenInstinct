import type { ToolDefinition } from "eve/tools";

// A heterogeneous catalog retains the owner schemas. Inputs and projections are
// callable only after their owning schema/implementation has established the type.
export type ExecutorTool = Pick<
  ToolDefinition<never, never>,
  "description" | "approval" | "toModelOutput"
> &
  Pick<ToolDefinition, "inputSchema" | "outputSchema"> & {
    /** Only host-validated, isolated computations may opt into Code Mode. */
    codeSafe?: boolean;
    // oxlint-disable-next-line anti-slop/no-unknown-returns -- Owner-specific outputs remain heterogeneous until the paired projection decodes them.
    execute: (...args: Parameters<ToolDefinition<never>["execute"]>) => unknown;
  };

export type ExecutorToolGroup = Readonly<
  Record<string, ExecutorTool | undefined>
>;
export type ExecutorCatalog = Readonly<Record<string, ExecutorTool>>;
