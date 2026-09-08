import { defineDynamic } from "eve/instructions";
import { currentTimeInstructions } from "@agent/lib/current-time";

export default defineDynamic({
  events: {
    "turn.started": () => currentTimeInstructions(),
  },
});
