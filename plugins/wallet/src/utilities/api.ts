import type { HostServices } from '@pku-harness/sdk';

import { bathCardInfo, bathTopUps, createdOrderId, flattenProjects, isBathProject, unwrapCwpay, type PayProject, type RawOrder, type RawProject } from './parse';

/**
 * 北京大学收费平台 (cwpay.pku.edu.cn) over the harness `cwpay` session (src/core/campus/adapters/
 * cwpay.ts: IAAA sign-in, X-Token, response decryption). Endpoints from the mobile bundle
 * (2026-10-21); settings.js: schoolCode "10001".
 */

type Services = Pick<HostServices, 'campus'>;
const SCHOOL_CODE = '10001';

async function call<T>(services: Services, url: string, what: string, body?: unknown): Promise<T> {
  const res = await services.campus.request('cwpay', {
    url,
    method: body === undefined ? 'GET' : 'POST',
    contentType: 'application/json;charset=UTF-8',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status >= 500 && !res.body.trim().startsWith('{')) throw new Error(`收费平台暂时不可用（HTTP ${res.status}）`);
  return unwrapCwpay<T>(res.body, what);
}

function idserial(services: Services) {
  const id = services.campus.status().username;
  if (!id) throw new Error('还没有登录校园账号');
  return id;
}

/** Top-level projects plus one level of folders (the 更多应用 page). */
export async function listProjects(services: Services): Promise<PayProject[]> {
  const cats = await call<RawProject[]>(services, `pay/pay/cos/merchant/getProjectTypeAndProjectInfoListInit/${SCHOOL_CODE}`, '缴费项目');
  const { projects, folders } = flattenProjects(cats ?? []);
  const nested = await Promise.all(
    // Every folder (the platform has dozens; a cap hid 浴卡充值 when it sat in a later folder).
    folders.slice(0, 60).map((f) =>
      call<RawProject[]>(services, `pay/pay/cos/merchant/getProjectTypeAndProjectInfoList/${f.id}`, '缴费项目').then(
        (c) => flattenProjects([{ children: c ?? [] }], f.category).projects,
        () => [] as PayProject[],
      ),
    ),
  );
  return [...projects, ...nested.flat()];
}

const BATH_CLOSED = '收费平台目前没有为你的账号开放浴卡充值（项目列表里没有这一项）';

// The list is per account: the platform only offers 浴卡充值 to some students (or seasonally).
const findBathProject = async (services: Services) => (await listProjects(services)).find(isBathProject);

async function bathProject(services: Services) {
  const p = await findBathProject(services);
  if (!p) throw new Error(BATH_CLOSED);
  return p;
}

/**
 * 浴卡充值 page init: card number + holder, and the latest bath top-ups from 我的订单.
 * `available: false` (not an error) when the platform doesn't offer 浴卡充值 to this account.
 */
export async function bathCard(services: Services) {
  const project = await findBathProject(services);
  if (!project) return { available: false as const, cardNo: null, holder: null, recentTopUps: [], note: BATH_CLOSED };
  const [info, orders] = await Promise.all([
    call<{ idserial?: string; username?: string }>(services, `pay/web/bath/queryBathFeeInfo/${encodeURIComponent(idserial(services))}/${encodeURIComponent(project.id)}`, '浴卡信息'),
    call<{ records?: RawOrder[] }>(services, '/pay/web/order/pageOrderlist', '订单记录', {
      pageCurrent: 1,
      pageSize: 20,
      projectName: '',
      projectId: project.id,
      displayStatus: '',
      startCreateDate: '',
      endCreateDate: '',
      schoolCode: SCHOOL_CODE,
    }).catch(() => null),
  ]);
  return { available: true as const, ...bathCardInfo(info), recentTopUps: bathTopUps(orders) };
}

/**
 * 浴卡充值: checks the project is open (getProjectIsAllowPayment), creates the order
 * (pay/web/bath/createOrder, the page's `next()`). The user then pays it on the signed-in mobile
 * site (我的订单 → 待支付), opened by `openPayCenter` through the harness.
 */
export async function createBathOrder(services: Services, amount: number) {
  const project = await bathProject(services);
  await call<unknown>(services, 'pay/project/getProjectIsAllowPayment', '浴卡充值', { projectId: project.id });
  const order = await call<{ PayOrderTrade?: { id?: unknown } }>(services, 'pay/web/bath/createOrder', '浴卡充值', { schoolCode: SCHOOL_CODE, projectId: project.id, payamtStr: amount });
  const orderId = createdOrderId(order);
  return { orderId };
}

/** Open the signed-in mobile site (我的订单 → 待支付); the harness builds the URL and keeps the token. */
export function openPayCenter(services: Services) {
  return services.campus.openSignedIn('cwpay');
}
