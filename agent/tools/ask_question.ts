import { askQuestion } from "eve/tools/ask_question";
import { channelQuestionSchema } from "../lib/channel-input";
import { defineDynamic } from "eve/tools";
import { resolveModeValue } from "../lib/mode";

// Configure the public native definition once; copying it loses Eve's native behavior.
askQuestion.inputSchema = channelQuestionSchema;

export { askQuestion };
export default defineDynamic({
  events: {
    "turn.started": (_event, context) =>
      resolveModeValue(context, {
        interactive: askQuestion,
        "scheduled-worker": askQuestion,
      }),
  },
});
