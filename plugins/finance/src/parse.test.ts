/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { rewardContext, rewardFilterCmd } from './api';
import { base64, encode, encrypt, encryptForm, mirror } from './encrypt';
import { amount, decodeEntities, initVars, normalizeJsObject, parseDoQuery, parseProcHash, parseUserContext, rewardRecords } from './parse';

/** Inverse of encrypt (encrypt.rs `decrypt_for_test`). */
function decrypt(s: string) {
  const inner = Buffer.from(mirror(s.replace(/eEc$/, '')), 'base64').toString('utf8');
  return Buffer.from(inner.slice(0, -5), 'base64').toString('utf8');
}

describe('encrypt (encrypt.rs)', () => {
  test('base64 of UTF-8 matches Buffer', () => {
    for (const s of ['', 'a', 'ab', 'abc', 'WF_CWBS', '个人酬金查询', '😀x']) expect(base64(s)).toBe(Buffer.from(s, 'utf8').toString('base64'));
  });

  test('encode is deterministic for a fixed salt and mirrors even positions', () => {
    const b = Buffer.from('abcAAAAA').toString('base64'); // "YWJjQUFBQUE="
    expect(encode('abc', 'AAAAA')).toBe(`${mirror(b)}eEc`);
    expect(mirror('0123456789')).toBe('9173546280');
    expect(mirror(mirror('abcdefghijk'))).toBe('abcdefghijk');
  });

  test('roundtrip ascii and chinese (encrypt.rs tests)', () => {
    for (const s of ['_search', 'false', '50', 'WF_CWBS', '2200011523', '查询', '个人酬金查询']) expect(decrypt(encrypt(s))).toBe(s);
  });

  test('salted: differs per call', () => {
    expect(encrypt('hello')).not.toBe(encrypt('hello'));
  });

  test('encryptForm encrypts keys and values', () => {
    const body = encryptForm([['a', '2200011523'], ['projid', 'WF_CWBS']]);
    const pairs = body.split('&').map((p) => p.split('=').map((x) => decrypt(decodeURIComponent(x))));
    expect(pairs).toEqual([['a', '2200011523'], ['projid', 'WF_CWBS']]);
  });
});

describe('userContext (context.rs)', () => {
  test('_@ quotes and trailing commas', () => {
    const html = `<div><input type="hidden" id="userContext" value="[{_@0-USERINFO.USERID_@:_@2200011523_@,_@0-USERINFO.USERNAME_@:_@张三_@,_@0-ROLEID_@:3,}]" /></div>`;
    expect(parseUserContext(html)).toEqual({ '0-USERINFO.USERID': '2200011523', '0-USERINFO.USERNAME': '张三', '0-ROLEID': 3 });
  });

  test('missing → null', () => {
    expect(parseUserContext('<html>系统超时，请<a href="login.html">重新登录</a></html>')).toBeNull();
  });

  test('loadInitFunction vars become 0-<UPPER>', () => {
    expect(initVars('[{"varname":"deptno","data":"00127","type":"C","func":""},{"varname":"year","data":2026}]')).toEqual({ '0-DEPTNO': '00127', '0-YEAR': 2026 });
    expect(initVars('not json')).toEqual({});
  });
});

describe('loadDefinition proc hash (api.rs)', () => {
  test('extracts the 查询 button proc', () => {
    const def = 'var wg={btns:[{name:"查询",procs:["`$d22613f13d5012bca16310d4bf2f08c3:#5743-d.year#;#5743-d.month_2#"],x:1}]}';
    expect(parseProcHash(def)).toBe('`$d22613f13d5012bca16310d4bf2f08c3');
    expect(parseProcHash('{}')).toBeNull();
  });
});

describe('doQuery (api.rs)', () => {
  test('normalize bare keys', () => {
    const n = normalizeJsObject('{total:1,page:1,records:8,rows:[{id:"5746_0",cell:["a","b"]}]}');
    expect(JSON.parse(n).rows[0].id).toBe('5746_0');
  });

  test('real response sample with numeric entities', () => {
    const r = parseDoQuery('{total:1,page:1,records:1,rows:[{id:"5746_0",cell:["&#20167;&#23435;","8200908646","",""]}]}');
    expect(r.total).toBe(1);
    expect(r.rows[0].cell.slice(0, 2)).toEqual(['仇宋', '8200908646']);
  });

  test('entities', () => {
    expect(decodeEntities('&#20892;&#19994;')).toBe('农业');
    expect(decodeEntities('no entity')).toBe('no entity');
  });

  test('errors', () => {
    expect(() => parseDoQuery('$$$SYS_ERROR$$$ORA-00942')).toThrow('财务系统返回错误');
    expect(() => parseDoQuery('<html>login.html</html>')).toThrow('无法识别');
  });
});

describe('reward rows (display.rs)', () => {
  const e = (s: string) => [...s].map((c) => `&#${c.codePointAt(0)};`).join('');
  const raw = `{total:1,page:1,records:3,rows:[
    {id:"5746_0",cell:["${e('助教酬金')}","2026001234","${e('劳务')}","1,200.00","40.00","1,160.00","2026-03-02","2026-03-10","${e('李老师')}","","${e('物理学院')}"]},
    {id:"5746_1",cell:["${e('研究生助学金')}","2026000001","${e('奖助')}","800.00","0.00","800.00","2026-03-05","2026-03-15","","","${e('研究生院')}"]},
    {id:"5746_2",cell:["${e('总计')}","","","2,000.00","40.00","1,960.00","","","","",""]}]}`;

  test('maps columns and splits the 总计 row', () => {
    const { records, totals } = rewardRecords(parseDoQuery(raw).rows);
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({
      item: '助教酬金',
      projectCode: '2026001234',
      kind: '劳务',
      gross: 1200,
      tax: 40,
      net: 1160,
      paidAt: '2026-03-10',
      enteredAt: '2026-03-02',
      handler: '李老师',
      department: '物理学院',
    });
    expect(totals).toEqual({ gross: 2000, tax: 40, net: 1960 });
  });

  test('no total row → summed; empty → null', () => {
    const rows = parseDoQuery(raw).rows.slice(0, 2);
    expect(rewardRecords(rows).totals).toEqual({ gross: 2000, tax: 40, net: 1960 });
    expect(rewardRecords([])).toEqual({ records: [], totals: null });
  });

  test('amount', () => {
    expect(amount('1,234.50')).toBe(1234.5);
    expect(amount('')).toBeNull();
    expect(amount('--')).toBeNull();
  });
});

describe('filter payloads (api.rs set_reward_filter)', () => {
  test('cmd data0 order and padding', () => {
    const cmd = rewardFilterCmd('`$abc', '2200011523', 2026, 3, 9, new Date(2026, 9, 18));
    expect(cmd.proc0).toBe('`$abc');
    expect(cmd.data0.map((d) => [d.name, d.value])).toEqual([
      ['d.year', '2026'],
      ['d.month_2', '09'],
      ['d.month_1', '03'],
      ['d.funcno', '9-gz1'],
      ['d.dbcode', 'gz1'],
      ['SHOWPUBRWD', 'Y'],
      ['REWARDCOLNUM', '15'],
      ['userinfo.userid', '2200011523'],
      ['currentyear', '2026'],
      ['currentmonth', '10'],
    ]);
  });

  test('context seeds the 5743 form fields', () => {
    const ctx = rewardContext({ keep: 1 }, '2200011523', 2025, 1, 12);
    expect(ctx).toMatchObject({ keep: 1, '0-UNINO': '2200011523', CURRMENUNODEID: 220, 'WF_CWBS$5743-D.YEAR': '2025', 'WF_CWBS$5743-D.MONTH_1': '01', 'WF_CWBS$5743-D.MONTH_2': '12', '0-CURRFUNC': 5743 });
  });
});
