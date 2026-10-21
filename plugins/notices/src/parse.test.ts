/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { allowedArticleUrl, beijingDate, byDateDesc, findDate, matches, nextPageUrl, parseArticle, parseDeanSearch, parseList, parsePkuXml, resolveUrl } from './parse';

/** Public pages saved 2026-10-21 (no personal data). */
const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('list pages', () => {
  test('北大新闻网 (VSB cards with summary)', () => {
    const items = parseList(fx('news-list.html'), 'https://news.pku.edu.cn/xwzh2.htm');
    expect(items.length).toBe(10);
    expect(items[0]).toMatchObject({ title: '葡萄牙教育、科学与创新部长访问北京大学', url: 'https://news.pku.edu.cn/info/7921/3309661.htm', date: '2026-10-20' });
    expect(items[0].summary).toStartWith('10月19日，葡萄牙教育');
    expect(nextPageUrl(fx('news-list.html'), 'https://news.pku.edu.cn/xwzh2.htm')).toBe('https://news.pku.edu.cn/xwzh2/5462.htm');
  });

  test('教务部 notice.php', () => {
    const items = parseList(fx('dean-list.html'), 'https://dean.pku.edu.cn/web/notice.php?type=0&page=1');
    expect(items.length).toBe(15);
    expect(items[0]).toEqual({ title: '关于校本部2026级本科新生填写学籍表的通知', url: 'https://dean.pku.edu.cn/web/notice_details.php?id=768', date: '2026-10-13' });
    expect(nextPageUrl(fx('dean-list.html'), 'https://dean.pku.edu.cn/web/notice.php?type=0&page=1')).toBe('https://dean.pku.edu.cn/web/notice.php?type=0&page=2');
  });

  test('研究生院: relative links into other columns, pinned old item sorts last', () => {
    const items = parseList(fx('grs-list.html'), 'https://grs.pku.edu.cn/tzgg/index.htm').sort(byDateDesc);
    expect(items[0]).toEqual({ title: '2026-2027学年秋季学期研究生课程中期退课通知', url: 'https://grs.pku.edu.cn/tzgg/177fb3c411ae4da2956505f7b0c339fa.htm', date: '2026-10-20' });
    expect(items.some((i) => i.url === 'https://grs.pku.edu.cn/xwgz11/xwsy11/bsxw111/gztz09/f4e36b160a424192a50bc8aaab05cc1b.htm')).toBe(true);
    expect(items.at(-1)?.date).toBe('2024-01-10');
    // Menus have no dates and never become items.
    expect(items.every((i) => i.date)).toBe(true);
  });

  test('学工部 (date inside the link) and 总务部 ("[相关通知]" prefix dropped)', () => {
    const xgb = parseList(fx('xgb-list.html'), 'https://xgb.pku.edu.cn/sylm/zxtz/index.htm');
    expect(xgb[0]).toEqual({ title: '学生工作部2026年国庆期间带值班安排', url: 'https://xgb.pku.edu.cn/sylm/zxtz/81dd37de6182496182c702fcba1d03ce.htm', date: '2026-09-23' });
    const zwb = parseList(fx('zwb-list.html'), 'https://zwb.pku.edu.cn/zbtb/xgtz/index.htm');
    expect(zwb[0]).toEqual({ title: '供暖系统上水通知', url: 'https://zwb.pku.edu.cn/zbtb/xgtz/3e33995177ff48dd8b51b7ad153f23f6.htm', date: '2026-10-08' });
    expect(nextPageUrl(fx('zwb-list.html'), 'https://zwb.pku.edu.cn/zbtb/xgtz/index.htm')).toBe('https://zwb.pku.edu.cn/zbtb/xgtz/index1.htm');
  });

  test('学校主页 recentList.xml', () => {
    const items = parsePkuXml(fx('pku-recent.xml'));
    expect(items[0]).toEqual({ title: '关于“北大博雅教育研究院”有关情况的声明', url: 'https://www.pku.edu.cn/notice/detail.html?aid=441103', date: '2024-12-13', summary: '督查室' });
  });

  test('教务部 site search', () => {
    const hits = parseDeanSearch(fx('dean-search.json'));
    expect(hits.length).toBe(30);
    expect(hits[1]).toEqual({ title: '2026-2027学年第一学期本科生选课通知', url: 'https://dean.pku.edu.cn/web/notice_details.php?id=751', date: null });
    expect(parseDeanSearch('{"status":false,"msg":""}')).toEqual([]);
    expect(parseDeanSearch('<html>')).toEqual([]);
  });
});

describe('articles', () => {
  test('北大新闻网: header, source, body without boilerplate', () => {
    const a = parseArticle(fx('news-article.html'), 'https://news.pku.edu.cn/info/7921/3309661.htm');
    expect(a.title).toBe('葡萄牙教育、科学与创新部长访问北京大学');
    expect(a.date).toBe('2026-10-20');
    expect(a.source).toBe('国际合作部');
    expect(a.text).toStartWith('10月19日，葡萄牙教育、科学与创新部长');
    expect(a.text).toEndWith('北京大学相关院系及职能部门负责人参加以上活动。');
    expect(a.text).not.toContain('转载本网文章');
    expect(a.images).toBe(3);
  });

  test('教务部: repeated title/date lines dropped', () => {
    const a = parseArticle(fx('dean-article.html'), 'https://dean.pku.edu.cn/web/notice_details.php?id=768');
    expect(a.title).toBe('关于校本部2026级本科新生填写学籍表的通知');
    expect(a.date).toBe('2026-10-13');
    expect(a.text).toStartWith('校本部2026级本科新生');
    expect(a.text).toContain('自即日起至2026年10月25日');
    expect(a.text).not.toContain('分享到');
  });

  test('总务部: inline <style> stripped, title paragraph not repeated', () => {
    const a = parseArticle(fx('zwb-article.html'), 'https://zwb.pku.edu.cn/zbtb/xgtz/401167d650ed4e7ea5bbabea0e29ff50.htm');
    expect(a.title).toBe('关于开通新燕园校区至北安河地铁快速公交线路的通知');
    expect(a.date).toBe('2025-12-30');
    expect(a.text).toStartWith('为方便广大师生出行');
    expect(a.text).not.toContain('gpCmsArticle');
    expect(a.text).toContain('9:00、9:30、10:20、10:50、16:40、17:30、19:00、21:00');
  });

  test('研究生院', () => {
    const a = parseArticle(fx('grs-article.html'), 'https://grs.pku.edu.cn/tzgg/177fb3c411ae4da2956505f7b0c339fa.htm');
    expect(a.title).toBe('2026-2027学年秋季学期研究生课程中期退课通知');
    expect(a.date).toBe('2026-10-20');
    expect(a.text).toContain('网上提交退课申请时间：2026年10月26日');
  });

  test('WeChat article: og:title, account, publish time from `ct`', () => {
    const a = parseArticle(fx('wechat-article.html'), 'https://mp.weixin.qq.com/s/IqN9V2Xp-GsuGhQ5tBz2Yg');
    expect(a.title).toBe('“1000+”迎新｜北京大学2026级研究生新生骨干 “1000+”领航培养计划新生见面会举行');
    expect(a.source).toBe('燕园学子微助手');
    expect(a.date).toBe('2026-09-03');
    expect(a.text).toStartWith('金风送爽，燕园启新。');
    expect(a.text).not.toContain('<');
  });

  test('attachments listed, not left in the text', () => {
    const html = `<div class="article"><p>请见附件。正文足够长足够长足够长。</p><li><a href="../../docs//2026-09/x.xlsx">值班安排.xlsx</a></li></div>`;
    const a = parseArticle(html, 'https://xgb.pku.edu.cn/sylm/zxtz/a.htm');
    expect(a.attachments).toEqual([{ name: '值班安排.xlsx', url: 'https://xgb.pku.edu.cn/docs//2026-09/x.xlsx' }]);
    expect(a.text).toBe('请见附件。正文足够长足够长足够长。');
  });
});

describe('helpers', () => {
  test('findDate', () => {
    expect(findDate('[2026-10-20]')).toBe('2026-10-20');
    expect(findDate('2026/1/5')).toBe('2026-01-05');
    expect(findDate('2026年9月7日')).toBe('2026-09-07');
    expect(findDate('none')).toBeNull();
  });

  test('resolveUrl', () => {
    expect(resolveUrl('../jzgz/a.htm', 'https://grs.pku.edu.cn/tzgg/index.htm')).toBe('https://grs.pku.edu.cn/jzgz/a.htm');
    expect(resolveUrl('notice_details.php?id=1&amp;x=2', 'https://dean.pku.edu.cn/web/notice.php')).toBe('https://dean.pku.edu.cn/web/notice_details.php?id=1&x=2');
  });

  test('allowedArticleUrl', () => {
    expect(allowedArticleUrl('https://news.pku.edu.cn/info/1.htm')).toBe(true);
    expect(allowedArticleUrl('https://pku.edu.cn/')).toBe(true);
    expect(allowedArticleUrl('https://mp.weixin.qq.com/s/abc')).toBe(true);
    expect(allowedArticleUrl('https://evil.com/?x=pku.edu.cn')).toBe(false);
    expect(allowedArticleUrl('https://pku.edu.cn.evil.com/')).toBe(false);
    expect(allowedArticleUrl('file:///etc/passwd')).toBe(false);
  });

  test('matches: every word, case-insensitive', () => {
    const it = { title: '2026年秋季学期 PKU 选课通知', url: 'x', date: null };
    expect(matches(it, '选课 pku')).toBe(true);
    expect(matches(it, '选课 退课')).toBe(false);
  });

  test('beijingDate is time-zone independent', () => {
    // 2026-10-20 18:00 UTC = 2026-10-21 02:00 in Beijing.
    expect(beijingDate(Date.UTC(2026, 9, 20, 18))).toBe('2026-10-21');
  });
});
