import type { HostServices } from '@pku-harness/sdk';

import {
  encodeForm,
  isProfilePage,
  layerMsg,
  parseApplications,
  parseLockStatus,
  parseSchedule,
  parseSpace,
  parseStudent,
  submitForm,
  submitOutcome,
  type Application,
  type BookedSlot,
  type Building,
  type Room,
  type Student,
} from './parse';

/**
 * 北大空间 requests. Rooms / availability / my list follow the 2026-10 redesign (/space,
 * /space/schedule, /classRoom); student check, submit and cancel are pkucli crates/bdkj/src/api.rs
 * and are not yet verified against the new site. The harness adapter 'bdkj' holds the session.
 */

export const PROFILE_MSG = '首次预约前需要在北大空间「个人信息」页完善资料（请在浏览器打开 https://bdkj.pku.edu.cn/personal 完成）';

type Services = Pick<HostServices, 'campus'>;

const FORM = 'application/x-www-form-urlencoded; charset=UTF-8';
const XHR = { 'x-requested-with': 'XMLHttpRequest', accept: 'application/json, text/javascript, */*; q=0.01' };

async function call(services: Services, url: string, init: { method?: 'GET' | 'POST'; form?: [string, string][]; xhr?: boolean; referer?: string } = {}) {
  const res = await services.campus.request('bdkj', {
    url,
    method: init.method ?? (init.form ? 'POST' : 'GET'),
    contentType: init.form ? FORM : undefined,
    body: init.form ? encodeForm(init.form) : undefined,
    headers: { ...(init.xhr ? XHR : {}), ...(init.referer ? { referer: init.referer } : {}) },
  });
  if (res.status >= 400) throw new Error(`北大空间返回 HTTP ${res.status}`);
  // Any page bounced to 个人信息 means the profile must be completed in a browser first.
  if (isProfilePage(res.url)) throw new Error(PROFILE_MSG);
  return res;
}

/** GET /space (buildings + room cards), with /space/lockStatus codes attached when available. */
export async function space(services: Services): Promise<{ buildings: Building[]; rooms: Room[] }> {
  const [page, locks] = await Promise.all([
    call(services, '/space'),
    call(services, '/space/lockStatus', { xhr: true, referer: 'https://bdkj.pku.edu.cn/space' }).then(
      (r) => parseLockStatus(r.body),
      () => ({}) as Record<string, number>,
    ),
  ]);
  const parsed = parseSpace(page.body);
  if (!parsed.rooms.length && !parsed.buildings.length) throw new Error('没有从北大空间读到教室列表（页面结构可能又改了）');
  for (const r of parsed.rooms) if (r.id in locks) r.lockCode = locks[r.id];
  return parsed;
}

/** GET /space/schedule: taken slots of a room for the week starting `startDate` ("YYYY-MM-DD"). */
export async function schedule(services: Services, roomId: string, startDate: string): Promise<BookedSlot[]> {
  const q = `roomId=${encodeURIComponent(roomId)}&startDate=${encodeURIComponent(startDate)}`;
  const res = await call(services, `/space/schedule?${q}`, { xhr: true, referer: 'https://bdkj.pku.edu.cn/space' });
  return parseSchedule(res.body);
}

/**
 * Open the room's 去申请 page the way the browser does. An incomplete profile is redirected to
 * /personal, which no form submission can get past, so that is reported as PROFILE_MSG.
 */
export async function checkCanApply(services: Services, href: string | undefined) {
  if (!href) return;
  if (/^https?:\/\//i.test(href) && !/^https?:\/\/bdkj\.pku\.edu\.cn\//i.test(href)) return;
  await call(services, /^https?:|^\//i.test(href) ? href : `/${href}`, { referer: 'https://bdkj.pku.edu.cn/space' });
}

export async function searchStudent(services: Services, serial: string, name: string): Promise<Student> {
  const res = await call(services, '/classRoom/seachStudent', {
    xhr: true,
    form: [
      ['serial', serial],
      ['name', name],
    ],
  });
  try {
    return parseStudent(res.body);
  } catch (e) {
    throw new Error(`参与人 ${serial} ${name} 校验失败：${(e as Error).message}`);
  }
}

/** GET /classRoom: my records (`div.cr-empty` → []). */
export async function listApplications(services: Services): Promise<Application[]> {
  return parseApplications((await call(services, '/classRoom')).body);
}

/**
 * api.rs submit_apply: the browser's last form step posted straight to handle/submit (step=3,
 * switchover=true); the harness follows the 302 so `res.url` is where it landed.
 */
export async function submit(services: Services, input: { roomId: string; begin: string; end: string; reason: string; participants: Student[] }) {
  const res = await call(services, '/classRoom/handle/submit', { form: submitForm(input), referer: 'https://bdkj.pku.edu.cn/classRoom/apply' });
  return submitOutcome(res.url, res.body);
}

/** api.rs cancel_apply, then confirmed against the list (a stray layer.msg alone is not proof). */
export async function cancel(services: Services, applyId: string): Promise<Application | null> {
  const res = await call(services, `/classRoom/cancelApply/${encodeURIComponent(applyId)}`);
  const msg = layerMsg(res.body);
  const list = res.body.includes('id="results"') ? parseApplications(res.body) : await listApplications(services);
  const after = list.find((a) => a.id === applyId) ?? null;
  if (after?.canCancel && after.status !== '申请已取消') throw new Error(`取消没有生效${msg ? `：${msg}` : ''}`);
  return after;
}
