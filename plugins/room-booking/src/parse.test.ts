/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import {
  BUILDINGS,
  buildingId,
  layerMsg,
  normalizeTime,
  overlaps,
  parseApplications,
  parseHistory,
  parseRooms,
  parseStudent,
  submitForm,
  submitOutcome,
} from './parse';

describe('buildingId', () => {
  test('names, pinyin and numbers (api.rs building_id)', () => {
    expect(buildingId('二教')).toBe(BUILDINGS.二教);
    expect(buildingId('sijiao')).toBe('924128697978589184');
    expect(buildingId('09')).toBe('924129024664539136');
    expect(buildingId('理教')).toBeNull();
  });
});

describe('parseRooms', () => {
  test('room JSON (api.rs Room)', () => {
    const body = JSON.stringify([
      { id: '924131235851276288', code: '2-201', name: '二教201', popularity: '35', seatingCapacity: '12', bookable: true, locked: 0 },
      { id: '924131235851276289', name: '二教202', seatingCapacity: '', bookable: false, locked: 1 },
      { code: 'broken' },
    ]);
    expect(parseRooms(body)).toEqual([
      { id: '924131235851276288', code: '2-201', name: '二教201', capacity: 12, popularity: '35', bookable: true, locked: false },
      { id: '924131235851276289', code: '', name: '二教202', capacity: null, popularity: '', bookable: false, locked: true },
    ]);
  });
  test('HTML instead of JSON is a friendly error', () => {
    expect(() => parseRooms('<html>login</html>')).toThrow('北大空间');
  });
});

describe('parseHistory', () => {
  test('taken slots (api.rs HistoryTime)', () => {
    const body = JSON.stringify([{ id: '1', beginTime: '2026-10-20 14:00:00', endTime: '2026-10-20 16:00:00', intervals: '2' }, { id: '2' }]);
    expect(parseHistory(body)).toEqual([{ id: '1', begin: '2026-10-20 14:00:00', end: '2026-10-20 16:00:00', intervals: '2' }]);
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
    const slot = { id: '1', begin: '2026-10-20 14:00:00', end: '2026-10-20 16:00:00', intervals: '' };
    expect(overlaps('2026-10-20 15:00:00', '2026-10-20 17:00:00', slot)).toBe(true);
    expect(overlaps('2026-10-20 16:00:00', '2026-10-20 17:00:00', slot)).toBe(false);
    expect(overlaps('2026-10-20 12:00:00', '2026-10-20 14:00:00', slot)).toBe(false);
    expect(overlaps('2026-10-20 12:00:00', '2026-10-20 14:00:00', { ...slot, begin: '14:00', end: '16:00' })).toBe(false);
  });
});
