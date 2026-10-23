---
spec: 1
id: classrooms
name: 空闲教室
description: 查一教、二教、三教、四教、理教等教学楼今天到后天每节课的空闲教室，找自习室。
version: 0.2.0
author: pkuinfo
icon: building
homepage: https://github.com/pkuinfo/pku-harness-plugins/tree/main/plugins/classrooms
network: [portal.pku.edu.cn]
tools:
  free: tools/free.yaml
  overview: tools/overview.yaml
widgets:
  overview: widgets/overview.json
dataSources:
  overview: { title: 各楼空闲教室数, tool: overview, ttl: 10m }
commands:
  classrooms: { description: 找空闲教室自习, aliases: [空教室, 自习], argHint: 如 二教 下午, prompt: '帮我找能自习的空闲教室{{input}}' }
i18n:
  en:
    name: Free classrooms
    description: Free classrooms in each teaching building for every period from today to the day after tomorrow. Find somewhere to study.
    tools: { free: { title: Free classrooms }, overview: { title: Free rooms by building } }
    widgets: { overview: { title: Free classrooms, description: How many classrooms are free right now in each teaching building; tap a building to have the AI list them. } }
    commands: { classrooms: { prompt: 'Find me a free classroom to study in{{input}}', description: Find a free classroom to study in, argHint: Building and time, aliases: [study, free-rooms] } }
    dataSources: { overview: { title: Free rooms by building } }
---

空闲教室（公开数据，无需登录）：
- classrooms__free：某栋楼（或不传 building 查全部 10 栋）在今天/明天/后天的空闲教室。用户说"下午""晚上""现在到 6 点"时换算成 from/to（HH:mm）或节次 periods；不传时今天默认从当前节次到晚上。
- 节次：1:08:00-08:50 2:09:00-09:50 3:10:10-11:00 4:11:10-12:00 5:13:00-13:50 6:14:00-14:50 7:15:10-16:00 8:16:10-17:00 9:17:10-18:00 10:18:40-19:30 11:19:40-20:30 12:20:40-21:30。
- classrooms__overview：各楼现在空闲教室数量，适合先挑楼。
- 数据只覆盖排课和教务预约，临时活动可能未登记；回答时建议选座位多、空闲时间长的教室。
