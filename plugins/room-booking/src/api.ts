import type { HostServices } from '@pku-harness/sdk';

import {
  encodeForm,
  layerMsg,
  parseApplications,
  parseHistory,
  parseRooms,
  parseStudent,
  submitForm,
  submitOutcome,
  type Application,
  type BookedSlot,
  type Room,
  type Student,
} from './parse';

/** 北大空间 requests (pkucli crates/bdkj/src/api.rs). The harness adapter 'bdkj' holds the session. */

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
  return res;
}

export async function listRooms(services: Services, buildingId: string): Promise<Room[]> {
  const res = await call(services, '/room/classRoom', {
    xhr: true,
    form: [
      ['buildingId', buildingId],
      ['roomId', ''],
      ['beginTime', ''],
      ['endTime', ''],
    ],
  });
  return parseRooms(res.body);
}

/** Taken slots of a room from `startDate` ("YYYY-MM-DD HH:MM:SS") on. */
export async function bookedSlots(services: Services, roomId: string, startDate: string): Promise<BookedSlot[]> {
  const res = await call(services, `/classRoom/historyTime?id=&roomId=${encodeURIComponent(roomId)}`, { xhr: true, form: [['startDate', startDate]] });
  return parseHistory(res.body);
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
