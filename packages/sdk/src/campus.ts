/**
 * Authenticated access to PKU services through the harness. The harness holds the campus
 * credentials (device keystore), signs in to each service itself (IAAA, portal SSO, ITS) and
 * returns responses; plugins never see the password or the raw session tokens.
 */

/** Services the harness can sign in to. */
export type CampusService = 'card' | 'its';

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
