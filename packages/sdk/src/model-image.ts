/**
 * One image a tool hands to the model (a screenshot the user let the AI see). It is not part of
 * the tool's output: the host takes it off the result before the result is shown, logged or
 * stored, and shows it to the model once, right after the tool results, as a transient message
 * that is never written to chat history. Honoured only for agent calls in a chat turn whose model
 * reads images (`TurnInfo.acceptsImages`); anywhere else the host drops it and returns an error.
 */
export type ModelImage = { data: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' };

/** The result key the host looks for. Plugins use `withModelImage`, not this key. */
export const MODEL_IMAGE_KEY = '__modelImage';

const MEDIA = new Set<string>(['image/jpeg', 'image/png', 'image/webp']);
/** Larger images are refused (base64 characters; ~3 MB decoded). */
export const MODEL_IMAGE_MAX_CHARS = 4_000_000;

/** `result` plus an image for the model. Use only behind a user opt-in (see `ModelImage`). */
export function withModelImage<T extends Record<string, unknown>>(result: T, image: ModelImage): T {
  return { ...result, [MODEL_IMAGE_KEY]: image };
}

/**
 * Split a tool result into what the model and UI see and the image (if any). A malformed image
 * is dropped. The returned output never contains the image.
 */
export function takeModelImage(result: unknown): { output: unknown; image?: ModelImage } {
  if (!result || typeof result !== 'object' || Array.isArray(result) || !(MODEL_IMAGE_KEY in result)) return { output: result };
  const { [MODEL_IMAGE_KEY]: raw, ...output } = result as Record<string, unknown>;
  const candidate = raw as Partial<ModelImage> | undefined;
  const valid = !!candidate && typeof candidate.data === 'string' && candidate.data.length > 0 && candidate.data.length <= MODEL_IMAGE_MAX_CHARS
    && typeof candidate.mediaType === 'string' && MEDIA.has(candidate.mediaType) && /^[A-Za-z0-9+/=]+$/.test(candidate.data);
  return valid ? { output, image: { data: candidate.data!, mediaType: candidate.mediaType as ModelImage['mediaType'] } } : { output };
}
