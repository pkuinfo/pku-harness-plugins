/**
 * Static timetables. PKU publishes these only as images / notice text, not as data, so they are
 * transcribed here with their source and date. Re-check the sources each semester.
 */

export type DayType = 'weekday' | 'holiday';

export type StopId = 'yanyuan' | 'xiaojiahe' | 'xierqi' | 'xinyanyuan' | 'lab200' | 'machikou' | 'yangfang' | 'beianhe';

export type Stop = {
  id: StopId;
  name: string;
  /** Where exactly to board. */
  where: string;
  /** Campus / place group used to match user input (新燕园 covers its east-gate bus stop too). */
  area: 'yanyuan' | 'xinyanyuan' | 'lab200' | 'xiaojiahe' | 'xierqi' | 'yangfang' | 'beianhe';
};

export const STOPS: Record<StopId, Stop> = {
  yanyuan: { id: 'yanyuan', name: '燕园校区', where: '金光生命科学大厦南侧', area: 'yanyuan' },
  xiaojiahe: { id: 'xiaojiahe', name: '肖家河', where: '农大南路地铁站 C 口往东 20 米', area: 'xiaojiahe' },
  xierqi: { id: 'xierqi', name: '西二旗', where: '上地八街与上地东路交叉口红绿灯往北 20 米', area: 'xierqi' },
  xinyanyuan: { id: 'xinyanyuan', name: '新燕园校区', where: '学生公寓 5 号楼前，经停行政楼停车场', area: 'xinyanyuan' },
  lab200: { id: 'lab200', name: '200号校园', where: 'C 座广场停车场', area: 'lab200' },
  machikou: { id: 'machikou', name: '马池口政府中街南', where: '新燕园校区东门外马路东侧公交站', area: 'xinyanyuan' },
  yangfang: { id: 'yangfang', name: '阳坊', where: '阳坊公交站', area: 'yangfang' },
  beianhe: { id: 'beianhe', name: '地铁北安河站', where: '地铁 16 号线北安河站 D 西南出口西侧公交站', area: 'beianhe' },
};

export type LineId = 'commute' | 'beianhe';

export type Line = {
  id: LineId;
  name: string;
  operator: string;
  fare: string;
  booking: string | null;
  source: { title: string; url: string; published: string; checked: string };
  notes: string[];
};

export const LINES: Record<LineId, Line> = {
  commute: {
    id: 'commute',
    name: '燕园—新燕园通勤班车',
    operator: '北京大学校园服务中心车辆管理科',
    fare: '免费（本校师生）',
    booking: '需提前在校内门户「办事大厅」→「新校区班车预约」预约（当日及未来 7 天），登车扫码签到；5 次未签到将不能预约。',
    source: {
      title: '燕园校区-新燕园校区通勤班车运行时刻表（北京大学新校区管理委员会办公室）',
      url: 'https://www.cpc.pku.edu.cn/info/1048/1082.htm',
      // The timetable image says 发布日期 2022-09-16; the page was re-posted 2023-08-30.
      published: '2022-09-16',
      checked: '2026-10-21',
    },
    notes: [
      '周六、周日及节假日按「周末及节假日」时刻表运行；寒暑假期间通常也按周末及节假日时刻表运行（见新校区管委办假期安排通知）。',
      '途经站（肖家河、西二旗）的到站时间未公布，只有始发时间。',
      '官方时刻表为 2022 年版图片，若与预约系统显示不一致，以「新校区班车预约」为准。',
    ],
  },
  beianhe: {
    id: 'beianhe',
    name: '新燕园—地铁北安河站快速公交（北京大学新燕园校区临时专线）',
    operator: '昌平公交公司',
    fare: '全程现金 4 元，刷卡刷码五折',
    booking: null,
    source: {
      title: '关于开通新燕园校区至北安河地铁快速公交线路的通知（总务部，校园服务中心、学生工作部）',
      url: 'https://zwb.pku.edu.cn/zbtb/xgtz/401167d650ed4e7ea5bbabea0e29ff50.htm',
      published: '2025-12-30',
      checked: '2026-10-21',
    },
    notes: ['2026 年 1 月 1 日起运营，循环往返，发车时间为预计时间，堵车可能延误。', '可在微信小程序「车来了」搜索「北京大学新燕园校区临时专线」看实时到站。'],
  },
};

/** One scheduled run: stops in order; `time` (HH:mm) where the source gives one. */
export type Trip = { line: LineId; days: DayType; stops: { stop: StopId; time?: string }[] };

const trip = (line: LineId, days: DayType, ...stops: (StopId | [StopId, string])[]): Trip => ({
  line,
  days,
  stops: stops.map((s) => (Array.isArray(s) ? { stop: s[0], time: s[1] } : { stop: s })),
});

const Y = 'yanyuan' as const;
const X = 'xinyanyuan' as const;

/** 通勤班车时刻表（周一至周五 18 班；周六、周日及节假日 9 班），transcribed from the 2022-09-16 image. */
const COMMUTE: Trip[] = [
  trip('commute', 'weekday', [Y, '07:00'], 'xiaojiahe', 'xierqi', X, 'lab200'),
  trip('commute', 'weekday', [Y, '07:40'], X, 'lab200'),
  trip('commute', 'weekday', [Y, '08:30'], X, 'lab200'),
  ...['10:10', '13:30', '16:00', '18:30', '20:40', '22:00'].map((t) => trip('commute', 'weekday', [Y, t], X)),
  ...['06:30', '07:40', '08:30', '11:20', '13:00', '16:30'].map((t) => trip('commute', 'weekday', [X, t], Y)),
  trip('commute', 'weekday', ['lab200', '16:30'], [X, '16:50'], 'xierqi', 'xiaojiahe', Y),
  trip('commute', 'weekday', ['lab200', '19:00'], [X, '19:20'], Y),
  trip('commute', 'weekday', [X, '21:45'], Y),
  ...['07:00', '15:00', '19:00', '22:00'].map((t) => trip('commute', 'holiday', [Y, t], X)),
  ...['08:00', '09:00', '11:00', '16:30', '21:45'].map((t) => trip('commute', 'holiday', [X, t], Y)),
];

/** 快速公交 马池口政府中街南 ⇄ 阳坊 ⇄ 地铁北安河站（平时 / 节假日）, from the 2025-12-30 notice. */
const BEIANHE: Trip[] = [
  ...['09:00', '09:30', '10:20', '10:50', '16:40', '17:30', '19:00', '21:00'].map((t) => trip('beianhe', 'weekday', ['machikou', t], 'yangfang', 'beianhe')),
  ...['10:00', '12:00', '13:00', '14:00', '16:00', '17:20', '19:20', '20:20'].map((t) => trip('beianhe', 'holiday', ['machikou', t], 'yangfang', 'beianhe')),
  ...['09:40', '10:10', '11:00', '11:30', '17:20', '18:10', '19:40', '21:40'].map((t) => trip('beianhe', 'weekday', ['beianhe', t], 'yangfang', 'machikou')),
  ...['10:40', '12:40', '13:40', '14:40', '16:40', '18:00', '20:00', '21:00'].map((t) => trip('beianhe', 'holiday', ['beianhe', t], 'yangfang', 'machikou')),
];

export const TRIPS: Trip[] = [...COMMUTE, ...BEIANHE];
