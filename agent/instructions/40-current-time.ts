import { currentTimeInstructions } from "@agent/lib/current-time";
import { defineDynamic } from "eve/instructions";

export default defineDynamic({
  events: {
    "turn.started": () => currentTimeInstructions(),
  },
});
