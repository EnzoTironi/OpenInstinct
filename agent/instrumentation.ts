import { defineEvlogInstrumentation } from "evlog/eve";

export default defineEvlogInstrumentation({
  recordInputs: false,
  recordOutputs: false,
  traceChannelRequests: true,
});
