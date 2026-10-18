// Scripted OpenAI-compatible Chat Completions server for testing PKU Harness without a model key.
// Run: bun examples/mock-llm/server.ts → in the app, AI 服务 → OpenAI 兼容, Base URL http://<host>:8788/v1,
// model mock-agent. It picks a tool from keywords (remind / soon / dash / form / canteen / remember)
// in the last user message, then summarizes the tool result; 'who' echoes injected <context>.
const enc = new TextEncoder();
type Msg = { role: string; content?: unknown; tool_calls?: unknown[] };

function plan(messages: Msg[]): { text?: string; tool?: { name: string; args: unknown } } {
  const last = messages[messages.length - 1];
  const user = [...messages].reverse().find((m) => m.role === 'user');
  const text = typeof user?.content === 'string' ? user.content : JSON.stringify(user?.content ?? '');
  if (last.role === 'tool') {
    const out = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
    return { text: `好的，已经完成。工具返回：${out.slice(0, 160)}` };
  }
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const inMin = (m: number) => {
    const d = new Date(now.getTime() + m * 60000);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  if ((text.includes('提醒') || text.toLowerCase().includes('remind'))) {
    return { tool: { name: 'scheduler__create', args: { title: '交水费', schedule: { type: 'repeat', unit: 'day', interval: 3, times: ['09:00'], count: 16 }, action: { type: 'notify', body: '记得交水费' } } } };
  }
  if ((text.includes('马上') || text.toLowerCase().includes('soon'))) {
    return { tool: { name: 'scheduler__create', args: { title: '一分钟后的测试', schedule: { type: 'once', at: inMin(2) } } } };
  }
  if ((text.includes('看板') || text.toLowerCase().includes('dash'))) {
    return {
      tool: {
        name: 'dashboard__upsertWidget',
        args: {
          title: '下一节课',
          size: 'md',
          spec: { root: 'col', elements: { col: { type: 'Column', props: { gap: 'sm' }, children: ['h', 't'] }, h: { type: 'Heading', props: { text: { $template: '今天共 ${/today/count} 节课' }, size: 'md' } }, t: { type: 'Text', props: { text: { $template: '下一节：${/today/next/name} ${/today/next/time}' }, tone: 'muted', size: null } } } },
          bindings: { '/today': { tool: 'timetable.today', ttlMinutes: 1 } },
        },
      },
    };
  }
  if ((text.includes('表单') || text.toLowerCase().includes('form'))) {
    return {
      tool: {
        name: 'ui__render',
        args: { spec: { root: 'card', elements: { card: { type: 'Card', props: { title: '充值校园卡', subtitle: '选择金额' }, children: ['c', 'b'] }, c: { type: 'Choice', props: { label: null, options: [{ label: '¥50', value: '50', hint: null }, { label: '¥100', value: '100', hint: '常用' }], value: { $bindState: '/form/amount' } } }, b: { type: 'Button', props: { label: '确认', variant: 'primary' }, on: { press: { action: 'submit', params: { label: '充值' } } } } }, state: { form: { amount: '100' } } } },
      },
    };
  }
  if (text.toLowerCase().includes('remember')) return { tool: { name: 'memory__remember', args: { text: '用户是信息科学技术学院 2024 级本科生，喜欢在农园食堂吃午饭', kind: 'fact' } } };
  const ctx = /<context>([\s\S]*?)<\/context>/.exec(text);
  if (ctx && text.includes('who')) return { text: `我看到的上下文：${ctx[1].trim()}` };
  if ((text.includes('食堂') || text.toLowerCase().includes('canteen'))) return { tool: { name: 'mcp-demo-canteen__reserveSeat', args: { canteen: '农园', time: '12:00' } } };
  return { text: `收到：「${text.slice(0, 40)}」。这是模拟模型的回答。` };
}

function sse(obj: unknown) {
  return enc.encode(`data: ${JSON.stringify(obj)}\n\n`);
}

Bun.serve({
  port: 8788,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.endsWith('/models')) return Response.json({ object: 'list', data: [{ id: 'mock-agent' }, { id: 'mock-agent-pro' }] });
    if (!url.pathname.endsWith('/chat/completions')) return new Response('not found', { status: 404 });
    const body = (await req.json()) as { messages: Msg[]; stream?: boolean };
    const p = plan(body.messages);
    const id = `chatcmpl-${Date.now()}`;
    if (!body.stream) {
      const message = p.tool
        ? { role: 'assistant', content: null, tool_calls: [{ id: `call_${Date.now()}`, type: 'function', function: { name: p.tool.name, arguments: JSON.stringify(p.tool.args) } }] }
        : { role: 'assistant', content: p.text?.includes('只回复') ? '好的' : (p.text ?? '好的') };
      return Response.json({
        id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'mock-agent',
        choices: [{ index: 0, message, finish_reason: p.tool ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });
    }
    const base = { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'mock-agent' };
    const stream = new ReadableStream({
      async start(ctrl) {
        if (p.tool) {
          ctrl.enqueue(sse({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '我来处理。' }, finish_reason: null }] }));
          ctrl.enqueue(sse({ ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: `call_${Date.now()}`, type: 'function', function: { name: p.tool.name, arguments: JSON.stringify(p.tool.args) } }] }, finish_reason: null }] }));
          ctrl.enqueue(sse({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
        } else {
          for (const ch of (p.text ?? '').match(/.{1,6}/gs) ?? []) {
            ctrl.enqueue(sse({ ...base, choices: [{ index: 0, delta: { content: ch }, finish_reason: null }] }));
            await Bun.sleep(30);
          }
          ctrl.enqueue(sse({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
        }
        ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
        ctrl.close();
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  },
});
console.log('mock LLM on :8788/v1');
