import { disableTool } from "eve/tools";

// Eve's provider-managed search cannot be selected by a dynamic tool resolver.
// Public web research uses the browser worker and its model-step authorization.
export default disableTool();
