import { defineMemory } from "eve/memory";

import { personalMemoryProvider } from "../lib/personal-memory-provider";
import { resolveProfileMemoryScope } from "../lib/profile-memory";

export default defineMemory({
  description: "Remember stable facts and preferences about the current user.",
  provider: personalMemoryProvider,
  scope: resolveProfileMemoryScope,
});
