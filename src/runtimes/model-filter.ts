const NON_GENERATIVE_MODEL_MARKERS = [
  "embed",
  "embedding",
  "rerank",
  "cross-encoder",
] as const;

/**
 * Local model endpoints commonly return both chat models and auxiliary
 * embedding/reranking models from the same `/models` or `/api/tags` listing.
 * The latter are not valid candidates for a text-generation agent and must
 * not be sent through the capability probe or coding router.
 */
export function isGenerativeModelId(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  return (
    normalized.length > 0 &&
    !NON_GENERATIVE_MODEL_MARKERS.some((marker) => normalized.includes(marker))
  );
}
