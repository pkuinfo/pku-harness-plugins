/**
 * Errors as `errorBody` responses (`@pku-harness/cloud-protocol`). Route code throws
 * `HttpError`; the app's error handler turns it into JSON. Messages are fixed strings chosen
 * here — never echo request content (parser messages can quote the input).
 */
import type { ErrorBody, WireErrorCode } from '@pku-harness/cloud-protocol';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

const STATUS: Record<WireErrorCode, ContentfulStatusCode> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  gone: 410,
  conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  quota: 403,
  pow_invalid: 400,
  unsupported: 501,
  server: 500,
  doc_required: 400,
  failed: 422,
};

export class HttpError extends Error {
  readonly status: ContentfulStatusCode;
  constructor(
    readonly code: WireErrorCode,
    message: string,
    readonly retryAfterS?: number,
    status?: ContentfulStatusCode,
  ) {
    super(message);
    this.status = status ?? STATUS[code];
  }
  body(): ErrorBody {
    return { error: { code: this.code, message: this.message, ...(this.retryAfterS !== undefined ? { retryAfterS: this.retryAfterS } : {}) } };
  }
}

export const fail = (code: WireErrorCode, message: string, status?: ContentfulStatusCode): never => {
  throw new HttpError(code, message, undefined, status);
};

/** Read and validate a JSON body. Size is capped by the body-limit middleware. */
export async function readJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HttpError('bad_request', 'body must be JSON');
  }
  return parseWith(schema, raw);
}

export function parseWith<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const where = r.error.issues
      .slice(0, 3)
      .map((i) => i.path.join('.') || '(root)')
      .join(', ');
    throw new HttpError('bad_request', `invalid fields: ${where}`);
  }
  return r.data;
}
