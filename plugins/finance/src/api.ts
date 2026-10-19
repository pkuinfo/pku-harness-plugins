import type { HostServices } from '@pku-harness/sdk';

import { encryptForm } from './encrypt';
import { initVars, parseDoQuery, parseProcHash, parseUserContext, rewardRecords, type UserContext } from './parse';

/**
 * 个人酬金查询 over the harness `cwfw` session (pkucli crates/cwfw/src/commands.rs `cmd_reward`
 * and api.rs `query_reward`): userContext from loadRolesMenu (+ loadInitFunction), then
 * loadDefinition(5802) → per-session proc hash → commonUpdate_responseButtonEvent (filter) →
 * commonQuery_doQuery(5746). Every request body is encrypted (encrypt.ts).
 */

type Services = Pick<HostServices, 'campus'>;

const BASE = 'https://cwfw.pku.edu.cn';
const PROJECT = 'WF_CWBS';
const FORM = 'application/x-www-form-urlencoded; charset=UTF-8';
const XHR = { 'x-requested-with': 'XMLHttpRequest' };

/** api.rs constants. */
const WIN_REWARD_QUERY = '5802';
const FUNC_REWARD_GRID = '5746';
const REWARD_FUNCNO = '9-gz1';
const REWARD_DBCODE = 'gz1';

const pad2 = (n: number) => String(n).padStart(2, '0');

async function post(services: Services, action: string, body: string, headers: Record<string, string> = {}) {
  const res = await services.campus.request('cwfw', {
    url: `${BASE}/${PROJECT}/${action}`,
    method: 'POST',
    contentType: FORM,
    headers: { ...XHR, ...headers },
    body,
  });
  if (res.status >= 400) throw new Error(`财务门户返回 HTTP ${res.status}（${action}）`);
  return res.body;
}

/** api.rs `post_encrypted`: `a=<uid>` first, then the fields, all encrypted. */
const postEncrypted = (services: Services, uid: string, action: string, fields: [string, string][]) =>
  post(services, action, encryptForm([['a', uid], ...fields]), {
    accept: 'application/json, text/javascript, */*; q=0.01',
    origin: BASE,
    referer: `${BASE}/${PROJECT}/main.jsp`,
  });

/** context.rs `seed_reward_query_context` + the 5743-D.* fields api.rs `set_reward_filter` sets. */
export function rewardContext(base: UserContext, uid: string, year: number, from: number, to: number): UserContext {
  return {
    ...base,
    '0-USERINFO.USERID': uid,
    '0-UNINO': uid,
    CURRMENUNODEID: 220,
    [`${PROJECT}$5743-D.FUNCNO`]: REWARD_FUNCNO,
    [`${PROJECT}$5743-D.DBCODE`]: REWARD_DBCODE,
    [`${PROJECT}$5743-D.YEAR_S`]: REWARD_DBCODE,
    [`${PROJECT}$5743-D.YEAR`]: String(year),
    [`${PROJECT}$5743-D.MONTH_1`]: pad2(from),
    [`${PROJECT}$5743-D.MONTH_2`]: pad2(to),
    '0-CURRFUNC': 5743,
    '0-CURRBTN': '查询',
    '0-CURRFUNCTYPE': '3',
  };
}

/** api.rs `set_reward_filter`: the `cmd` object the server evaluates; data0 order matches the button binding. */
export function rewardFilterCmd(proc: string, uid: string, year: number, from: number, to: number, now = new Date()) {
  const v = (name: string, value: string, type = 'CHAR') => ({ name, value, type });
  return {
    check_func: 'escape',
    proc0: proc,
    data0: [
      v('d.year', String(year)),
      v('d.month_2', pad2(to)),
      v('d.month_1', pad2(from)),
      v('d.funcno', REWARD_FUNCNO),
      v('d.dbcode', REWARD_DBCODE),
      v('SHOWPUBRWD', 'Y', 'char'),
      v('REWARDCOLNUM', '15', 'char'),
      v('userinfo.userid', uid),
      v('currentyear', String(now.getFullYear())),
      v('currentmonth', pad2(now.getMonth() + 1)),
    ],
    wfName: '', wfAct: '', wfNodeId: '', wfState: '', wfUniKey: '', wfVars: '', wfKeyVal: '', wfComment: '', wfCollab: '', wfPdf: '',
  };
}

/** commands.rs: loadRolesMenu (required) + loadInitFunction (best effort). */
async function userContext(services: Services) {
  const menu = await post(services, 'loadRolesMenu.action', '');
  const ctx = parseUserContext(menu);
  if (!ctx) throw new Error('财务门户会话未建立（没有拿到用户信息），请稍后重试');
  const extra = await post(services, 'loadInitFunction.action', '').then(initVars, () => ({}));
  const uid = String(ctx['0-USERINFO.USERID'] ?? '') || services.campus.status().username || '';
  if (!uid) throw new Error('财务门户没有返回学号/工号');
  return { ctx: { ...ctx, ...extra }, uid };
}

/** api.rs `query_reward` for one year, months [from, to]. */
export async function queryRewards(services: Services, year: number, from: number, to: number) {
  const { ctx, uid } = await userContext(services);

  const def = await postEncrypted(services, uid, 'loadDefinition.action', [
    ['projid', PROJECT],
    ['winno', WIN_REWARD_QUERY],
    ['type', 'W'],
  ]);
  const proc = parseProcHash(def);
  if (!proc) throw new Error('没能解析财务门户的“个人酬金查询”页面（系统可能已改版）');

  const update = await postEncrypted(services, uid, 'commonUpdate_responseButtonEvent.action', [
    ['cmd', JSON.stringify(rewardFilterCmd(proc, uid, year, from, to))],
    ['projid', PROJECT],
    ['userContext', JSON.stringify(rewardContext(ctx, uid, year, from, to))],
    ['async', 'false'],
  ]);
  // "pass" on success; `$$$SYS_ERROR$$$…` when rejected (other bodies count as success, as in pkucli).
  if (update.includes('SYS_ERROR')) throw new Error('财务门户拒绝了查询条件，请稍后重试');

  const grid = await postEncrypted(services, uid, 'commonQuery_doQuery.action', [
    ['funcno', FUNC_REWARD_GRID],
    ['projid', PROJECT],
    ['needcount', 'true'],
    ['_search', 'false'],
    ['nd', String(Date.now())],
    ['rows', '500'],
    ['page', '0'],
    ['sidx', 'to_number(rr.pid) ASC'],
    ['sord', ''],
    ['userData', JSON.stringify({ '0-USERINFO.USERID': uid, '0-UNINO': uid })],
    ['itemArr', ''],
    ['sectionArr', ''],
  ]);
  return rewardRecords(parseDoQuery(grid).rows);
}
