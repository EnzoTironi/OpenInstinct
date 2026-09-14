import { type LanguageModel, wrapLanguageModel } from "ai";
import { Predicate } from "effect";

/** Bound one provider request, including its response stream; Eve owns retries. */
export function withModelDeadline(model: LanguageModel): LanguageModel {
  if (Predicate.isString(model)) return model;
  return wrapLanguageModel({
    model,
    middleware: {
      transformParams: async ({ params }) => ({
        ...params,
        abortSignal: AbortSignal.any([
          AbortSignal.timeout(90_000),
          ...(params.abortSignal ? [params.abortSignal] : []),
        ]),
      }),
    },
  });
}
