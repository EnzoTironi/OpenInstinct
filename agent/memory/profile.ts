import { defineMemory } from "eve/memory";
import { resolveProfileMemoryScope } from "../lib/profile-memory";
import { personalMemoryProvider } from "../lib/personal-memory-provider";

export default defineMemory({
  description: "Remember stable facts and preferences about the current user.",
  provider: personalMemoryProvider,
  scope: resolveProfileMemoryScope,
});
