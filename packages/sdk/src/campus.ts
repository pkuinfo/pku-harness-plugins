/**
 * Authenticated access to PKU services through the harness. The harness holds the campus
 * credentials (device keystore), signs in to each service itself (IAAA, portal SSO, ITS) and
 * returns responses; plugins never see the password or the raw session tokens.
 */

/**
 * Services the harness can sign in to:
 * - `card`: bdcard.pku.edu.cn (synjones JWT added for you)
 * - `its`: its.pku.edu.cn (网络账号 session)
 * - `treehole`: treehole.pku.edu.cn `/chapi/…` (Bearer JWT + device uuid added for you). Its
 *   own second factors stay visible to the plugin: code 40002 = SMS check
 *   (`/chapi/api/jwt_send_msg`, `/chapi/api/jwt_msg_verify`), 40077 = course-data token
 *   (`/chapi/api/course/…`), so the plugin can ask the user for the code.
 * - `blackboard`: course.pku.edu.cn (教学网, HTML pages; SSO session, redirects followed)
 * - more registered by the harness (src/core/campus/adapters): see the plugin's `requires`.
 */
export type CampusService = 'card' | 'its' | 'treehole' | 'blackboard' | (string & {});

export type CampusRequest = {
  /** Absolute URL, or a path on the service's host (e.g. "/berserker-app/…"). */
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  contentType?: string;
  responseType?: 'text' | 'base64';
  /**
   * Form fields, sent url-encoded (instead of `body`). Lets the host add the session's auth to
   * the form (`authIn`) and the plugin `sign` the final field set.
   */
  form?: Record<string, string>;
  /**
   * Where the service's session credential goes. Default: headers (as the service expects).
   * 'form' puts it into `form` too, for APIs that read and sign the token from the body (the
   * campus card's order API). Only services whose adapter supports it accept 'form'.
   */
  authIn?: 'headers' | 'form';
  /**
   * Last step before sending a `form`: add a signature (or anything derived from the final
   * fields, auth included). Runs inside the harness; bundled plugins only.
   */
  sign?: (fields: Record<string, string>) => Record<string, string> | Promise<Record<string, string>>;
  /** Follow 3xx redirects (default: the service's own choice). false = read `location` yourself. */
  followRedirects?: boolean;
  /**
   * A multipart/form-data body (file uploads), instead of `body` / `form`. The host streams each
   * file from its local URI (from `services.files.pick`); file bytes never pass through the
   * plugin. Method defaults to POST. Uploads get a longer timeout.
   */
  multipart?: CampusMultipart;
  /** Request timeout in ms (default 20 s; 120 s for multipart). */
  timeoutMs?: number;
};

/** A local file to upload as one multipart part. */
export type CampusFilePart = {
  /** Form field name of the part, e.g. "newFile_LocalFile0". */
  field: string;
  /** File name sent to the server. */
  name: string;
  /** MIME type, e.g. "application/pdf". */
  mime: string;
  /** Local URI from `services.files.pick` (content:// or file:// in the app's cache). */
  uri: string;
};

export type CampusMultipart = {
  /**
   * Text fields. An array of [name, value] pairs keeps order and allows repeated names; a record
   * is sent in its key order. Text fields are written first, then the files.
   */
  fields: Record<string, string> | [string, string][];
  files: CampusFilePart[];
};

/** A file the user picked with `services.files.pick`. */
export type PickedFile = {
  name: string;
  mime: string;
  /** Bytes, when the system reports it. */
  size: number | null;
  /** Local URI, valid for this app session; pass it to `CampusRequest.multipart.files`. */
  uri: string;
};

export type CampusResponse = { status: number; url: string; headers: Record<string, string>; body: string };

export type CampusStatus = { signedIn: boolean; username: string | null; /** Holder's name when known (from the campus card). */ name: string | null };

/** The current 手机令牌 (IAAA TOTP) code; the secret itself never leaves the harness. */
export type OtpCode = { code: string; /** Seconds until the code rolls over (1–30). */ remainingSeconds: number };

/** The harness's 手机令牌 binding (no secret). `pending` = binding SMS sent, awaiting the code. */
export type OtpStatus = { bound: boolean; userId: string | null; userName: string | null; boundAt: number | null; pending: boolean };
