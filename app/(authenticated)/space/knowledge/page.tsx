"use client";

import { useState } from "react";
import { NetworkIcon, PlusIcon } from "lucide-react";
import { Exit, Schema } from "effect";
import { api } from "@web/trpc/client";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { Input } from "@web/components/ui/input";
import { Textarea } from "@web/components/ui/textarea";
import { OntologySchema } from "@shared/workspaces/ontology";
import { OntologySources } from "./sources";
import {
  OntologyEntityForm,
  OntologyRelations,
  OntologyValueField,
} from "./entity-form";
import { PanelIntro } from "../../_components/panel-intro";
import panel from "../../_components/panel.module.css";
import styles from "../space.module.css";

export default function WorkspaceKnowledgePage() {
  const { t } = useI18n();
  const state = api.workspaces.ontology.read.useQuery();
  const publish = api.workspaces.ontology.publish.useMutation();
  const act = api.workspaces.ontology.act.useMutation();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [parseError, setParseError] = useState(false);
  const graph = state.data?.graph;
  const save = (next: typeof OntologySchema.Type) =>
    publish
      .mutateAsync({
        graph: next,
        expectedRevision: state.data?.revision ?? null,
        operationId: crypto.randomUUID(),
      })
      .then(async () => {
        await state.refetch();
        return undefined;
      });
  return (
    <div className={panel.page}>
      <PanelIntro
        image="/marketing/panel/zoen-memory.png"
        title={t("Suas ideias se conectam.")}
      />
      <Input
        aria-label={t("Buscar conhecimento")}
        placeholder={t("Buscar conhecimento")}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      {(parseError || Boolean(state.error ?? publish.error ?? act.error)) && (
        <p role="alert" className={styles.error}>
          {t(
            "Confira os dados e a versão antes de salvar. Seu rascunho foi preservado."
          )}
        </p>
      )}
      <div className={styles.list}>
        {graph?.entities
          .filter((entity) =>
            `${entity.name} ${entity.type}`
              .toLowerCase()
              .includes(query.toLowerCase())
          )
          .map((entity) => (
            <details key={entity.id}>
              <summary className={styles.row}>
                <NetworkIcon />
                <span>
                  {entity.name}
                  <small>
                    {t(
                      graph.types.find((type) => type.id === entity.type)
                        ?.name ?? entity.type
                    )}
                  </small>
                </span>
              </summary>
              <div className={styles.create}>
                {Object.entries(entity.properties).map(([key, value]) => (
                  <p key={key}>
                    {t(key === "status" ? "Status" : key)}:{" "}
                    {String(value ?? "—")}
                  </p>
                ))}
                {graph.links
                  .filter(
                    (link) => link.from === entity.id || link.to === entity.id
                  )
                  .map((link) => (
                    <p key={`${link.type}:${link.from}:${link.to}`}>
                      {t(
                        graph.relations.find(
                          (relation) => relation.id === link.type
                        )?.name ?? link.type
                      )}{" "}
                      ·{" "}
                      {
                        graph.entities.find(
                          (item) =>
                            item.id ===
                            (link.from === entity.id ? link.to : link.from)
                        )?.name
                      }
                    </p>
                  ))}
                <OntologySources
                  entity={entity}
                  graph={graph}
                  mayManage={!!state.data?.mayManage}
                  pending={publish.isPending}
                  onSave={save}
                />
                {state.data?.mayManage && (
                  <OntologyRelations
                    entity={entity}
                    graph={graph}
                    pending={publish.isPending}
                    onSave={save}
                  />
                )}
                {state.data?.mayManage &&
                  graph.actions
                    .filter((action) => action.entityType === entity.type)
                    .map((action) => (
                      <form
                        key={action.id}
                        onSubmit={(event) => {
                          event.preventDefault();
                          const value = Schema.decodeUnknownSync(Schema.String)(
                            new FormData(event.currentTarget).get("value")
                          );
                          const property = graph.types
                            .find((type) => type.id === entity.type)
                            ?.properties.find(
                              (item) => item.id === action.property
                            );
                          void act
                            .mutateAsync({
                              entityId: entity.id,
                              actionId: action.id,
                              value:
                                property?.type === "number"
                                  ? Number(value)
                                  : property?.type === "boolean"
                                    ? value === "true"
                                    : value,
                              operationId: crypto.randomUUID(),
                              expectedRevision: state.data.revision,
                            })
                            .then(() => state.refetch())
                            .catch(() => undefined);
                        }}
                      >
                        <OntologyValueField
                          property={
                            graph.types
                              .find((type) => type.id === entity.type)
                              ?.properties.find(
                                (property) => property.id === action.property
                              ) ?? {
                              id: action.property,
                              name: action.name,
                              type: "string",
                              required: true,
                            }
                          }
                        />
                        <Button
                          type="submit"
                          variant="secondary"
                          disabled={act.isPending}
                        >
                          {t(action.name)}
                        </Button>
                      </form>
                    ))}
              </div>
            </details>
          ))}
      </div>
      {graph?.entities.length === 0 && (
        <p className={styles.empty}>
          {t("Pessoas, projetos e decisões. Veja como tudo se relaciona.")}
        </p>
      )}
      {state.data?.mayManage && (
        <>
          <Button
            variant="secondary"
            onClick={() => {
              setAdding(!adding);
            }}
          >
            <PlusIcon />
            {t("Adicionar")}
          </Button>
          {adding && graph && (
            <OntologyEntityForm
              graph={graph}
              pending={publish.isPending}
              onSave={(next) =>
                save(next).then(() => {
                  setAdding(false);
                  return undefined;
                })
              }
            />
          )}
          {graph && (
            <details>
              <summary className={styles.row}>
                {t("Estrutura e relações")}
              </summary>
              <form
                className={styles.create}
                key={state.data.revision}
                onSubmit={(event) => {
                  event.preventDefault();
                  setParseError(false);
                  const parsed = Schema.decodeUnknownExit(
                    Schema.fromJsonString(OntologySchema)
                  )(
                    Schema.decodeUnknownSync(Schema.String)(
                      new FormData(event.currentTarget).get("graph")
                    )
                  );
                  if (Exit.isFailure(parsed)) {
                    setParseError(true);
                    return;
                  }
                  void save(parsed.value).catch(() => undefined);
                }}
              >
                <Textarea
                  name="graph"
                  aria-label={t("Estrutura e relações")}
                  defaultValue={JSON.stringify(graph, null, 2)}
                  rows={14}
                />
                <Button type="submit" disabled={publish.isPending}>
                  {t("Salvar estrutura")}
                </Button>
              </form>
            </details>
          )}
        </>
      )}
    </div>
  );
}
