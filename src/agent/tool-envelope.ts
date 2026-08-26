/**
 * Backward-compatible agent import. Textual provider envelopes are parsed at
 * the provider boundary in `src/providers/tool-envelope.ts`; existing probe
 * and test callers may continue importing this stable path.
 */
export {
  MAX_TOOL_CALLS_PER_RESPONSE,
  recoverTextToolCalls,
} from "../providers/tool-envelope.js";
