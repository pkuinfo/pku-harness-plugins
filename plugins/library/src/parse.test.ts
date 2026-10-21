/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import {
  daysBetween,
  icData,
  parseHoldings,
  parseHolds,
  parseHours,
  parseLoans,
  parseMembers,
  parsePickup,
  parseRenew,
  parseSearch,
  parseSpaceReservations,
  parseSpaceRooms,
  parseStudySeats,
  planReminders,
  renewError,
  searchRequest,
  spaceReserveBody,
  stampOf,
  statusText,
} from './parse';

// Fixtures are trimmed copies of real responses (public catalog data) or synthetic records with
// the captured field names; ids, names and barcodes are made up.

describe('catalog', () => {
  test('searchRequest encodes once, same value in query and body (as the OPAC does)', () => {
    const r = searchRequest('any', ' 三体 ', 0, 10);
    expect(r.path).toBe('/BookAPI/new_opac/query?cc_all=%E4%B8%89%E4%BD%93&rows=10&start=0&sort=&facet.mincount=1&');
    expect(JSON.parse(r.body)).toEqual({ cc_all: '%E4%B8%89%E4%BD%93', rows: 10, start: 0, sort: '', 'facet.mincount': 1 });
    expect(searchRequest('isbn', '978-7-229-15100-3', 10, 5).path).toStartWith('/BookAPI/new_opac/query?isbn=9787229151003&rows=5&start=10');
    expect(searchRequest('callNumber', 'I247.55/10b3', 0, 10).path).toStartWith('/BookAPI/new_opac/query?callnumber-search=I247.55%2F10b3&');
  });

  test('parseSearch', () => {
    const r = parseSearch({
      response: {
        numFound: 197,
        docs: [
          {
            id: 'AAAA%2FBB%3D%3D',
            title: ['三体. [Ⅱ], 黑暗森林'],
            author: ['刘慈欣, 1963- 著'],
            publisher: ['重庆出版社'],
            publishDate: ['2022'],
            'callnumber-search': ['I247.55/10b2:2', 'I247.55/10b2:2', 'I247.55/10b2:2(FZ)'],
          },
          { id: 'x', title: [] },
        ],
      },
    });
    expect(r).toEqual({
      total: 197,
      books: [{ id: 'AAAA%2FBB%3D%3D', title: '三体. [Ⅱ], 黑暗森林', author: '刘慈欣, 1963- 著', publisher: '重庆出版社', year: '2022', callNumbers: ['I247.55/10b2:2', 'I247.55/10b2:2(FZ)'] }],
    });
  });

  test('parseHoldings: statuses, due dates, ordering', () => {
    const h = parseHoldings('ID1', {
      data: {
        TitleInfo: [
          {
            author: '刘慈欣, 1963- 著',
            ISBN: ['9787229151003'],
            CallInfo: [
              {
                callNumber: 'I247.55/10b3',
                libraryID: '北大中心馆',
                ItemInfo: [
                  { itemID: '1001', chargeable: false, homeLocation: '文学阅览室(中文)(西区301)', dueDate: Date.UTC(2026, 10, 5, 16), currentLocationID: '已借出', currentLocation: '已借出', homeLocationID: '西区301中文文学' },
                  { itemID: '1002', chargeable: true, homeLocation: '库本阅览室(西区109)', currentLocationID: '库本阅览室', currentLocation: '库本阅览室(西区109)', homeLocationID: '库本阅览室' },
                  {
                    itemID: '1003',
                    chargeable: true,
                    homeLocation: '文学阅览室(中文)(西区301)',
                    currentLocationID: '教参阅览室',
                    currentLocation: '通识参阅厅-教参区',
                    homeLocationID: '西区301中文文学',
                    reserveCollectionID: '教学参考书',
                    reserveCirculationRule: '二十四小时',
                  },
                ],
              },
            ],
            TitleAvailabilityInfo: { holdable: true, totalCopiesAvailable: 2, locationOfFirstAvailableItem: '库本阅览室(西区109)' },
          },
        ],
      },
      BookInfo: { title: ['三体'], publisher: ['重庆出版社'], publishDate: ['2020'], isbn_pure: ['9787229151003'], abstract: ['<p>简介&nbsp;文字</p>'] },
    });
    expect(h.title).toBe('三体');
    expect(h.summary).toBe('简介 文字');
    expect([h.totalCopies, h.availableCopies, h.holdable, h.firstAvailableAt]).toEqual([3, 2, true, '库本阅览室(西区109)']);
    expect(h.copies.map((c) => [c.itemId, c.status, c.location])).toEqual([
      ['1002', 'available', '库本阅览室(西区109)'],
      ['1003', 'elsewhere', '通识参阅厅-教参区'],
      ['1001', 'checked_out', '文学阅览室(中文)(西区301)'],
    ]);
    expect(h.copies[2].dueDate).toMatch(/^2026-11-0[56]$/);
    expect(h.copies[1].note).toBe('教学参考书（二十四小时）');
  });
});

describe('account', () => {
  const account = {
    timestamp: 1,
    status: 0,
    data: {
      patronInfo: { displayName: '张三', alternativeID: '2600000000' },
      patronCheckoutInfo: [
        { itemID: 'B2', title: '算法导论', callNumber: 'TP301.6/12', itemLibraryDescription: '北大中心馆', checkoutDate: '2026-09-01T10:00:00', dueDate: '2026-10-25T23:59:00', renewalsRemaining: 2, overdue: false },
        { itemID: 'B1', title: '<b>线性代数</b>', dueDate: '2026-10-18T23:59:00', renewalsRemaining: 0, overdue: true },
        { itemID: 'B3', title: '数据库系统概念', dueDate: '2026-12-01T23:59:00', recallDueDate: '2026-11-02T23:59:00', renewalsRemaining: 1, lastRenewedDate: '2026-10-20T09:00:00' },
        { title: 'no id' },
      ],
      patronHoldInfo: [
        { itemID: 'H1', callNumber: 'O1/1', displayableCallNumber: 'O1/1', title: '数学分析', status: '在途', pickupLibraryDescription: '总借还台', available: false },
        { itemID: 'H2', title: '已取消的', holdInactiveType: 'HOLD_INACTIVE_REASON_CANCELLED' },
        { taskID: 'T9', title: '日文书', ChangpingriwenbookFlag: true, available: true },
      ],
    },
  };

  test('parseLoans: sorted, recall, overdue, renewable', () => {
    const r = parseLoans(account, '2026-10-20');
    expect(r.name).toBe('张三');
    expect(r.loans.map((l) => [l.itemId, l.title, l.dueDate, l.daysLeft, l.overdue, l.renewable])).toEqual([
      ['B1', '线性代数', '2026-10-18', -2, true, false],
      ['B2', '算法导论', '2026-10-25', 5, false, true],
      ['B3', '数据库系统概念', '2026-11-02', 13, false, false],
    ]);
    expect(r.loans[2].recallDueDate).toBe('2026-11-02');
  });

  test('dead session (data null) throws', () => {
    expect(() => parseLoans({ timestamp: 1, status: 0, desc: '', data: null }, '2026-10-20')).toThrow('登录可能已失效');
  });

  test('parseHolds drops cancelled/filled', () => {
    const h = parseHolds(account);
    expect(h.map((x) => [x.itemId, x.title, x.available, x.changping, x.taskId])).toEqual([
      ['H1', '数学分析', false, false, null],
      [null, '日文书', true, true, 'T9'],
    ]);
  });

  test('parseRenew + renewError', () => {
    expect(parseRenew({ status: 0, data: { dueDate: '2026-11-24T23:59:00' } })).toEqual({ ok: true, dueDate: '2026-11-24' });
    expect(parseRenew({ status: 0, data: { errors: [{ message: 'Item has a pending hold request' }] } })).toEqual({ ok: false, reason: '该书已被他人预约，无法续借' });
    expect(parseRenew({ data: { faultResponse: { string: 'Override required to exceed renewal limit.' } } })).toEqual({ ok: false, reason: '该书已达到续借上限' });
    expect(parseRenew({ desc: '服务异常' })).toEqual({ ok: false, reason: '服务异常' });
    expect(renewError('User BLOCKED')).toBe('因有超期未还的图书或欠款，账户已被限制');
  });

  test('parsePickup tolerates strings and objects', () => {
    expect(parsePickup({ data: { list: ['总借还台', ' '], advised: '总借还台' } })).toEqual({ options: [{ id: '总借还台', name: '总借还台' }], advised: '总借还台' });
    expect(parsePickup({ data: { list: [{ code: 'ZJHT', name: '总借还台' }], advised: { code: 'ZJHT' } } })).toEqual({ options: [{ id: 'ZJHT', name: '总借还台' }], advised: 'ZJHT' });
  });

  test('parseHours', () => {
    expect(parseHours({ status: 200, object: { date: '2026-10-21', isOpen: true, openingTime: '6:30-22:30', remarks: '' } })).toEqual({ date: '2026-10-21', open: true, hours: '6:30-22:30', remarks: null });
  });
});

describe('IC space', () => {
  test('icData', () => {
    expect(icData({ code: 0, data: [1] }, 'x')).toEqual([1]);
    expect(() => icData({ code: 300, message: '用户未登录，请重新登录' }, '查询')).toThrow('查询失败：用户未登录，请重新登录');
  });

  test('parseStudySeats (psgSeatMenu, captured shape)', () => {
    const a = parseStudySeats([
      { id: 3, name: '二层（座位）', totalCount: 38, remainCount: 0, children: [{ id: 6, name: '218室', totalCount: 38, remainCount: 0 }] },
      { id: 4, name: '三层（座位）', totalCount: 76, remainCount: 1, children: [{ id: 17, name: '304室', totalCount: 38, remainCount: 1 }, { id: 7, name: '313室', totalCount: 38, remainCount: 0 }] },
    ]);
    expect(a).toEqual([
      { floor: '二层（座位）', room: '218室', total: 38, free: 0 },
      { floor: '三层（座位）', room: '304室', total: 38, free: 1 },
      { floor: '三层（座位）', room: '313室', total: 38, free: 0 },
    ]);
  });

  const devices = [
    {
      devId: 101,
      devName: '202研讨室',
      labName: '西区二层',
      roomName: '研讨室',
      minUser: 3,
      maxUser: 8,
      openStart: '08:00',
      openEnd: '17:00',
      resvRule: { minResvTime: 30, maxResvTime: 180 },
      resvInfo: [
        { startTime: '2026-10-21 09:00:00', endTime: '2026-10-21 10:30:00', resvStatus: 2 },
        { startTime: new Date(2026, 9, 21, 13, 0).getTime(), endTime: new Date(2026, 9, 21, 14, 0).getTime(), resvStatus: 4 },
        { startTime: '2026-10-21 15:00:00', endTime: '2026-10-21 16:00:00', resvStatus: 128 },
        { startTime: '2026-10-22 08:00:00', endTime: '2026-10-22 09:00:00', resvStatus: 2 },
      ],
    },
  ];

  test('parseSpaceRooms: free periods on another day', () => {
    const [r] = parseSpaceRooms(devices, '2026-10-21', '2026-10-20 12:00');
    expect(r.devId).toBe('101');
    expect(r.location).toBe('西区二层 研讨室');
    expect(r.open).toBe('08:00-17:00');
    expect(r.taken).toEqual([
      { start: '09:00', end: '10:30' },
      { start: '13:00', end: '14:00' },
    ]);
    expect(r.free).toEqual([
      { start: '08:00', end: '09:00' },
      { start: '10:30', end: '13:00' },
      { start: '14:00', end: '17:00' },
    ]);
  });

  test('parseSpaceRooms: today starts at now (10-minute grid), drops gaps shorter than the minimum', () => {
    const [r] = parseSpaceRooms(devices, '2026-10-21', '2026-10-21 12:41');
    expect(r.free).toEqual([{ start: '14:00', end: '17:00' }]);
    const [late] = parseSpaceRooms(devices, '2026-10-21', '2026-10-21 16:45');
    expect(late.free).toEqual([]);
  });

  test('statusText + parseSpaceReservations', () => {
    expect(statusText(2)).toBe('待生效');
    expect(statusText(4 | 64)).toBe('已签到、已生效');
    const list = parseSpaceReservations(
      [
        {
          uuid: 'u-2',
          appAccNo: 77,
          classKind: 1,
          resvStatus: 2,
          resvBeginTime: '2026-10-22 14:00:00',
          resvEndTime: '2026-10-22 16:00:00',
          testName: '小组讨论',
          resvDevInfoList: [{ devName: '203研讨室', roomName: '研讨室', labName: '西区二层' }],
          resvMemberInfoList: [{ accNo: 77, trueName: '张三', logonName: '2600000000' }, { accNo: 78, trueName: '李四' }],
        },
        { uuid: 'u-1', appAccNo: 77, resvProperty: 32, resvStatus: 4, resvBeginTime: new Date(2026, 9, 10, 6, 30).getTime(), resvEndTime: '2026-11-07 22:00:00', resvDevInfoList: [{ devName: '304-12' }] },
        { uuid: 'u-3', appAccNo: 99, classKind: 1, resvStatus: 2, resvBeginTime: '2026-10-23 10:00:00', resvEndTime: '2026-10-23 11:00:00' },
      ],
      '77',
    );
    expect(list.map((r) => [r.uuid, r.kind, r.place, r.begin, r.status, r.canCancel])).toEqual([
      ['u-1', '研修专座', '304-12', '2026-10-10 06:30', '已生效', false],
      ['u-2', '研讨室', '西区二层 研讨室 203研讨室', '2026-10-22 14:00', '待生效', true],
      ['u-3', '研讨室', '（未知位置）', '2026-10-23 10:00', '待生效', false],
    ]);
    expect(list[1].members).toEqual(['张三', '李四']);
  });

  test('parseMembers + spaceReserveBody', () => {
    expect(parseMembers([{ accNo: 78, logonName: '2600000001', trueName: '李四', status: 1 }, { accNo: 79, logonName: '2600000002', localstatus: 2 }, { logonName: 'x' }])).toEqual([
      { accNo: '78', id: '2600000001', name: '李四', disabled: false },
      { accNo: '79', id: '2600000002', name: null, disabled: true },
    ]);
    expect(spaceReserveBody({ devId: '101', appAccNo: '77', members: ['77', '78', '79'], begin: '2026-10-22 14:00', end: '2026-10-22 16:00', title: '小组讨论', memo: '' })).toEqual({
      sysKind: 1,
      appAccNo: 77,
      memberKind: 2,
      resvBeginTime: '2026-10-22 14:00:00',
      resvEndTime: '2026-10-22 16:00:00',
      testName: '小组讨论',
      resvKind: 2,
      resvProperty: 0,
      appUrl: '',
      resvMember: [77, 78, 79],
      resvDev: [101],
      memo: '',
      captcha: '',
      addServices: [],
    });
  });
});

describe('dates', () => {
  test('stampOf', () => {
    expect(stampOf('2026-10-25T23:59:00')).toBe('2026-10-25 23:59');
    expect(stampOf('2026/1/5 9:30')).toBe('2026-01-05 09:30');
    expect(stampOf('2026-10-25')).toBe('2026-10-25');
    expect(stampOf(new Date(2026, 9, 21, 8, 5).getTime())).toBe('2026-10-21 08:05');
    expect(stampOf('soon')).toBeNull();
    expect(stampOf(null)).toBeNull();
  });

  test('daysBetween', () => {
    expect(daysBetween('2026-10-20', '2026-10-25')).toBe(5);
    expect(daysBetween('2026-10-20', '2026-10-18')).toBe(-2);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });
});

describe('planReminders', () => {
  const now = new Date(2026, 9, 20, 12, 0).getTime();
  const opts = { daysBefore: 2, time: '09:00', nowMs: now };

  test('creates, moves renewed, removes returned, keeps unchanged', () => {
    const plan = planReminders(
      [
        { itemId: 'A', title: '算法导论', dueDate: '2026-10-30' },
        { itemId: 'B', title: '线性代数', dueDate: '2026-11-20' },
        { itemId: 'C', title: '数据库', dueDate: '2026-11-01' },
        { itemId: 'D', title: '超期的书', dueDate: '2026-10-10' },
      ],
      { B: { todoId: 't-b', dueDate: '2026-10-28', title: '还书：线性代数' }, C: { todoId: 't-c', dueDate: '2026-11-01', title: '还书：数据库' }, Z: { todoId: 't-z', dueDate: '2026-10-22', title: 'x' } },
      opts,
    );
    expect(plan.create).toEqual([{ itemId: 'A', title: '还书：算法导论', dueDate: '2026-10-30', remindAt: new Date(2026, 9, 28, 9, 0).getTime(), dueAt: new Date(2026, 9, 30, 23, 59).getTime() }]);
    expect(plan.update.map((u) => [u.itemId, u.todoId, u.dueDate, u.remindAt])).toEqual([['B', 't-b', '2026-11-20', new Date(2026, 10, 18, 9, 0).getTime()]]);
    expect(plan.keep).toEqual(['C']);
    expect(plan.remove).toEqual([{ itemId: 'Z', todoId: 't-z' }]);
  });

  test('reminder already in the past fires a minute from now', () => {
    const plan = planReminders([{ itemId: 'A', title: '明天到期', dueDate: '2026-10-21' }], {}, opts);
    expect(plan.create[0].remindAt).toBe(now + 60_000);
  });
});
