---
spec: 1
id: canteen
name: 食堂
description: 各食堂实时就餐人数（拥挤程度）、开闭餐时间、现在还开着的食堂和餐饮中心通知。
version: 0.2.0
author: pkuinfo
icon: food
homepage: https://github.com/pkuinfo/pku-harness-plugins/tree/main/plugins/canteen
requires: [network]
network: [portal.pku.edu.cn, cyzx.pku.edu.cn]
shared: shared.yaml
tools:
  crowd: tools/crowd.yaml
  openNow: tools/openNow.yaml
  hours: tools/hours.yaml
  notices: tools/notices.yaml
widgets:
  crowd: widgets/crowd.json
dataSources:
  crowd: { title: 食堂就餐人数, tool: crowd, ttl: 2m }
commands:
  canteen: { description: 现在去哪个食堂, aliases: [食堂, 吃饭], argHint: 想吃什么 / 在哪（可空）, prompt: '现在哪些食堂还开着、人少？帮我挑一个{{input}}' }
i18n:
  en:
    name: Canteens
    description: Live diner counts (how crowded), opening hours, which canteens are open now, and Dining Center notices.
    tools:
      crowd: { title: Canteen crowds, summary: How busy each canteen is right now }
      openNow: { title: Open now, summary: Canteens open right now }
      hours: { title: Opening hours, summary: Canteen opening hours }
      notices: { title: Dining Center notices, summary: Latest Dining Center notices }
    widgets:
      crowd: { title: Canteen crowds, description: 'Live diner counts and crowding at each canteen, least busy first, refreshed every 2 minutes.' }
    commands:
      canteen: { prompt: 'Which canteens are open and not crowded right now? Pick one for me{{input}}', description: Where to eat right now, argHint: What or where (optional), aliases: [eat, food] }
    dataSources:
      crowd: { title: Canteen diner counts }
---

食堂（公开数据，无需登录）：
- canteen__crowd：实时就餐人数（diners/seats、percent、level），问"哪里人少""学五挤不挤"时用；数据来自门户的公开查询，约每分钟更新。
- canteen__openNow：现在（或指定时间）还开着的食堂和档口，以及多久后闭餐；canteen__hours：完整开闭餐时间表。
- 开闭餐时间表是餐饮中心 2022-09-09 发布的版本，结果里的 updates 是之后的停业/恢复通知（如勺园停业改造），回答时以 updates 为准并说明"以食堂现场为准"；周末和节假日可能有差异（见 notes）。
- canteen__notices：餐饮中心最新通知（假期安排、停业）。推荐食堂时结合"开着 + 人少"。
