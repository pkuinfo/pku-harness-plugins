/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import {
  freeSlots,
  isProfilePage,
  layerMsg,
  matchBuilding,
  normalizeTime,
  overlaps,
  parseApplications,
  parseLockStatus,
  parseSchedule,
  parseSpace,
  parseStudent,
  submitForm,
  submitOutcome,
} from './parse';

// Anonymised from the 2026-10 /space page (ids shortened where irrelevant).
const card = (id: string, name: string, code: string, floor: number, cap: number, min: number, door: string, extra = '') => `
  <div class="sp-card" data-room-id="${id}" data-room-name="${name}">
    <div class="sp-card-head"><span class="cr-room-name">${name}</span><span class="sp-code">${code}</span></div>
    <ul class="sp-features">
      <li><i class="ri-building-line"></i><span>${floor}层</span></li>
      <li><i class="ri-group-line"></i><span>可容纳 <b>${cap}</b> 人</span></li>
      <li><i class="ri-user-line"></i><span>至少 <b>${min}</b> 人起约</span></li>
    </ul>
    <div class="sp-devs">
      <span class="cr-chip sp-dev ${door === '关门' ? 'is-off' : 'is-on'}" data-dev-kind="door"><i></i>门 <b class="sp-dev-state">${door}</b></span>
      <span class="cr-chip sp-dev is-on" data-dev-kind="screen"><i></i>屏幕 <b class="sp-dev-state">正常</b></span>
    </div>
    <div class="sp-actions"><a class="sp-btn-preview" data-room-id="${id}" href="javascript:;">预览</a><a class="sp-btn-apply" data-room-id="${id}" ${extra}>去申请</a></div>
  </div>`;
const panel = (id: string, name: string, code: string, count: number, cards: string) => `
  <div class="cr-panel sp-building" data-building-id="${id}">
    <div class="cr-panel-head"><span class="cr-panel-title">${name}</span><span class="sp-building-code">(${code})</span>
      <span class="cr-panel-count">共 <b>${count}</b> 间可预约</span></div>
    <div class="sp-grid">${cards}</div>
  </div>`;
const SPACE = `<html><body><main class="sp-main">
  ${panel('924128798427975680', '二教', '02', 10, card('924129433781145600', '514', '02514', 5, 10, 3, '关门', 'href="/space/apply?roomId=924129433781145600"') + card('924129433781145601', '515', '02515', 5, 6, 3, '开门'))}
  ${panel('924128697978589184', '四教', '04', 1, card('924129433781145700', '301', '04301', 3, 20, 5, '常开'))}
  ${panel('924129024664539136', '地学', '09', 0, '')}
</main></body></html>`;

describe('parseSpace', () => {
  test('buildings and room cards', () => {
    const { buildings, rooms } = parseSpace(SPACE);
    expect(buildings).toEqual([
      { id: '924128798427975680', name: '二教', code: '02', bookable: 10 },
      { id: '924128697978589184', name: '四教', code: '04', bookable: 1 },
      { id: '924129024664539136', name: '地学', code: '09', bookable: 0 },
    ]);
    expect(rooms).toHaveLength(3);
    expect(rooms[0]).toEqual({
      id: '924129433781145600',
      name: '514',
      code: '02514',
      buildingId: '924128798427975680',
      building: '二教',
      floor: 5,
      capacity: 10,
      minPeople: 3,
      door: '关门',
      screen: '正常',
      applyHref: '/space/apply?roomId=924129433781145600',
    });
    expect(rooms[1]).toMatchObject({ name: '515', door: '开门', capacity: 6 });
    expect(rooms[1].applyHref).toBeUndefined();
    expect(rooms[2]).toMatchObject({ building: '四教', floor: 3, capacity: 20, minPeople: 5, door: '常开' });
  });
  test('cards outside their panel fall back to the code prefix', () => {
    const html = `<div data-building-id="1"><span class="cr-panel-title">二教</span><span class="sp-building-code">(02)</span></div>
      <div data-building-id="2"><span class="cr-panel-title">地学</span><span class="sp-building-code">(09)</span></div>
      ${card('7', '101', '09101', 1, 8, 3, '关门')}`;
    expect(parseSpace(html).rooms[0]).toMatchObject({ buildingId: '2', building: '地学' });
  });
  test('login page yields nothing', () => {
    expect(parseSpace('<html><form action="/login">登录</form></html>')).toEqual({ buildings: [], rooms: [] });
  });
});

describe('matchBuilding', () => {
  const { buildings } = parseSpace(SPACE);
  test('names, numbers and pinyin', () => {
    expect(matchBuilding('二教', buildings)?.code).toBe('02');
    expect(matchBuilding('4', buildings)?.name).toBe('四教');
    expect(matchBuilding('09', buildings)?.name).toBe('地学');
    expect(matchBuilding('地学楼', buildings)?.name).toBe('地学');
    expect(matchBuilding('sijiao', buildings)?.name).toBe('四教');
    expect(matchBuilding('理教', buildings)).toBeNull();
  });
});

describe('parseLockStatus', () => {
  test('numeric map, junk ignored', () => {
    expect(parseLockStatus('{"924129433781145600":1,"9":0,"x":"y"}')).toEqual({ '924129433781145600': 1, '9': 0 });
    expect(parseLockStatus('<html>')).toEqual({});
    expect(parseLockStatus('[1,2]')).toEqual({});
  });
});

describe('schedule / free slots', () => {
  const body = JSON.stringify([
    { beginTime: '2026-10-19 20:40:00', endTime: '2026-10-19 21:30:00' },
    { beginTime: '2026-10-20 14:00:00', endTime: '2026-10-20 16:00:00' },
    { beginTime: 'x' },
  ]);
  test('parseSchedule', () => {
    expect(parseSchedule(body)).toEqual([
      { begin: '2026-10-19 20:40:00', end: '2026-10-19 21:30:00' },
      { begin: '2026-10-20 14:00:00', end: '2026-10-20 16:00:00' },
    ]);
    expect(() => parseSchedule('<html>login</html>')).toThrow('北大空间');
  });
  test('free periods per day', () => {
    const [mon, tue] = freeSlots(['2026-10-19', '2026-10-20'], parseSchedule(body));
    expect(mon.free).toHaveLength(12);
    expect(mon.free.find((p) => p.begin === '20:40')).toBeUndefined();
    expect(mon.free[0]).toEqual({ period: 1, begin: '08:00', end: '08:50' });
    expect(mon.free.at(-1)).toEqual({ period: 13, begin: '21:40', end: '22:30' });
    expect(mon.taken).toEqual([{ begin: '2026-10-19 20:40:00', end: '2026-10-19 21:30:00' }]);
    // 14:00–16:00 covers periods 6 (14:00) and 7 (15:10).
    expect(tue.free.map((p) => p.period)).toEqual([1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13]);
  });
  test('periods that already started are dropped', () => {
    const [day] = freeSlots(['2026-10-19'], [], '2026-10-19 19:45:00');
    expect(day.free.map((p) => p.period)).toEqual([12, 13]);
  });
});

describe('isProfilePage', () => {
  test('/personal redirect', () => {
    expect(isProfilePage('https://bdkj.pku.edu.cn/personal')).toBe(true);
    expect(isProfilePage('https://bdkj.pku.edu.cn/personal?from=apply')).toBe(true);
    expect(isProfilePage('https://bdkj.pku.edu.cn/personal/user')).toBe(false);
    expect(isProfilePage('https://bdkj.pku.edu.cn/space')).toBe(false);
  });
});

describe('parseStudent', () => {
  test('keeps id/serial/name, drops contact fields', () => {
    const body = JSON.stringify({ success: true, message: '', data: { id: '77', serial: '2200011523', name: '张三', mobilePhone: '138', email: 'a@b' } });
    expect(parseStudent(body)).toEqual({ id: '77', serial: '2200011523', name: '张三' });
  });
  test('failure message', () => {
    expect(() => parseStudent(JSON.stringify({ success: false, message: '学号与姓名不匹配', data: null }))).toThrow('学号与姓名不匹配');
  });
});

describe('submit', () => {
  test('form fields match the browser step-4 submit', () => {
    const fields = submitForm({
      roomId: '9',
      begin: '2026-10-20 14:00:00',
      end: '2026-10-20 16:00:00',
      reason: '讨论',
      participants: [
        { id: '77', serial: '2200011523', name: '张三' },
        { id: '78', serial: '2200011524', name: '李四' },
      ],
    });
    expect(fields.slice(0, 7)).toEqual([
      ['id', ''],
      ['beginTime', '2026-10-20 14:00:00'],
      ['endTime', '2026-10-20 16:00:00'],
      ['roomId', '9'],
      ['step', '3'],
      ['switchover', 'true'],
      ['reason', '讨论'],
    ]);
    expect(fields.slice(11)).toEqual([
      ['students[1].studentId', '78'],
      ['students[1].serial', '2200011524'],
      ['students[1].name', '李四'],
      ['students[1].sort', '1'],
    ]);
  });
  test('success is landing on /classRoom, failure reads layer.msg', () => {
    expect(submitOutcome('https://bdkj.pku.edu.cn/classRoom', '<script>layer.msg("无关")</script>').success).toBe(true);
    expect(submitOutcome('https://bdkj.pku.edu.cn/classRoom/apply', `<script>layer.msg('该时段已被预约', {icon: 2})</script>`)).toEqual({ success: false, message: '该时段已被预约' });
    expect(layerMsg('<p>none</p>')).toBeNull();
  });
});

describe('parseApplications', () => {
  // Mirrors the markup api.rs parse_applications targets (h5, color-red strong, fa-comment-dots, cancel link).
  const html = `<html><body><div id="results">
    <div class="row">
      <div class="col"><h5> 二教201 </h5><span class="color-red"><strong>申请成功</strong></span></div>
      <div class="col"><span>张三</span> 申请 <span>2026-10-18 10:00:00</span></div>
      <div class="col"><i class="fa fa-clock"></i> 2026-10-20 14:00 - 16:00</div>
      <div class="col"><em class="fas fa-comment-dots"></em> 课题组讨论 </div>
      <div class="col">参与人： 张三[ 未签到 ] 李四[ 未签到 ] 王五[ 已签到 ]</div>
      <a href="/classRoom/cancelApply/1234567" class="btn">取消</a>
    </div>
    <div class="row">
      <div class="col"><h5>四教301</h5><span class="color-red"><strong> 申请已取消 </strong></span></div>
      <div class="col">张三 申请 2026-10-01 09:30:00</div>
      <div class="col">2026-10-03 08:00 - 10:00</div>
    </div>
    <div class="row"><p>no heading</p></div>
  </div></body></html>`;

  test('rows', () => {
    const [a, b, ...rest] = parseApplications(html);
    expect(rest).toHaveLength(0);
    expect(a).toEqual({
      id: '1234567',
      room: '二教201',
      status: '申请成功',
      applicant: '张三',
      appliedAt: '2026-10-18 10:00:00',
      time: '2026-10-20 14:00 - 16:00',
      reason: '课题组讨论',
      participants: ['张三', '李四', '王五'],
      canCancel: true,
    });
    expect(b).toMatchObject({ id: '', room: '四教301', status: '申请已取消', applicant: '张三', time: '2026-10-03 08:00 - 10:00', canCancel: false, participants: [] });
  });
  test('empty page', () => {
    expect(parseApplications('<div id="results"></div>')).toEqual([]);
    expect(parseApplications('<div id="results"><div class="cr-empty"><i></i><p>暂无申请记录</p></div></div>')).toEqual([]);
  });
});

describe('time helpers', () => {
  test('normalizeTime', () => {
    expect(normalizeTime('2026-10-20 14:00')).toBe('2026-10-20 14:00:00');
    expect(normalizeTime('2026-1-5T9:30')).toBe('2026-01-05 09:30:00');
    expect(normalizeTime('2026-10-20 14:00:30')).toBe('2026-10-20 14:00:30');
    expect(normalizeTime('2026-02-30 10:00')).toBeNull();
    expect(normalizeTime('tomorrow 3pm')).toBeNull();
  });
  test('overlaps', () => {
    const slot = { begin: '2026-10-20 14:00:00', end: '2026-10-20 16:00:00' };
    expect(overlaps('2026-10-20 15:00:00', '2026-10-20 17:00:00', slot)).toBe(true);
    expect(overlaps('2026-10-20 16:00:00', '2026-10-20 17:00:00', slot)).toBe(false);
    expect(overlaps('2026-10-20 12:00:00', '2026-10-20 14:00:00', slot)).toBe(false);
    expect(overlaps('2026-10-20 12:00:00', '2026-10-20 14:00:00', { ...slot, begin: '14:00', end: '16:00' })).toBe(false);
  });
});
