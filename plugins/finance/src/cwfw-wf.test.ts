/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  beforeLoadProc,
  buildArgs,
  buttonOk,
  cvstr,
  findCheck,
  findProc,
  mapEntry,
  parseCrossFields,
  parseLocal,
  parseMenu,
  parseOptions,
  procs,
  seedForm,
  subsystemEntry,
} from './cwfw-wf';

const fixture = (name: string) => readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8');
const W5609 = fixture('cwfw-window-5609.txt');
const W7600 = fixture('cwfw-window-7600.txt');

describe('window definitions (wf.rs)', () => {
  test('button procedure by its first parameter', () => {
    const p = findProc(W5609, '5574-d.year');
    expect(p?.hash).toBe('`$238b97ccfadb6466f0e40e90e17763c9');
    expect(p?.params).toHaveLength(11);
    expect(p?.params[8]).toBe('0-SHOWZEROGZ');
    expect(findProc(W5609, '9999-x')).toBeNull();
    // beforeLoadProcs are not button procedures
    expect(procs(W5609).map((x) => x.hash)).toEqual(['`$238b97ccfadb6466f0e40e90e17763c9']);
  });

  test('beforeLoad procedure', () => {
    expect(beforeLoadProc(W5609)).toEqual({ hash: '`$9baa856ef90181037dc0520df583f1a3', params: ['0-userinfo.userid'] });
    expect(beforeLoadProc(W7600)).toBeNull();
  });

  test('check_func is told apart from procs', () => {
    expect(findCheck(W7600, '10819-t.year2')?.hash).toBe('`$1d919a3aa838816987db6d806443dbb0');
    expect(findCheck(W7600, '10819-t.year2')?.params).toContain('10819-t.funcno');
    expect(findProc(W7600, '10819-t.year2')?.hash).toBe('`$09c151a719811efa039315b40bc840a0');
    expect(findProc(W7600, '10819-t.year2')?.params.at(-1)).toBe('0-userinfo.userid');
  });

  test('funcMap / bindMap entries (skipping the window-level funcMap)', () => {
    expect(mapEntry(W5609, 'funcMap', 'd.code')).toEqual({ head: '`$f930ffe8da00b8be0eb90ea0ce374454', params: ['5574-d.incometype', '5574-d.funcno'] });
    expect(mapEntry(W5609, 'funcMap', 'd.month_1')).toEqual({ head: '', params: [] });
    expect(mapEntry(W5609, 'bindMap', 'd.funcno')).toEqual({ head: '@$5e59f45e66d097068bc3db16762ea3f6', params: ['0-USERINFO.USERID'] });
    expect(mapEntry(W5609, 'bindMap', 'd.month_1')).toEqual({ head: '@$8f6c0e2d30839ac346d79fffb06476f7', params: [] });
    expect(mapEntry(W5609, 'funcMap', 'd.nope')).toBeNull();
    const stat = mapEntry('{bindMap:{"t.stype":"0:学生发放;1:薪酬劳务"}}', 'bindMap', 't.stype');
    expect(parseOptions(stat!.head)).toEqual([
      ['0', '学生发放'],
      ['1', '薪酬劳务'],
    ]);
  });
});

describe('arguments and context', () => {
  const ctx = { '0-USERINFO.USERID': '2000000000', '0-SHOWZEROGZ': 'N', '0-CURRFUNCTYPE': '3' };

  test('buildArgs maps form fields, context variables and empty slots', () => {
    const args = buildArgs(['5574-d.year', '5574-D.FUNCNO', '0-SHOWZEROGZ', '0-userinfo.userid', '', '0-currfunctype'], [['d.year', '2026'], ['d.funcno', '6']], ctx);
    expect(args).toEqual([
      { name: 'd.year', value: '2026', type: 'CHAR' },
      { name: 'D.FUNCNO', value: '6', type: 'CHAR' },
      { name: 'SHOWZEROGZ', value: 'N', type: 'char' },
      { name: 'userinfo.userid', value: '2000000000', type: 'CHAR' },
      { name: '', value: '', type: 'CHAR' },
      { name: 'currfunctype', value: '3', type: 'CHAR' },
    ]);
  });

  test('cvstr', () => {
    expect(cvstr(['0-USERINFO.USERID'], [], ctx)).toBe('#0-USERINFO.USERID#::2000000000');
    expect(cvstr(['5574-D.FUNCNO', '0-USERINFO.USERID'], [['d.funcno', '6']], ctx)).toBe('#5574-D.FUNCNO#::6$$#0-USERINFO.USERID#::2000000000');
  });

  test('seedForm writes <projid>$<func>-<FIELD>', () => {
    const c = seedForm(ctx, 'WF_CWBS', '13562', [['t.start', '2026-10-01']], 253);
    expect(c['WF_CWBS$13562-T.START']).toBe('2026-10-01');
    expect(c['0-CURRFUNC']).toBe(13562);
    expect(c.CURRMENUNODEID).toBe(253);
    expect(ctx).not.toHaveProperty('WF_CWBS$13562-T.START');
  });
});

describe('responses', () => {
  test('button results', () => {
    expect(buttonOk('pass')).toBe(true);
    expect(buttonOk('success: 执行成功.')).toBe(true);
    expect(buttonOk('pass;local(0-a:1;)')).toBe(true);
    expect(buttonOk('金额范围必填')).toBe(false);
    expect(buttonOk('error')).toBe(false);
  });

  test('local(…) variables', () => {
    expect(parseLocal('pass;local(0-BX_YBXALL_count:2;0-BX_YBXALL_amt:350.5;0-tks_count:0;)')).toEqual({ BX_YBXALL_count: '2', BX_YBXALL_amt: '350.5', tks_count: '0' });
    expect(parseLocal('pass')).toEqual({});
  });

  test('cross-table columns', () => {
    const raw = JSON.stringify({
      prjfields: 'qq.ym,mon3,mon4,sum,qq.ord',
      colModel: { 'qq.dtl': { index: 1, data: [{ colName: 'mon3', name: '3月' }, { colName: 'mon4', name: '4月' }, { colName: 'sum', name: '小计' }] } },
    });
    expect(parseCrossFields(raw)).toEqual([
      ['qq.ym', ''],
      ['mon3', '3月'],
      ['mon4', '4月'],
      ['sum', '小计'],
      ['qq.ord', ''],
    ]);
    expect(() => parseCrossFields('{}')).toThrow();
  });

  test('menu', () => {
    const m = parseMenu(fixture('cwfw-menu.html'));
    expect(m.map((e) => e.winno)).toEqual(['5920', '6941', '7987']);
    expect(m[1]).toEqual({ title: '个人工资查询', winno: '6941', group: '网上查询-收入查询', nodeId: '219' });
  });

  test('subsystem entry on home3.jsp', () => {
    const html = '<div id="WF_CWBS" url="WINOPEN../WF_CWBS/main2.jsp?context=x&amp;token=t1&amp;pId=WF_CWBS"></div><div id="WF_YBX" url="WINOPEN../YBX/main2.jsp?context=x&amp;token=t2&amp;pId=WF_YBX"></div>';
    expect(subsystemEntry(html, 'WF_YBX')).toBe('https://cwfw.pku.edu.cn/YBX/main2.jsp?context=x&token=t2&pId=WF_YBX');
    expect(subsystemEntry(html, 'WF_XS')).toBeNull();
  });
});
