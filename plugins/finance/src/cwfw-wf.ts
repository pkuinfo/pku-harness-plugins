import type { HostServices } from '@pku-harness/sdk';

import { encryptForm } from './encrypt';
import { decodeEntities, parseDoQuery, parseUserContext, type QueryResp, type UserContext } from './parse';

/**
 * Generic protocol layer of the Wingsoft "WF" finance portal (pkucli crates/cwfw/src/wf.rs).
 *
 * Each menu entry is a window (winno) made of functions (funcno: F form, Q grid, C custom page).
 * A query is:
 * 1. loadDefinition.action {projid, winno, type=W} → the window definition (a JS literal). It holds
 *    the 查询 button's stored procedure `` `$<md5>:#<func>-<field>#;#0-<var>#;… `` (the hash
 *    changes per session, so it is parsed every time), field triggers (`funcMap`) and select
 *    sources (`bindMap`).
 * 2. commonUpdate_responseButtonEvent.action {cmd, projid, userContext, async} runs it; `data0`
 *    follows the parameter order, and `userContext` must carry the form fields
 *    (`<projid>$<func>-<FIELD>`): the server keeps them in the session and the grid SQL reads them.
 * 3. crossfieldrebuild.action (cross tables) → dynamic columns.
 * 4. commonQuery_doQuery.action → grid rows.
 * Every body is encrypted (encrypt.ts). This file has no business logic (see cwfw-queries.ts).
 */

export type Services = Pick<HostServices, 'campus'>;

const BASE = 'https://cwfw.pku.edu.cn';
const FORM = 'application/x-www-form-urlencoded; charset=UTF-8';

export type ProcArg = { name: string; value: string; type: 'CHAR' | 'char' };
export type ProcRef = { hash: string; params: string[] };
export type FormValues = [field: string, value: string][];

/** One subsystem: path `WF_CWBS` (网上查询) or `YBX` (智能报销, projid WF_YBX). */
export class Wf {
  constructor(
    readonly services: Services,
    readonly uid: string,
    readonly path = 'WF_CWBS',
    readonly projid = 'WF_CWBS',
  ) {}

  async raw(action: string, body: string, headers: Record<string, string> = {}) {
    const res = await this.services.campus.request('cwfw', {
      url: `${BASE}/${this.path}/${action}`,
      method: 'POST',
      contentType: FORM,
      headers: { 'x-requested-with': 'XMLHttpRequest', ...headers },
      body,
    });
    if (res.status >= 400) throw new Error(`财务门户返回 HTTP ${res.status}（${action}）`);
    return res.body;
  }

  /** wf.rs `post_encrypted`: `a=<uid>` first, then the fields, all encrypted. */
  post(action: string, fields: FormValues) {
    return this.raw(action, encryptForm([['a', this.uid], ...fields]), {
      accept: 'application/json, text/javascript, */*; q=0.01',
      origin: BASE,
      referer: `${BASE}/${this.path}/main.jsp`,
    });
  }

  loadWindow(winno: string) {
    return this.post('loadDefinition.action', [['projid', this.projid], ['winno', winno], ['type', 'W']]);
  }

  /** Select source: `value:label;value:label`. */
  binding(sqlid: string, cvstr: string) {
    return this.post('common_getBindingDataBackend.action', [['sqlid', sqlid], ['cvstr', cvstr], ['projid', this.projid]]);
  }

  /** A `funcMap` trigger: the server computes one field from others. */
  async check(hash: string, data: ProcArg[], ctx: UserContext) {
    const cmd = wfCmd({ check_func: hash, check_data: data });
    const text = await this.post('commonUpdate_responseButtonEvent.action', [
      ['cmd', cmd],
      ['projid', this.projid],
      ['userContext', JSON.stringify(ctx)],
      ['async', 'false'],
    ]);
    return text.trim();
  }

  /** Run a button's stored procedure (optionally with its check_func). Throws with the portal's message when refused. */
  async button(proc: string, data0: ProcArg[], ctx: UserContext, check?: { hash: string; data: ProcArg[] }) {
    const cmd = wfCmd(check ? { check_func: check.hash, check_data: check.data, proc0: proc, data0 } : { check_func: 'escape', proc0: proc, data0 });
    const text = (
      await this.post('commonUpdate_responseButtonEvent.action', [
        ['cmd', cmd],
        ['projid', this.projid],
        ['userContext', JSON.stringify(ctx)],
        ['async', 'false'],
      ])
    ).trim();
    if (!buttonOk(text)) throw new Error(`财务门户拒绝了查询：${decodeEntities(text).slice(0, 120)}`);
    return text;
  }

  async crossFields(funcno: string, ctx: UserContext) {
    const text = await this.post('crossfieldrebuild.action', [
      ['projId', this.projid],
      ['funcno', funcno],
      ['dynColSwitch', 'true'],
      ['data', JSON.stringify(ctx)],
    ]);
    return parseCrossFields(text);
  }

  /** Grid rows. Without `userData` only the user id is sent (the button already set the session). */
  async doQuery(funcno: string, sidx: string, rows: number, userData?: UserContext): Promise<QueryResp> {
    const ud = userData ?? { '0-USERINFO.USERID': this.uid, '0-UNINO': this.uid };
    const text = await this.post('commonQuery_doQuery.action', [
      ['_search', 'false'],
      ['nd', String(Date.now())],
      ['rows', String(rows)],
      ['page', '1'],
      ['sidx', sidx],
      ['sord', ''],
      ['userData', JSON.stringify(ud)],
      ['itemArr', ''],
      ['sectionArr', ''],
      ['funcno', funcno],
      ['projid', this.projid],
      ['needcount', 'true'],
    ]);
    return parseDoQuery(text);
  }

  /** loadRolesMenu.action → userContext of this subsystem (null when its session isn't set up). */
  async userContext() {
    return parseUserContext(await this.raw('loadRolesMenu.action', ''));
  }
}

const WF_FIELDS = ['wfName', 'wfAct', 'wfNodeId', 'wfState', 'wfUniKey', 'wfVars', 'wfKeyVal', 'wfComment', 'wfCollab', 'wfPdf'];
const wfCmd = (obj: Record<string, unknown>) => JSON.stringify({ ...obj, ...Object.fromEntries(WF_FIELDS.map((k) => [k, ''])) });

/** `pass`, `pass;local(…)`, `success: 执行成功.` all count as success. */
export const buttonOk = (t: string) => /^pass$/i.test(t.trim()) || t.startsWith('pass;') || t.startsWith('success') || t.startsWith('[{');

/** login.rs `extract_entry`: a subsystem tile's url on home3.jsp, minus `WINOPEN`. */
export function subsystemEntry(html: string, pid: string) {
  const raw = new RegExp(`id="${pid}"\\s+url="([^"]+)"`).exec(html)?.[1];
  if (!raw) return null;
  const rel = raw.replace(/&amp;/g, '&').replace(/^WINOPEN/, '');
  if (/^https?:\/\//i.test(rel)) return rel;
  if (rel.startsWith('/')) return BASE + rel;
  // relative to /WFManager/ (RN's URL can't resolve `../`)
  const dirs = ['WFManager'];
  let rest = rel;
  for (;;) {
    if (rest.startsWith('../')) dirs.pop();
    else if (!rest.startsWith('./')) break;
    rest = rest.slice(rest.indexOf('/') + 1);
  }
  return `${BASE}/${[...dirs, rest].join('/')}`;
}

/** login.rs `enter_subsystem`: re-read home3.jsp and open the subsystem's entry (sets its session). */
export async function enterSubsystem(services: Services, pid: string) {
  const home3 = await services.campus.request('cwfw', { url: `${BASE}/WFManager/home3.jsp` });
  const url = subsystemEntry(home3.body, pid);
  if (!url) throw new Error('财务门户主页里没有找到对应的子系统入口，请稍后重试');
  const res = await services.campus.request('cwfw', { url, headers: { referer: `${BASE}/WFManager/home3.jsp` } });
  if (res.status >= 400) throw new Error(`进入财务子系统失败（HTTP ${res.status}）`);
}

// ───────────────────────── pure parsers ─────────────────────────

const ref = (hash: string, params: string) => ({ hash, params: params.split(';').map((p) => p.replace(/^#|#$/g, '')) });

/** All button procedures (`procs:[…]`; not `beforeLoadProcs`). */
export function procs(def: string): ProcRef[] {
  const out: ProcRef[] = [];
  for (const list of def.matchAll(/procs:\[([^\]]*)\]/g)) for (const m of list[1].matchAll(/"(`\$[a-f0-9]{32}):([^"]*)"/g)) out.push(ref(m[1], m[2]));
  return out;
}

const firstIs = (first: string) => (p: ProcRef) => (p.params[0] ?? '').toLowerCase() === first.toLowerCase();

/** The procedure whose first parameter is `first` (e.g. `5574-d.year`). */
export const findProc = (def: string, first: string) => procs(def).find(firstIs(first)) ?? null;

/** A button's pre-check (`check_func:"`$hash:…"`) whose first parameter is `first`. */
export function findCheck(def: string, first: string): ProcRef | null {
  for (const m of def.matchAll(/check_func:"(`\$[a-f0-9]{32}):([^"]*)"/g)) {
    const p = ref(m[1], m[2]);
    if (firstIs(first)(p)) return p;
  }
  return null;
}

/** The first `beforeLoadProcs` procedure of a window. */
export function beforeLoadProc(def: string): ProcRef | null {
  const m = /beforeLoadProcs:\["(`\$[a-f0-9]{32}):([^"]*)"/.exec(def);
  return m ? ref(m[1], m[2]) : null;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A field's entry in `funcMap` / `bindMap`: `"d.code":"`$hash|#5574-d.incometype#,#5574-d.funcno#"`
 * → { head: "`$hash", params: ["5574-d.incometype", "5574-d.funcno"] }. bindMap heads start with
 * `@$` (dynamic source) or are the static options themselves (`0:a;1:b`).
 */
export function mapEntry(def: string, map: 'funcMap' | 'bindMap', field: string): { head: string; params: string[] } | null {
  const item = new RegExp(`"${esc(field)}":"([^"]*)"`);
  for (const block of def.matchAll(new RegExp(`${map}:\\{([^}]*)\\}`, 'g'))) {
    const raw = item.exec(block[1])?.[1];
    if (raw == null) continue;
    const bar = raw.indexOf('|');
    if (bar < 0) return { head: raw, params: [] };
    return {
      head: raw.slice(0, bar),
      params: raw
        .slice(bar + 1)
        .split(',')
        .map((p) => p.trim().replace(/^#|#$/g, ''))
        .filter(Boolean),
    };
  }
  return null;
}

/** `value:label;value:label` → [[value, label]]. */
export function parseOptions(s: string): [string, string][] {
  return s
    .split(';')
    .map((kv) => {
      const i = kv.indexOf(':');
      return i > 0 ? ([kv.slice(0, i).trim(), kv.slice(i + 1).trim()] as [string, string]) : null;
    })
    .filter((x): x is [string, string] => !!x && !!x[0]);
}

/** `pass;local(0-a:1;0-b:x;)` → { a: "1", b: "x" } (the `0-` prefix dropped). */
export function parseLocal(s: string): Record<string, string> {
  const start = s.indexOf('local(');
  if (start < 0) return {};
  const inner = s.slice(start + 6, s.lastIndexOf(')') > start ? s.lastIndexOf(')') : undefined);
  const out: Record<string, string> = {};
  for (const kv of inner.split(';')) {
    const i = kv.indexOf(':');
    if (i <= 0) continue;
    out[kv.slice(0, i).trim().replace(/^0-/, '')] = kv.slice(i + 1).trim();
  }
  return out;
}

/** crossfieldrebuild.action → [field, title] in cell order (plain fields have an empty title). */
export function parseCrossFields(text: string): [string, string][] {
  const j = JSON.parse(text.trim()) as { prjfields?: string; colModel?: Record<string, { data?: { colName?: string; name?: string }[] }> };
  if (!j.prjfields) throw new Error('动态列响应缺少 prjfields');
  const names = new Map<string, string>();
  for (const m of Object.values(j.colModel ?? {})) for (const c of m.data ?? []) if (c.colName) names.set(c.colName, c.name ?? '');
  return j.prjfields.split(',').map((f) => [f.trim(), names.get(f.trim()) ?? ''] as [string, string]);
}

export type MenuEntry = { title: string; winno: string; group: string; nodeId: string };

/** loadMenu.action HTML → entries (`globalMenuEvent')('<title>','<winno>','<group>')` … `currMenuNodeId',<id>`). */
export function parseMenu(html: string): MenuEntry[] {
  return [...html.matchAll(/globalMenuEvent'\)\('([^']*)','(\d+)','([^']*)'\).*?setData\('currMenuNodeId',(\d+)\)/g)].map((m) => ({
    title: m[1],
    winno: m[2],
    group: m[3],
    nodeId: m[4],
  }));
}

const ctxStr = (ctx: UserContext, key: string) => {
  const v = ctx[key];
  return v == null ? '' : typeof v === 'string' ? v : String(v);
};

/**
 * wf.rs `build_args`: procedure parameters → arguments. `<func>-<field>` from the form (case-insensitive),
 * `0-<var>` from userContext `0-<VAR>`, empty parameter (`;;`) → empty name and value.
 */
export function buildArgs(params: string[], form: FormValues, ctx: UserContext): ProcArg[] {
  return params.map((p) => {
    if (!p) return { name: '', value: '', type: 'CHAR' };
    const dash = p.indexOf('-');
    const scope = dash > 0 ? p.slice(0, dash) : '0';
    const name = dash > 0 ? p.slice(dash + 1) : p;
    if (scope === '0') {
      // the page sends all-caps system variables as "char"
      return { name, value: ctxStr(ctx, `0-${name.toUpperCase()}`), type: name === name.toUpperCase() ? 'char' : 'CHAR' };
    }
    const hit = form.find(([k]) => k.toLowerCase() === name.toLowerCase());
    return { name, value: hit?.[1] ?? '', type: 'CHAR' };
  });
}

/** wf.rs `seed_form`: form fields into userContext as `<projid>$<func>-<FIELD>`, plus the current function/button. */
export function seedForm(ctx: UserContext, projid: string, func: string, form: FormValues, menuNode?: number): UserContext {
  const out: UserContext = { ...ctx };
  for (const [k, v] of form) out[`${projid}$${func}-${k.toUpperCase()}`] = v;
  out['0-CURRFUNC'] = Number(func);
  out['0-CURRBTN'] = '查询';
  out['0-CURRFUNCTYPE'] = '3';
  if (menuNode != null) out.CURRMENUNODEID = menuNode;
  return out;
}

/** cvstr for getBindingDataBackend: `#0-USERINFO.USERID#::<uid>$$…`. */
export const cvstr = (params: string[], form: FormValues, ctx: UserContext) =>
  buildArgs(params, form, ctx)
    .map((a, i) => `#${params[i]}#::${a.value}`)
    .join('$$');
