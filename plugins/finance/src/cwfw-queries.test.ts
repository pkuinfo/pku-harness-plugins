/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CampusRequest } from '@pku-harness/sdk';

import {
  cardDepositsFrom,
  defaultSalaryFields,
  fxRatesFrom,
  loansFrom,
  payrollFrom,
  queryReimbursements,
  querySalary,
  reimburseStats,
  remittancesFrom,
  salaryItems,
} from './cwfw-queries';
import { parseLocal, type Services } from './cwfw-wf';
import { mirror } from './encrypt';
import { parseDoQuery } from './parse';

/** All data below is synthetic (names, ids, amounts); only the shapes match the portal. */
const ent = (s: string) => [...s].map((c) => (c.charCodeAt(0) > 127 ? `&#${c.charCodeAt(0)};` : c)).join('');
const grid = (funcno: string, rows: string[][]) =>
  `{total:1,page:1,records:${rows.length},rows:[${rows.map((r, i) => `{id:"${funcno}_${i}",cell:[${r.map((c) => JSON.stringify(ent(c))).join(',')}]}`).join(',')}]}`;

describe('row mappers', () => {
  test('salary cross table', () => {
    const resp = parseDoQuery(grid('6160', [['研究生奖学金', '', '', '', '', '', '', '', '', '1200', '800', '2000', '9', '普通字段', 'A01', 'A01', '2000000000']]));
    const items = salaryItems(resp, defaultSalaryFields(1, 10));
    expect(items).toEqual([{ name: '研究生奖学金', months: [{ month: 9, amount: 1200 }, { month: 10, amount: 800 }], total: 2000, itemCode: 'A01' }]);
    expect(JSON.stringify(items)).not.toContain('2000000000');
  });

  test('salary partial month range', () => {
    const resp = parseDoQuery(grid('6160', [['X', '100', '', '300', '400', '9', '', '', 'B02', '2000000000']]));
    expect(salaryItems(resp, defaultSalaryFields(3, 5))[0].months).toEqual([
      { month: 3, amount: 100 },
      { month: 5, amount: 300 },
    ]);
  });

  test('card deposits ("[]" when empty)', () => {
    expect(cardDepositsFrom(parseDoQuery('[]'))).toEqual([]);
    const d = cardDepositsFrom(parseDoQuery(grid('15028', [['YY0001', '张老师', '物理学院', '助教费', '1,500.00', '1500.00', '0.00', '已支付', '', '']])));
    expect(d[0]).toEqual({ reqNo: 'YY0001', handler: '张老师', unit: '物理学院', summary: '助教费', amount: 1500, paid: 1500, tax: 0, status: '已支付', errorCode: '' });
  });

  test('loans', () => {
    expect(loansFrom(parseDoQuery('{total:0,page:0,records:0,rows:[]}'))).toEqual([]);
    const l = loansFrom(parseDoQuery(grid('6243', [['2026-03-01 00:00:00.0', '会议暂借款', 'P001', 'H0001', '5000', '3000', '2000', '2000000000', '1']])));
    expect(l[0]).toEqual({ firstDate: '2026-03-01', summary: '会议暂借款', project: 'P001', clearNo: 'H0001', firstAmount: 5000, cleared: 3000, balance: 2000 });
  });

  test('remittances drop contacts and staff', () => {
    const r = remittancesFrom(
      parseDoQuery(grid('13522', [['2026-03-02 00:00:00.0', 'EXAMPLE FOUNDATION', '9990', '10000', 'USD', '美国', '科研经费', '已结汇', '13800000000', '2026-03-05 00:00:00.0', '某老师', 'AB', '某人', '1', '2000000000', '2026-03-06 10:00:00.0']])),
    );
    expect(r[0]).toEqual({ date: '2026-03-02', remitter: 'EXAMPLE FOUNDATION', settledAmount: 9990, amount: 10000, currency: 'USD', origin: '美国', remark: '科研经费', status: '已结汇', bankDate: '2026-03-05' });
    const json = JSON.stringify(r);
    for (const secret of ['13800000000', '某老师', '某人', '2000000000']) expect(json).not.toContain(secret);
  });

  test('fx rates', () => {
    expect(fxRatesFrom(parseDoQuery(grid('13583', [['欧元', '2026-10-01 21:26:14.0', '762.15', '', '', '', '2000000000']])))).toEqual([{ currency: '欧元', date: '2026-10-01', ratePer100: 762.15 }]);
  });

  test('payroll drops ids and bank cards', () => {
    const p = payrollFrom(
      parseDoQuery(grid('7183', [['2026-09', 'V-12-3', '劳务费', 'P001', '示例项目', '800', 'S001', '身份证', '110101200001010000', '6222000000000000000', '某银行', '李四', '学生', '800', '转卡', '2026', '0', '1', 'R1', '1']])),
    );
    expect(p[0]).toMatchObject({ payee: '李四', projectName: '示例项目', gross: 800, method: '转卡' });
    const json = JSON.stringify(p);
    for (const secret of ['110101200001010000', '6222000000000000000', 'S001', '某银行']) expect(json).not.toContain(secret);
  });

  test('reimbursement counters', () => {
    const s = reimburseStats(parseLocal('pass;local(0-tks_amt:0;0-tks_count:0;0-BX_YBXALL_count:2;0-BX_YBXALL_amt:350.5;0-BX_YBXTH_count:1;0-BX_YBXTH_amt:200;0-BX_DTD_COUNT:1;0-BX_DTD_AMOUT:150.5;0-PZ_50_PT_amt:99999;)'));
    expect(s.find((x) => x.key === 'all')).toMatchObject({ count: 2, amount: 350.5 });
    expect(s.find((x) => x.key === 'toDeliver')).toMatchObject({ count: 1, amount: 150.5 });
    expect(s.find((x) => x.key === 'returned')?.count).toBe(1);
    expect(s.map((x) => x.key)).not.toContain('draft');
  });
});

/** Inverse of encrypt (encrypt.rs `decrypt_for_test`). */
function decrypt(s: string) {
  const inner = Buffer.from(mirror(s.replace(/eEc$/, '')), 'base64').toString('utf8');
  return Buffer.from(inner.slice(0, -5), 'base64').toString('utf8');
}
const fields = (body = '') =>
  Object.fromEntries(
    body
      .split('&')
      .filter(Boolean)
      .map((p) => p.split('=').map((x) => decrypt(decodeURIComponent(x)))),
  ) as Record<string, string>;

const ROLES = `<input type="hidden" id="userContext" value="[{_@0-USERINFO.USERID_@:_@2000000000_@,_@0-USERINFO.USERNAME_@:_@张三_@,}]" />`;

/** A fake portal that answers by action and records the decrypted requests. */
function fakePortal(answer: (action: string, f: Record<string, string>, path: string) => string) {
  const log: { path: string; action: string; f: Record<string, string> }[] = [];
  const services = {
    campus: {
      status: () => ({ signedIn: true, username: '2000000000', name: null }),
      request: async (_svc: string, req: CampusRequest) => {
        const m = /cwfw\.pku\.edu\.cn\/([^/]+)\/([^?]+)/.exec(req.url)!;
        const encrypted = m[2] !== 'loadRolesMenu.action' && m[2] !== 'loadInitFunction.action' && m[2] !== 'home3.jsp' && !!req.body;
        const f = encrypted ? fields(req.body) : {};
        log.push({ path: m[1], action: m[2], f });
        return { status: 200, url: req.url, headers: {}, body: answer(m[2], f, m[1]) };
      },
    },
  } as unknown as Services;
  return { services, log };
}

describe('flows against a fake portal', () => {
  test('querySalary: options → triggers → beforeLoad → proc with form context → cross fields → grid', async () => {
    const W5609 = readFileSync(join(import.meta.dir, 'fixtures', 'cwfw-window-5609.txt'), 'utf8');
    const checks: Record<string, string> = {
      '`$25b8177ea318643bd726a5a11dc176fc': 'B',
      '`$f930ffe8da00b8be0eb90ea0ce374454': 'GZ1',
      '`$ba2e854d6c9d28bb01b3dbb2ef17e737': 'GZ1',
      '`$787350269307a26c7b1cc3e15d9f5bb6': '1',
    };
    const { services, log } = fakePortal((action, f) => {
      if (action === 'loadRolesMenu.action') return ROLES;
      if (action === 'loadInitFunction.action') return JSON.stringify([{ varname: 'showzerogz', data: 'N' }]);
      if (action === 'loadDefinition.action') return W5609;
      if (action === 'common_getBindingDataBackend.action') return '6:奖学金类;7:生活补贴';
      if (action === 'commonUpdate_responseButtonEvent.action') {
        const cmd = JSON.parse(f.cmd) as { check_func: string; proc0?: string };
        return cmd.proc0 ? 'pass' : (checks[cmd.check_func] ?? 'error');
      }
      if (action === 'crossfieldrebuild.action') return JSON.stringify({ prjfields: 'qq.ym,mon9,mon10,sum,qq.ord,qq.gztype,qq.remark,qq.itemcode,qq.unino', colModel: {} });
      if (action === 'commonQuery_doQuery.action') return grid('6160', [['研究生奖学金', '1200', '800', '2000', '9', '', '', 'A01', '2000000000']]);
      return '';
    });
    const sections = await querySalary(services, 2026, 9, 10, '6');
    expect(sections).toEqual([{ code: '6', title: '奖学金类', items: [{ name: '研究生奖学金', months: [{ month: 9, amount: 1200 }, { month: 10, amount: 800 }], total: 2000, itemCode: 'A01' }] }]);

    const binding = log.find((l) => l.action === 'common_getBindingDataBackend.action')!;
    expect(binding.f).toMatchObject({ a: '2000000000', sqlid: '5e59f45e66d097068bc3db16762ea3f6', cvstr: '#0-USERINFO.USERID#::2000000000', projid: 'WF_CWBS' });

    const procCall = log.find((l) => l.action === 'commonUpdate_responseButtonEvent.action' && l.f.cmd.includes('238b97cc'))!;
    const cmd = JSON.parse(procCall.f.cmd) as { check_func: string; data0: { name: string; value: string; type: string }[] };
    expect(cmd.check_func).toBe('escape');
    expect(cmd.data0.map((d) => `${d.name}=${d.value}`)).toEqual([
      'd.year=2026',
      'd.pubdate=1',
      'd.month_2=10',
      'd.month_1=09',
      'd.incometype=B',
      'd.funcno=6',
      'd.dbcode=GZ1',
      'd.code=GZ1',
      'SHOWZEROGZ=N',
      'userinfo.userid=2000000000',
      'currfunctype=3',
    ]);
    const ctx = JSON.parse(procCall.f.userContext) as Record<string, unknown>;
    expect(ctx).toMatchObject({ 'WF_CWBS$5574-D.YEAR': '2026', 'WF_CWBS$5574-D.MONTH_1': '09', 'WF_CWBS$5574-D.FUNCNO': '6', CURRMENUNODEID: 219, '0-CURRFUNC': 5574 });

    const q = log.find((l) => l.action === 'commonQuery_doQuery.action')!;
    expect(q.f).toMatchObject({ funcno: '6160', sidx: 'qq.ord ASC', projid: 'WF_CWBS' });
    // the beforeLoad procedure ran before the query button
    const order = log.filter((l) => l.action === 'commonUpdate_responseButtonEvent.action' && l.f.cmd.includes('proc0')).map((l) => (l.f.cmd.includes('9baa856e') ? 'before' : 'query'));
    expect(order).toEqual(['before', 'query']);
  });

  test('queryReimbursements enters the YBX subsystem when it has no session yet', async () => {
    let entered = false;
    const W6 = '{mainWinno:6,wins:[{winno:6,beforeLoadProcs:["`$91cb37cc20d96badcf2b961ab4b009a3:#0-userinfo.userid#;;#0-userinfo.business_id#"]}]}';
    const { services, log } = fakePortal((action, f) => {
      if (action === 'home3.jsp') return '<div id="WF_YBX" url="WINOPEN../YBX/main2.jsp?context=x&amp;token=t&amp;pId=WF_YBX"></div>';
      if (action.startsWith('main2.jsp')) {
        entered = true;
        return '';
      }
      if (action === 'loadRolesMenu.action') return entered ? ROLES : '<html>系统超时</html>';
      if (action === 'loadDefinition.action') return W6;
      if (action === 'commonUpdate_responseButtonEvent.action') {
        const cmd = JSON.parse(f.cmd) as { data0: { name: string; value: string }[] };
        expect(cmd.data0).toEqual([
          { name: 'userinfo.userid', value: '2000000000', type: 'CHAR' } as never,
          { name: '', value: '', type: 'CHAR' } as never,
          { name: 'userinfo.business_id', value: '', type: 'CHAR' } as never,
        ]);
        return 'pass;local(0-BX_YBXALL_count:1;0-BX_YBXALL_amt:88;0-BX_YBXSPZ_count:1;0-BX_YBXSPZ_amt:88;)';
      }
      return '';
    });
    const stats = await queryReimbursements(services);
    expect(entered).toBe(true);
    expect(stats).toEqual([
      { key: 'all', label: '全部报销单', count: 1, amount: 88 },
      { key: 'approving', label: '审批中', count: 1, amount: 88 },
    ]);
    const def = log.find((l) => l.action === 'loadDefinition.action')!;
    expect(def.path).toBe('YBX');
    expect(def.f).toMatchObject({ projid: 'WF_YBX', winno: '6', type: 'W' });
  });
});
