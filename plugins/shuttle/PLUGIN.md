---
spec: 1
id: shuttle
name: 校车
description: 燕园—新燕园（昌平）通勤班车和新燕园—地铁北安河快速公交时刻表，算出下一班车。
version: 0.2.0
author: pkuinfo
icon: bus
homepage: https://github.com/pkuinfo/pku-harness-plugins/tree/main/plugins/shuttle
# No network, campus or abilities: the timetables are static data inside the tools (PKU publishes
# them only as an image / notice text; source URL and date are in each line's `source`).
shared: shared.yaml
tools:
  next: tools/next.yaml
  timetable: tools/timetable.yaml
widgets:
  next: widgets/next.json
dataSources:
  next: { title: 下一班校车, tool: next, args: { count: 2 }, ttl: 1m }
commands:
  # Was answered on the phone without the model (quickAnswer); a document command is a prompt, so
  # the agent answers with shuttle__next.
  shuttle: { description: 下一班校车, aliases: [校车, 班车], argHint: 如 燕园到新燕园, prompt: '查一下下一班校车{{input}}' }
i18n:
  en:
    name: Shuttle bus
    description: Timetables for the Yanyuan–Xinyanyuan (Changping) commuter shuttle and the Xinyanyuan–Bei’anhe metro express bus, with the next departure worked out for you.
    tools: { next: { title: Next shuttle }, timetable: { title: Shuttle timetable } }
    widgets: { next: { title: Next shuttle, description: 'The next Yanyuan ⇄ Xinyanyuan commuter shuttles both ways with a countdown, refreshed every minute from the built-in timetable (no network needed).' } }
    commands: { shuttle: { description: Next shuttle, argHint: e.g. Yanyuan to Xinyanyuan, aliases: [bus], prompt: 'When is the next shuttle{{input}}' } }
    dataSources: { next: { title: Next shuttle } }
---

校车（静态时刻表，来自学校公布的图片/通知，附来源和日期）：
- shuttle__next：下一班车。用户说"去昌平/新校区的车""回本部"时换算成 from/to（燕园/本部, 新燕园/昌平, 200号, 肖家河, 西二旗, 阳坊, 北安河(地铁)）。周六日自动用周末表；法定节假日、寒暑假要传 dayType "holiday"（拿不准时可先用 calendar__officialCalendar 查节假日）。
- shuttle__timetable：整张时刻表、上车地点、预约规则和数据来源。
- 通勤班车免费但必须提前在校内门户「办事大厅 → 新校区班车预约」预约、登车扫码签到；北安河快速公交是公交公司运营、收费、无需预约。
- 时刻表是 2022-09-16 发布的版本，回答时说明"以预约系统为准"；用户要提醒时可以用提醒工具在发车前提醒。
