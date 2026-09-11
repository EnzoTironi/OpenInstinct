/* oxlint-disable anti-slop/no-object-parameters, typescript/no-unsafe-type-assertion --
 * Bridge for native/provider tool maps that erase `execute` input to `never`.
 */
/**
 * Call an erased tool map entry without asserting each payload to `never`.
 */
export function executeErasedTool<R>(
  tool: { readonly execute: (input: never, context: never) => R },
  input: object,
  context: object
): R {
  // SAFETY: Tool maps type `execute` as `(never, never) => R` after erasure.
  // Callers pass structurally valid tool inputs; the tool validates at runtime.
  const run = tool.execute as (input: object, context: object) => R;

  return run(input, context);
}
