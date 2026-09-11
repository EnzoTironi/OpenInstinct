"use client";

import {
  ModelSelector as ModelSelectorRoot,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorShortcut,
  ModelSelectorTrigger,
} from "@web/components/ai-elements/model-selector";
import { Button } from "@web/components/ui/button";
import { api } from "@web/trpc/client";
import type { RouterOutputs } from "@web/trpc/types";
import { ChevronsUpDownIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type ModelCatalogItem = RouterOutputs["models"]["list"][number];

const priceFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
  style: "currency",
  currency: "USD",
});

function providerLogo(provider: string) {
  if (provider === "amazon") return "amazon-bedrock";

  if (provider === "meta") return "llama";

  if (provider === "spacexai") return "xai";

  return provider;
}

function formatPricing(model: ModelCatalogItem) {
  if (model.pricing?.input === undefined || model.pricing.output === undefined)
    return undefined;

  return `${priceFormatter.format(model.pricing.input)} / ${priceFormatter.format(model.pricing.output)} per M`;
}

function groupModelsByProvider(models: ModelCatalogItem[] | undefined) {
  const groups = new Map<string, ModelCatalogItem[]>();

  for (const model of models ?? []) {
    const providerModels = groups.get(model.ownedBy) ?? [];
    providerModels.push(model);
    groups.set(model.ownedBy, providerModels);
  }

  return [...groups.entries()].toSorted(([left], [right]) =>
    left.localeCompare(right)
  );
}

function resolveCatalogError(
  cause: unknown,
  selectFailed: boolean
): string | undefined {
  if (cause instanceof Error) return cause.message;

  if (selectFailed) return "Unable to update the workspace. Try again.";

  return undefined;
}

function emptyCatalogMessage(
  isFetching: boolean,
  catalogError: string | undefined
) {
  if (isFetching) return "Loading models…";

  return catalogError ?? "No matching models.";
}

function makeSelectSuccess(
  setOpen: (open: boolean) => void,
  refresh: () => void
) {
  return () => {
    setOpen(false);
    refresh();
  };
}

function ModelPricing({ model }: { readonly model: ModelCatalogItem }) {
  const pricing = formatPricing(model);

  if (!pricing) return null;

  return <ModelSelectorShortcut>{pricing}</ModelSelectorShortcut>;
}

function ModelCatalogItemRow({
  model,
  selectedModelId,
  onSelect,
}: {
  readonly model: ModelCatalogItem;
  readonly selectedModelId: string;
  readonly onSelect: (modelId: string) => void;
}) {
  return (
    <ModelSelectorItem
      data-checked={model.id === selectedModelId}
      key={model.id}
      onSelect={() => {
        onSelect(model.id);
      }}
      value={`${model.name} ${model.id} ${model.ownedBy}`}
    >
      <ModelSelectorLogo provider={providerLogo(model.ownedBy)} />
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate">{model.name}</span>
        <span className="block truncate type-caption text-muted-foreground">
          {model.id}
        </span>
      </span>
      <ModelPricing model={model} />
    </ModelSelectorItem>
  );
}

function ModelCatalogGroups({
  groupedModels,
  selectedModelId,
  onSelect,
}: {
  readonly groupedModels: readonly [string, ModelCatalogItem[]][];
  readonly selectedModelId: string;
  readonly onSelect: (modelId: string) => void;
}) {
  return groupedModels.map(([provider, providerModels]) => (
    <ModelSelectorGroup heading={provider} key={provider}>
      {providerModels.map((model) => (
        <ModelCatalogItemRow
          key={model.id}
          model={model}
          onSelect={onSelect}
          selectedModelId={selectedModelId}
        />
      ))}
    </ModelSelectorGroup>
  ));
}

export function ModelSelector({ modelId }: { readonly modelId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const catalog = api.models.list.useQuery(undefined, {
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const selectModel = api.settings.selectModel.useMutation({
    onSuccess: makeSelectSuccess(setOpen, () => {
      router.refresh();
    }),
  });

  const groupedModels = useMemo(
    () => groupModelsByProvider(catalog.data),
    [catalog.data]
  );

  const catalogError = resolveCatalogError(
    catalog.error,
    Boolean(selectModel.error)
  );

  return (
    <ModelSelectorRoot onOpenChange={setOpen} open={open}>
      <ModelSelectorTrigger
        render={
          <Button
            disabled={selectModel.isPending}
            size="sm"
            type="button"
            variant="outline"
          />
        }
      >
        <ModelSelectorLogo
          provider={providerLogo(modelId.split("/", 1)[0] ?? modelId)}
        />
        Choose
        <ChevronsUpDownIcon />
      </ModelSelectorTrigger>
      <ModelSelectorContent
        className="sm:max-w-xl"
        showCloseButton={false}
        title="Choose a model"
      >
        <ModelSelectorInput placeholder="Search models…" />
        <ModelSelectorList className="max-h-[min(32rem,70vh)]">
          <ModelSelectorEmpty className="px-3 text-left text-muted-foreground">
            {emptyCatalogMessage(catalog.isFetching, catalogError)}
          </ModelSelectorEmpty>
          <ModelCatalogGroups
            groupedModels={groupedModels}
            onSelect={(selectedModelId) => {
              selectModel.mutate({ modelId: selectedModelId });
            }}
            selectedModelId={modelId}
          />
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelectorRoot>
  );
}
