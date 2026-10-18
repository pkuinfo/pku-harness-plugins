// Example remote plugin for PKU Harness: an MCP server over Streamable HTTP (stateless).
// Mock data only. Run: bun examples/demo-canteen/server.ts, then add http://<host>:8787/mcp
// with token demo-token in the app (设置 → 插件 → 添加远程插件).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { z } from 'zod';

function build() {
  const server = new McpServer({ name: 'demo-canteen', version: '0.1.0', title: '食堂菜单（演示）' }, { instructions: 'Demo canteen plugin with mock data.' });
  server.registerTool(
    'menu',
    {
      title: '今日菜单',
      description: 'Mock menu of a canteen for today, with prices in CNY.',
      inputSchema: { canteen: z.enum(['学一', '农园', '燕南']).describe('canteen name') },
      annotations: { readOnlyHint: true },
    },
    async ({ canteen }) => {
      const items = [
        { name: '宫保鸡丁', price: 9 },
        { name: '番茄炒蛋', price: 5 },
        { name: '红烧肉', price: 12 },
      ];
      return {
        content: [{ type: 'text', text: JSON.stringify({ canteen, items }) }],
        structuredContent: { canteen, items, cheapest: 5 },
      };
    },
  );
  server.registerTool(
    'reserveSeat',
    {
      title: '预约座位',
      description: 'Mock: reserve a seat for a meal.',
      inputSchema: { canteen: z.string(), time: z.string().describe('HH:MM') },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ canteen, time }) => ({ content: [{ type: 'text', text: `已为你在${canteen}预约 ${time} 的座位（演示）` }] }),
  );
  return server;
}

const app = express();
app.use(express.json());
app.post('/mcp', async (req, res) => {
  const token = process.env.PLUGIN_TOKEN ?? 'demo-token';
  if (req.headers.authorization !== `Bearer ${token}`) {
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
const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`demo-canteen MCP on :${port}/mcp`));
