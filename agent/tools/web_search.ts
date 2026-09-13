import { webSearch } from "eve/tools/web_search";
import { defineDynamic } from "eve/tools";
import { resolveModeValue } from "../lib/mode";
export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      resolveModeValue(context, {
        interactive: webSearch,
        "scheduled-worker": webSearch,
      }),
  },
});
