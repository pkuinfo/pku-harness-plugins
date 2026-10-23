import type { HostServices } from '@pku-harness/sdk';

import { flattenProjects, folderProjects, isTuitionProject, orderRecords, statusDict, tuitionItems, unwrapCwpay, unwrapTuition, type PayProject, type RawOrder, type RawProject } from './cwpay-parse';

/**
 * 北京大学收费平台 (cwpay.pku.edu.cn) over the harness `cwpay` session (src/core/campus/adapters/
 * cwpay.ts signs in through IAAA, adds X-Token and decrypts answers). Endpoints from the site's
 * mobile bundle (2026-10-21); settings.js: schoolCode "10001", dataSource "PAY".
 */

type Services = Pick<HostServices, 'campus'>;

export const SCHOOL_CODE = '10001';
const DATA_SOURCE = 'PAY';

/** The decrypted body of one platform call (POST when `body` is given). */
export async function fetchBody(services: Services, url: string, body?: unknown): Promise<string> {
  const res = await services.campus.request('cwpay', {
    url,
    method: body === undefined ? 'GET' : 'POST',
    contentType: 'application/json;charset=UTF-8',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status >= 500 && !res.body.trim().startsWith('{')) throw new Error(`收费平台暂时不可用（HTTP ${res.status}）`);
  return res.body;
}

export async function call<T>(services: Services, url: string, what: string, body?: unknown): Promise<T> {
  return unwrapCwpay<T>(await fetchBody(services, url, body), what);
}

/** pay/queryUserInfo/<token> needs the token; the dealcas jsonData has idserial = 学号 = campus username. */
export function idserial(services: Pick<HostServices, 'campus'>) {
  const id = services.campus.status().username;
  if (!id) throw new Error('还没有登录校园账号');
  return id;
}

/** All payable projects (categories + one level of folders), as the 更多应用 page lists them. */
export async function listProjects(services: Services): Promise<PayProject[]> {
  const cats = await call<RawProject[]>(services, `pay/pay/cos/merchant/getProjectTypeAndProjectInfoListInit/${SCHOOL_CODE}`, '缴费项目');
  const { projects, folders } = flattenProjects(cats ?? []);
  const nested = await Promise.all(
    folders.slice(0, 12).map((f) =>
      call<RawProject[]>(services, `pay/pay/cos/merchant/getProjectTypeAndProjectInfoList/${f.id}`, '缴费项目').then(
        (c) => folderProjects(c ?? [], f.category),
        () => [] as PayProject[],
      ),
    ),
  );
  return [...projects, ...nested.flat()];
}

/** 学费住宿费 (tuitionAndDormPay page): find the project, then getTuitionAndDormList/<idserial>/<projectId>. */
export async function queryTuition(services: Services) {
  const project = (await listProjects(services)).find(isTuitionProject);
  if (!project) throw new Error('收费平台目前没有开放“学费住宿费”缴费项目');
  // "0001 无欠费##" = nothing owed (unwrapTuition).
  const rows = unwrapTuition(await fetchBody(services, `pay/web/tuitionAndDorm/getTuitionAndDormList/${encodeURIComponent(idserial(services))}/${encodeURIComponent(project.id)}`));
  return { project: project.name, ...tuitionItems(rows) };
}

/** 我的订单 (orderList page): newest first; dates YYYY-MM-DD. */
export async function queryOrders(services: Services, opts: { page?: number; size?: number; from?: string; to?: string; project?: string }) {
  const [data, dict] = await Promise.all([
    call<{ records?: RawOrder[]; total?: number }>(services, '/pay/web/order/pageOrderlist', '订单记录', {
      pageCurrent: opts.page ?? 1,
      pageSize: opts.size ?? 20,
      projectName: opts.project ?? '',
      projectId: '',
      displayStatus: '',
      startCreateDate: opts.from ?? '',
      endCreateDate: opts.to ?? '',
      schoolCode: SCHOOL_CODE,
    }),
    call<unknown>(services, `common/com/dict/getDictDatasByTypes/TRADE_DISPLAY_STATUS/${SCHOOL_CODE}/${DATA_SOURCE}`, '订单状态').catch(() => null),
  ]);
  return orderRecords(data, statusDict(dict));
}
