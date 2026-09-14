import { expect, test } from "vitest";
import { rankCatalog } from "./search";

const catalog = [
  { path: "calendar-list-events", description: "Read calendar events." },
  {
    path: "workspace.ontology.read",
    description:
      "Read workspace projects, current status and declared actions.",
  },
  { path: "skills/release-es.md", description: "Release verification" },
  { path: "skills/release-en.md", description: "Release verification" },
];

test("finds a capability from a natural-language request containing unknown entity names", () => {
  expect(
    rankCatalog(catalog, "project status active Beta release")[0]?.path
  ).toBe("workspace.ontology.read");
  expect(rankCatalog(catalog, "read project status")[0]?.path).toBe(
    "workspace.ontology.read"
  );
});

test("ranks exact skill paths first without losing pagination candidates", () => {
  expect(rankCatalog(catalog, "release-en").map((item) => item.path)).toEqual([
    "skills/release-en.md",
    "skills/release-es.md",
  ]);
  expect(rankCatalog(catalog, "nonsenseunavailable")).toEqual([]);
  expect(rankCatalog(catalog, "")).toHaveLength(catalog.length);
});

test("finds accented catalog text with unaccented queries", () => {
  expect(
    rankCatalog(
      [{ path: "skills/reuniao.md", description: "Preparar reuniões" }],
      "reunioes"
    )
  ).toHaveLength(1);
});
