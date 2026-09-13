"use client";

import { useState } from "react";
import { Schema } from "effect";
import type { OntologySchema } from "@shared/workspaces/ontology";
import { useI18n } from "@web/i18n/context";
import { Button } from "@web/components/ui/button";
import { Input } from "@web/components/ui/input";
import styles from "../space.module.css";

type Graph = typeof OntologySchema.Type;
export function OntologyValueField({
  property,
  name = "value",
}: {
  property: Graph["types"][number]["properties"][number];
  name?: string;
}) {
  const { t } = useI18n();
  return property.type === "boolean" ? (
    <select
      name={name}
      aria-label={t(property.name)}
      className={styles.row}
      required={property.required}
    >
      <option value="false">{t("Não")}</option>
      <option value="true">{t("Sim")}</option>
    </select>
  ) : (
    <Input
      name={name}
      type={
        property.type === "number"
          ? "number"
          : property.type === "date"
            ? "date"
            : "text"
      }
      step={property.type === "number" ? "any" : undefined}
      aria-label={t(property.name)}
      placeholder={t(property.name)}
      required={property.required}
    />
  );
}
export function OntologyEntityForm({
  graph,
  pending,
  onSave,
}: {
  graph: Graph;
  pending: boolean;
  onSave: (graph: Graph) => Promise<void>;
}) {
  const { t } = useI18n();
  const [typeId, setTypeId] = useState(graph.types[0]?.id ?? "");
  const type = graph.types.find((entry) => entry.id === typeId);
  return (
    <form
      className={styles.create}
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const properties = Object.fromEntries(
          (type?.properties ?? []).flatMap((property) => {
            const value = Schema.decodeUnknownSync(Schema.String)(
              values.get(property.id) ?? ""
            );
            return value === ""
              ? []
              : [
                  [
                    property.id,
                    property.type === "number"
                      ? Number(value)
                      : property.type === "boolean"
                        ? value === "true"
                        : value,
                  ],
                ];
          })
        );
        void onSave({
          ...graph,
          entities: [
            ...graph.entities,
            {
              id: `e_${crypto.randomUUID()}`,
              name: Schema.decodeUnknownSync(Schema.String)(
                values.get("name")
              ).trim(),
              type: typeId,
              properties,
              sources: [],
            },
          ],
        }).catch(() => undefined);
      }}
    >
      <Input
        name="name"
        aria-label={t("Nome")}
        placeholder={t("Nome")}
        maxLength={120}
        required
      />
      <select
        value={typeId}
        onChange={(event) => {
          setTypeId(event.target.value);
        }}
        aria-label={t("Tipo")}
        className={styles.row}
      >
        {graph.types.map((entry) => (
          <option value={entry.id} key={entry.id}>
            {t(entry.name)}
          </option>
        ))}
      </select>
      {type?.properties.map((property) => (
        <OntologyValueField
          key={`${typeId}:${property.id}`}
          property={property}
          name={property.id}
        />
      ))}
      <Button type="submit" disabled={pending || !type}>
        {t("Salvar")}
      </Button>
    </form>
  );
}

export function OntologyRelations({
  entity,
  graph,
  pending,
  onSave,
}: {
  entity: Graph["entities"][number];
  graph: Graph;
  pending: boolean;
  onSave: (graph: Graph) => Promise<void>;
}) {
  const { t } = useI18n();
  const relations = graph.relations.filter(
    (relation) => relation.from === entity.type
  );
  const [relationId, setRelationId] = useState(relations[0]?.id ?? "");
  const relation = relations.find((entry) => entry.id === relationId);
  const targets = graph.entities.filter(
    (target) => target.type === relation?.to && target.id !== entity.id
  );
  if (!relations.length) return null;
  return (
    <details>
      <summary className={styles.row}>{t("Conectar ideias")}</summary>
      <form
        className={styles.create}
        onSubmit={(event) => {
          event.preventDefault();
          const target = Schema.decodeUnknownSync(Schema.String)(
            new FormData(event.currentTarget).get("target")
          );
          const link = { type: relationId, from: entity.id, to: target };
          if (
            !graph.links.some(
              (entry) =>
                entry.type === link.type &&
                entry.from === link.from &&
                entry.to === link.to
            )
          )
            void onSave({ ...graph, links: [...graph.links, link] }).catch(
              () => undefined
            );
        }}
      >
        <select
          value={relationId}
          aria-label={t("Relação")}
          onChange={(event) => {
            setRelationId(event.target.value);
          }}
          className={styles.row}
        >
          {relations.map((entry) => (
            <option value={entry.id} key={entry.id}>
              {t(entry.name)}
            </option>
          ))}
        </select>
        <select
          name="target"
          aria-label={t("Conectar com")}
          className={styles.row}
          key={relationId}
          required
        >
          {targets.map((target) => (
            <option value={target.id} key={target.id}>
              {target.name}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={pending || !targets.length}>
          {t("Conectar")}
        </Button>
      </form>
    </details>
  );
}
