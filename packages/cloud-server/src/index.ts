/**
 * Entry point: `bun src/index.ts` (or `bun run dev` / `bun run start`). Configuration comes
 * from environment variables (README.md).
 */
import { type CloudServer, createServer } from './app';
import { type Config, configFromEnv } from './config';
import type { SocketData } from './context';
import type { Conn } from './channels/hub';

export { createServer } from './app';
export { configFromEnv, defaultConfig } from './config';

/** Start an HTTP + WebSocket server for `cloud`. Port 0 picks an ephemeral port. */
export function serve(cloud: CloudServer, config: Pick<Config, 'port' | 'hostname'>) {
  return Bun.serve<SocketData & { conn?: Conn }>({
    port: config.port,
    hostname: config.hostname,
    // SSE streams send a heartbeat every sseHeartbeatMs (15 s by default).
    idleTimeout: 60,
    fetch: (req, server) => cloud.app.fetch(req, { server }),
    websocket: cloud.websocket,
  });
}

if (import.meta.main) {
  const config = configFromEnv();
  const cloud = await createServer(config);
  const server = serve(cloud, config);
  cloud.deps.log.log('info', 'listening', { url: `http://${server.hostname}:${server.port}`, aud: cloud.deps.aud, db: config.dbPath });
  const shutdown = () => {
    cloud.deps.log.log('info', 'shutdown');
    server.stop(true);
    cloud.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
