import path from "node:path";

import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import { isStringLiteral } from "../../shared/literals.ts";

const productionLayers = ["agent", "app", "db", "shared", "web"] as const;

type ProductionLayer = (typeof productionLayers)[number];

const moduleMockMethods = new Set(["doMock", "mock", "unstable_mockModule"]);

const forbiddenDependencies = {
  agent: new Set<ProductionLayer>(["app", "web"]),
  app: new Set<ProductionLayer>(["agent"]),
  db: new Set<ProductionLayer>(["agent", "app", "web"]),
  shared: new Set<ProductionLayer>(["agent", "app", "db", "web"]),
  web: new Set<ProductionLayer>(["agent", "app"]),
} satisfies Record<ProductionLayer, ReadonlySet<ProductionLayer>>;

function productionLayerForPath(
  filePath: string,
  repositoryRoot: string
): ProductionLayer | undefined {
  const normalizedPath = path.resolve(filePath);

  if (normalizedPath === path.join(repositoryRoot, "proxy.ts")) return "web";

  const relativePath = path.relative(repositoryRoot, normalizedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return undefined;
  }

  const [root] = relativePath.split(path.sep);

  return productionLayers.find((candidate) => candidate === root);
}

function importedProductionLayer(
  importer: string,
  source: string,
  repositoryRoot: string
): ProductionLayer | undefined {
  if (source.startsWith(".")) {
    return productionLayerForPath(
      path.resolve(path.dirname(importer), source),
      repositoryRoot
    );
  }

  const match = /^@(agent|app|db|shared|web)(?:\/(.*))?$/u.exec(source);
  const aliasRoot = match?.[1];

  if (!aliasRoot) return undefined;

  return productionLayerForPath(
    path.resolve(repositoryRoot, `${aliasRoot}/${match[2] ?? ""}`),
    repositoryRoot
  );
}

const isMockRunnerIdentifier = (name: string) => {
  if (name === "vi") return true;

  return name === "jest";
};

const isModuleMockCallee = (callee: ESTree.CallExpression["callee"]) => {
  if (!("object" in callee)) return false;

  if (!("property" in callee)) return false;

  if (!("computed" in callee)) return false;

  if (callee.object.type !== "Identifier") return false;

  return isMockRunnerIdentifier(callee.object.name);
};

const moduleMockMethodName = (callee: ESTree.MemberExpression) => {
  if (callee.computed) {
    if (!isStringLiteral(callee.property)) return undefined;

    return callee.property.value;
  }

  if (callee.property.type !== "Identifier") return undefined;

  return callee.property.name;
};

const moduleMockSourceArgument = (node: ESTree.CallExpression) => {
  const [source] = node.arguments;

  if (!source) return undefined;

  if (!isStringLiteral(source)) return undefined;

  return source;
};

function moduleMockSource(
  node: ESTree.CallExpression
): ESTree.Node | undefined {
  const callee = node.callee;

  if (!isModuleMockCallee(callee)) return undefined;

  const method = moduleMockMethodName(callee);

  if (!method) return undefined;

  if (!moduleMockMethods.has(method)) return undefined;

  return moduleMockSourceArgument(node);
}

interface LayerImportState {
  context: {
    readonly cwd: string;
    readonly filename: string;
    report: (input: {
      readonly node: ESTree.Node;
      readonly messageId: "forbiddenImport";
      readonly data: { readonly owner: string; readonly dependency: string };
    }) => void;
  };
  repositoryRoot: string;
  importer: string;
  owner: ProductionLayer | undefined;
}

function checkLayerImport(
  state: LayerImportState,
  node: ESTree.Node,
  source: string
) {
  if (!state.owner) return;

  const dependency = importedProductionLayer(
    state.importer,
    source,
    state.repositoryRoot
  );

  if (!dependency) return;

  if (!forbiddenDependencies[state.owner].has(dependency)) return;

  state.context.report({
    node,
    messageId: "forbiddenImport",
    data: { owner: state.owner, dependency },
  });
}

function makeLayerImportHandlers(context: LayerImportState["context"]) {
  const state: LayerImportState = {
    context,
    repositoryRoot: "",
    importer: "",
    owner: undefined,
  };

  return {
    before: () => {
      state.repositoryRoot = path.resolve(context.cwd);
      state.importer = path.resolve(context.filename);
      state.owner = productionLayerForPath(
        state.importer,
        state.repositoryRoot
      );
    },
    ExportAllDeclaration: (node: ESTree.ExportAllDeclaration) => {
      checkLayerImport(state, node.source, node.source.value);
    },
    ExportNamedDeclaration: (node: ESTree.ExportNamedDeclaration) => {
      if (!node.source) return;
      checkLayerImport(state, node.source, node.source.value);
    },
    ImportDeclaration: (node: ESTree.ImportDeclaration) => {
      checkLayerImport(state, node.source, node.source.value);
    },
    ImportExpression: (node: ESTree.ImportExpression) => {
      if (!isStringLiteral(node.source)) return;
      checkLayerImport(state, node.source, node.source.value);
    },
    CallExpression: (node: ESTree.CallExpression) => {
      const source = moduleMockSource(node);

      if (!source) return;

      if (!isStringLiteral(source)) return;
      checkLayerImport(state, source, source.value);
    },
  };
}

export const noForbiddenLayerImportsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Keep production dependencies directed away from agent and web ownership toward shared contracts and persistence.",
    },
    messages: {
      forbiddenImport:
        "{{owner}} cannot import {{dependency}} under the repository dependency direction.",
    },
    schema: [],
  },
  createOnce(context) {
    return makeLayerImportHandlers(context);
  },
});
