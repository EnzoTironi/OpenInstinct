import { defineMemory } from "eve/memory";
import { resolveProfileMemoryScope } from "../lib/profile-memory";
import { personalMemoryProvider } from "../lib/personal-memory-provider";

export default defineMemory({
  description:
    "Previously stored personal notes. When learned memory is available, use it for new facts. These older notes remain readable and removable so existing information is preserved.",
  provider: personalMemoryProvider,
  scope: resolveProfileMemoryScope,
});
