/**
 * Builds the Hono app and its dependencies. `index.ts` wires it to `Bun.serve`; tests call
 * `app.request()` directly or serve it on an ephemeral port.
 */
import { normaliseAudience } from '@pku-harness/cloud-protocol';
import type { ServerWebSocket, WebSocketHandler } from 'bun';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { routePath } from 'hono/route';

import { PowGate } from './auth/pow';
import { TokenSigner, loadTokenSecret } from './auth/token';
import { type Conn, Hub } from './channels/hub';
import type { Config } from './config';
import type { AppEnv, Deps, SocketData } from './context';
import { SqliteStorage } from './db/sqlite';
import type { Storage } from './db/storage';
import { HttpError } from './errors';
import { RateLimiter, applyRateLimitHeaders, limit } from './limits';
import { type Logger, consoleLogger } from './log';
import { PageRegistry, pageRoutes } from './pages';
import { authRoutes } from './routes/auth';
import { channelRoutes } from './routes/channels';
import { deviceRoutes } from './routes/devices';
import { fnRoutes } from './routes/fn';
import { mailboxRoutes } from './routes/mailbox';
import { metaRoutes } from './routes/meta';
import { peerRoutes } from './routes/peer';
import { pushRoutes } from './routes/push';
import { storeRoutes } from './routes/store';

export interface CloudServer {
  app: Hono<AppEnv>;
  deps: Deps;
  /** Bun.serve `websocket` handlers. */
  websocket: WebSocketHandler<SocketData & { conn?: Conn }>;
  /** Stop the GC loop, drop connections, close the database. */
  close(): void;
}

export async function createServer(config: Config, opts: { storage?: Storage; log?: Logger; now?: () => number } = {}): Promise<CloudServer> {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? consoleLogger();
  const storage = opts.storage ?? new SqliteStorage(config.dbPath);
  const limiter = new RateLimiter(now);
  const hub = new Hub(storage, config, limiter, log, now);
  const deps: Deps = {
    config,
    storage,
    tokens: new TokenSigner(await loadTokenSecret(storage, config.tokenSecret)),
    pow: new PowGate(storage, config.powDifficulty, config.powRotateS),
    limiter,
    hub,
    pages: new PageRegistry(config.pagesDir),
    log,
    now,
    aud: normaliseAudience(config.publicURL),
  };

  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    const t0 = performance.now();
    await next();
    applyRateLimitHeaders(c);
    // Route pattern only: concrete paths can contain store keys, query strings tokens.
    log.log('info', 'http', { m: c.req.method, r: routePath(c, -1) || '-', s: c.res.status, ms: Math.round(performance.now() - t0) });
  });
  app.use('*', async (c, next) => {
    let ip = 'unknown';
    if (config.trustProxy) {
      // The last hop is the one our own proxy appended; earlier hops are client-supplied.
      const hops = c.req.header('x-forwarded-for')?.split(',');
      if (hops?.length) ip = hops[hops.length - 1]!.trim() || ip;
    } else ip = c.env?.server?.requestIP(c.req.raw)?.address ?? ip;
    c.set('ip', ip);
    limit(c, limiter, `ip:${ip}`, config.rates.ip);
    await next();
  });
  app.use(
    '/v1/*',
    bodyLimit({
      maxSize: config.maxBodyBytes,
      onError: () => {
        throw new HttpError('payload_too_large', `body exceeds ${config.maxBodyBytes} bytes`);
      },
    }),
  );

  metaRoutes(app, deps);
  deviceRoutes(app, deps);
  authRoutes(app, deps);
  storeRoutes(app, deps);
  channelRoutes(app, deps);
  mailboxRoutes(app, deps);
  peerRoutes(app, deps);
  fnRoutes(app);
  pushRoutes(app);
  pageRoutes(app, deps);

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.notFound((c) => c.json(new HttpError('not_found', 'no such endpoint').body(), 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json(err.body(), err.status);
    // Name only: messages from parsers can quote request content.
    log.log('error', 'unhandled', { name: err.name });
    return c.json(new HttpError('server', 'internal error').body(), 500);
  });

  const websocket: WebSocketHandler<SocketData & { conn?: Conn }> = {
    maxPayloadLength: 64 * 1024,
    idleTimeout: 120,
    sendPings: true,
    async open(ws) {
      const conn = wsConn(ws);
      ws.data.conn = conn;
      const ch = await storage.getChannel(ws.data.channelId);
      if (!ch || ch.status !== 'open') return conn.close(4010, 'closed');
      if (ws.data.kind === 'owner') await hub.attachOwner(ch, conn);
      else await hub.attachPeer(ch, ws.data.peerId, conn);
    },
    async message(ws, msg) {
      const conn = ws.data.conn;
      if (!conn) return;
      if (ws.data.kind === 'owner') await hub.ownerMessage(ws.data.channelId, ws.data.maxPeers, conn, msg);
      else await hub.peerMessage(ws.data.channelId, ws.data.peerId, conn, msg);
    },
    close(ws) {
      const conn = ws.data.conn;
      if (!conn) return;
      if (ws.data.kind === 'owner') hub.detachOwner(ws.data.channelId, conn);
      else hub.detachPeer(ws.data.channelId, ws.data.peerId, conn);
    },
  };

  hub.start();
  return {
    app,
    deps,
    websocket,
    close() {
      hub.stop();
      storage.close();
    },
  };
}

function wsConn(ws: ServerWebSocket<SocketData & { conn?: Conn }>): Conn {
  return {
    send: (data) => {
      ws.send(data);
    },
    close: (code, reason) => ws.close(code, reason),
  };
}
