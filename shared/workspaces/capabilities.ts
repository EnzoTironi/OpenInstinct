import { Schema } from "effect";

export const workspacePlugins = [
  {
    id: "files",
    label: "Arquivos e skills",
    description: "Consultar seu conhecimento e seguir seus processos.",
  },
  {
    id: "memory",
    label: "Memória aprendida",
    description: "Lembrar do que importa para você neste espaço.",
  },
] as const;
export const WorkspaceCapabilitiesSchema = Schema.Struct({
  version: Schema.Literal(1),
  enabled: Schema.Array(Schema.Literals(["files", "memory"])).check(
    Schema.isMaxLength(2)
  ),
});
export const capabilitiesPath = "plugins/workspace.json";
export const defaultWorkspaceCapabilities: typeof WorkspaceCapabilitiesSchema.Type =
  { version: 1, enabled: ["files", "memory"] };
