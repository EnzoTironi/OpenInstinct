import { defineEvlogHook } from "evlog/eve";

export default defineEvlogHook({
  init: {
    env: { service: "zoen" },
    redact: true,
  },
  message: "omit",
  redact: true,
  sessionEvent: true,
});
