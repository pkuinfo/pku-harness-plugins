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
 */
export type CampusService = 'card' | 'its' | 'treehole';

export type CampusRequest = {
  /** Absolute URL, or a path on the service's host (e.g. "/berserker-app/…"). */
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  contentType?: string;
  responseType?: 'text' | 'base64';
};

export type CampusResponse = { status: number; url: string; headers: Record<string, string>; body: string };

export type CampusStatus = { signedIn: boolean; username: string | null };
