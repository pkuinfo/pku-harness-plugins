import type { Venue } from './parse';

/**
 * Static data, each with its source and date. The hours table is fetched live (api.ts) and this
 * snapshot is only the fallback when cyzx.pku.edu.cn can't be reached; a test keeps it equal to
 * the parser's output on the saved page.
 */

export const HOURS_SOURCE = {
  title: '食堂开闭餐时间（北京大学餐饮中心·服务指南）',
  url: 'https://cyzx.pku.edu.cn/fwzn/74317312d14a4988bc38eff6f5c8b851.htm',
  /** 页面标注的发布日期. */
  published: '2022-09-09',
  /** When this snapshot was taken. */
  checked: '2026-10-21',
};

export const HOURS_SNAPSHOT: Venue[] = [
  { canteen: '学一食堂', area: null, meals: { breakfast: '6:50-8:30（值班餐至9:00）', lunch: '11:00-13:00（值班餐至13:30）', dinner: '17:00-18:30（值班餐至19:00）' }, notes: ['值班餐均在中厅档口开放，不含节假日'] },
  { canteen: '家园食堂', area: '一层', meals: { breakfast: '7:00-10:00', lunch: '11:00-13:00（值班餐至13:30）', dinner: '17:00-19:00' } },
  { canteen: '家园食堂', area: '二层', meals: { breakfast: null, lunch: '11:00-13:30', dinner: '17:00-19:00' } },
  { canteen: '家园食堂', area: '三层/四层（小北面包房）', meals: { breakfast: '10:00-22:00', lunch: '10:00-22:00', dinner: '10:00-22:00' }, continuous: [['breakfast', 'lunch', 'dinner']] },
  { canteen: '家园食堂', area: '四层渝火锅', meals: { breakfast: null, lunch: '11:00-22:00', dinner: '11:00-22:00' }, continuous: [['lunch', 'dinner']] },
  { canteen: '家园食堂', area: '咖啡厅（地下一层）', meals: { breakfast: '7:00-23:00', lunch: '7:00-23:00', dinner: '7:00-23:00' }, continuous: [['breakfast', 'lunch', 'dinner']] },
  { canteen: '学五食堂', area: '面食、西餐、米粉、二层快餐', meals: { breakfast: '7:00-21:30', lunch: '7:00-21:30', dinner: '7:00-21:30' }, continuous: [['breakfast', 'lunch', 'dinner']] },
  { canteen: '学五食堂', area: '中式快餐 快餐小吃', meals: { breakfast: null, lunch: '10:00-21:30', dinner: '10:00-21:30' }, continuous: [['lunch', 'dinner']] },
  { canteen: '学五食堂', area: '麻辣烫', meals: { breakfast: null, lunch: '10:00-22:30', dinner: '10:00-22:30' }, continuous: [['lunch', 'dinner']] },
  { canteen: '燕南美食', area: '一层', meals: { breakfast: '6:50-9:00', lunch: '11:00-13:00', dinner: '17:00-19:00' } },
  { canteen: '燕南美食', area: 'B1', meals: { breakfast: null, lunch: '11:00-13:00', dinner: '17:00-19:00' } },
  { canteen: '燕南美食', area: '咖啡厅', meals: { breakfast: '7:30-22:00', lunch: '7:30-22:00', dinner: '7:30-22:00' }, continuous: [['breakfast', 'lunch', 'dinner']] },
  { canteen: '艺园二楼', area: null, meals: { breakfast: null, lunch: '11:00-14:00', dinner: '17:00-24:00' } },
  { canteen: '勺园食堂', area: '一层', meals: { breakfast: '6:45-8:30', lunch: '11:00-13:30（周六日闭餐时间为13:00）', dinner: '17:00-19:00' } },
  { canteen: '勺园食堂', area: '二层', meals: { breakfast: null, lunch: '11:00-13:30（周六日闭餐时间为13:00）', dinner: '17:00-19:00' } },
  { canteen: '勺园食堂', area: '教师餐厅', meals: { breakfast: null, lunch: '11:00-13:30', dinner: '17:00-19:00' } },
  { canteen: '松林快餐', area: null, meals: { breakfast: '6:30-14:00', lunch: '6:30-14:00', dinner: '16:00-21:30' }, continuous: [['breakfast', 'lunch']] },
  { canteen: '农园食堂', area: '一层', meals: { breakfast: null, lunch: '11:00-13:00', dinner: '17:00-19:00' } },
  { canteen: '农园食堂', area: '二层', meals: { breakfast: '7:00-8:30', lunch: '11:00-13:00', dinner: '17:00-19:00' } },
  { canteen: '农园食堂', area: '三层', meals: { breakfast: null, lunch: '11:00-14:00', dinner: '17:00-21:00' } },
  { canteen: '佟园食堂', area: null, meals: { breakfast: '7:00-9:00', lunch: '11:00-13:00', dinner: '17:00-22:00' }, notes: ['假期期间，晚餐时段为17:00-20:00'] },
  { canteen: '中关园食堂', area: null, meals: { breakfast: '7:00-8:30', lunch: '10:50-13:30', dinner: '16:50-19:00' } },
  { canteen: '畅春园食堂', area: '一层', meals: { breakfast: '6:50-8:30', lunch: '11:00-13:30', dinner: '17:00-19:00' } },
  { canteen: '畅春园食堂', area: '三层', meals: { breakfast: null, lunch: '11:00-14:00', dinner: '17:00-21:00' } },
  { canteen: '成府园食堂', area: null, meals: { breakfast: '7:00-9:00', lunch: '11:00-13:00', dinner: '17:00-19:00' } },
  { canteen: '馨园食堂', area: null, meals: { breakfast: '7:00-9:00', lunch: '11:00-13:00', dinner: '17:00-19:00' } },
  { canteen: '昌平200号食堂', area: null, meals: { breakfast: '7:00-8:30', lunch: '11:00-12:30', dinner: '17:00-18:30' } },
  { canteen: '移动餐车', area: null, meals: { breakfast: null, lunch: '11:00-13:00', dinner: '17:00-19:00' } },
];

/**
 * Changes announced after the hours table (餐饮中心 通知公告). Shown with every hours answer so
 * the model doesn't send people to a closed canteen. Re-check when the 2026 autumn works end.
 */
export const UPDATES: { canteen: string; status: 'closed' | 'open'; detail: string; hours?: string; date: string; source: string }[] = [
  {
    canteen: '勺园食堂',
    status: 'closed',
    detail: '后厨改造，2026 年秋季学期起暂停营业，工期预计半年，恢复时间另行通知；部分服务项目迁入艺园食堂一层。',
    date: '2026-08-17',
    source: 'https://cyzx.pku.edu.cn/tzgg/faff32055b2b47a4aa8b8d18c8acb3a5.htm',
  },
  {
    canteen: '艺园食堂',
    status: 'open',
    detail: '2026 年 9 月 10 日早餐起恢复营业（勺园部分服务迁入）。',
    hours: '早餐 7:00-9:00，午餐 11:00-13:00，晚餐 17:00-19:00',
    date: '2026-09-07',
    source: 'https://cyzx.pku.edu.cn/tzgg/9c8ea2435e134d4bad0a5f0f1b62eb8f.htm',
  },
];

export const CROWD_SOURCE = {
  title: '校内信息门户·食堂就餐人数（公开查询）',
  url: 'https://portal.pku.edu.cn/publicQuery/#/canteen',
};
