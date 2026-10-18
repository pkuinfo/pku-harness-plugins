// Template for a PKU Harness remote plugin: an MCP server over Streamable HTTP.
// 1. Rename the server, add tools with registerTool (title + description are shown to the
//    model and the user; annotations.readOnlyHint=true marks a read-only tool, everything
//    else asks the user first by default).
// 2. Deploy anywhere that serves HTTPS (Cloudflare Workers, Fly, a campus server…).
// 3. Add an entry to registry/registry.json and open a PR.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { z } from 'zod';

function build() {
  const server = new McpServer({ name: 'my-plugin', version: '0.1.0', title: '我的插件' }, { instructions: 'What this plugin is for, in one sentence.' });
  server.registerTool(
    'hello',
    {
      title: '打个招呼',
      description: 'Return a greeting. Replace with a real capability.',
      inputSchema: { name: z.string().describe('who to greet') },
      annotations: { readOnlyHint: true },
    },
    async ({ name }) => ({ content: [{ type: 'text', text: `你好，${name}` }], structuredContent: { greeting: `你好，${name}` } }),
  );
  return server;
}

const app = express();
app.use(express.json());
app.post('/mcp', async (req, res) => {
  // Optional bearer auth: users paste the token in the app; it is stored in their keychain.
  if (process.env.PLUGIN_TOKEN && req.headers.authorization !== `Bearer ${process.env.PLUGIN_TOKEN}`) {
    res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'unauthorized' }, id: null });
    return;
  }
  const server = build();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.listen(Number(process.env.PORT ?? 8787), () => console.log('MCP plugin ready on /mcp'));
