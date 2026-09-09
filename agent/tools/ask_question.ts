import { askQuestion } from "eve/tools/ask_question";
import { channelQuestionSchema } from "../lib/channel-input";

// Configure the public native definition once; copying it loses Eve's native behavior.
askQuestion.inputSchema = channelQuestionSchema;

export default askQuestion;
