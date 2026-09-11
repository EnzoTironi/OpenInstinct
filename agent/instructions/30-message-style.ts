import { resolveModeInstructions } from "@agent/lib/mode";
import { defineDynamic } from "eve/instructions";

import messageStyle from "./content/message-style.md?raw";

export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      resolveModeInstructions(context, {
        interactive: messageStyle,
        "scheduled-report": messageStyle,
      }),
  },
});
