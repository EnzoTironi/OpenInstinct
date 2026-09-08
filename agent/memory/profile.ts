import { defineMemory } from "eve/memory";
import { fileMemory } from "eve/memory/file";
import { memoryDocumentBackend } from "../lib/memory-document-backend";
import {
  preserveProfileMemoryCancellation,
  resolveProfileMemoryScope,
} from "../lib/profile-memory";
const provider = preserveProfileMemoryCancellation(
  fileMemory({ backend: memoryDocumentBackend })
);

export default defineMemory({
  description: "Remember stable facts and preferences about the current user.",
  provider,
  scope: resolveProfileMemoryScope,
});
