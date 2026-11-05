---
spec: 1
id: room-booking
name: 研讨室预约
description: 北大空间：二教、四教、地学楼学术研讨教室的查询、预约和取消。
version: 0.2.0
author: pkuinfo
icon: room
homepage: https://github.com/pkuinfo/pku-harness-plugins/tree/main/plugins/room-booking
requires: [campus-session, network]
# 北大空间 学术研讨教室预约 (bdkj.pku.edu.cn, redesigned 2026-10; pkucli crates/bdkj for the older
# flows). The harness adapter `bdkj` holds the session and follows redirects, so `as: response`
# gives the final URL: a bounce to /personal means the profile must be completed in a browser,
# and a submit that lands on /classRoom succeeded. Participant groups (groups.rs) live in KV.
campus: [bdkj]
shared: shared.yaml
tools:
  rooms: tools/rooms.yaml
  availability: tools/availability.yaml
  reservations: tools/reservations.yaml
  reserve: tools/reserve.yaml
  cancel: tools/cancel.yaml
  groups: tools/groups.yaml
  saveGroup: tools/saveGroup.yaml
  deleteGroup: tools/deleteGroup.yaml
i18n:
  en:
    name: Seminar rooms
    description: 'PKU Space: find, book and cancel seminar rooms in the Second and Fourth Teaching Buildings and the Geoscience Building.'
    tools:
      rooms: { title: Seminar rooms, summary: 'Seminar rooms in the Second and Fourth Teaching Buildings and the Geoscience Building' }
      availability: { title: Free time slots, summary: Free periods of one seminar room per day }
      reservations: { title: My seminar room bookings, summary: Your seminar room bookings }
      reserve: { title: Book seminar room, summary: Book a seminar room for one or two periods }
      cancel: { title: Cancel seminar room booking, summary: Cancel one of your seminar room bookings }
      groups: { title: Attendee groups, summary: Your saved attendee groups }
      saveGroup: { title: Save attendee group, summary: Save a group of attendees to reuse when booking }
      deleteGroup: { title: Delete attendee group, summary: Delete a saved attendee group }
---

北大空间（bdkj.pku.edu.cn）学术研讨教室：用户说借教室、订研讨室、预约讨论间时用。
- 流程：room-booking__rooms 列出楼和教室（可按楼、人数筛选）→ room-booking__availability 看某间教室每天的空闲节次 → room-booking__reserve 提交。
- 每天 13 节、每节 50 分钟（08:00–22:30），一次最多连续 2 节；预约时间用 availability 返回的节次起止时间。
- 每间教室有「至少 N 人起约」和容量限制，预约至少 3 人，参与人必须包含申请人（用户本人）；每人要学号和姓名。参与人必须由用户明确给出，不要编造或沿用别人的名单。用户固定的一组人可以用 room-booking__saveGroup 存成分组，之后 reserve 传 group。
- reserve / cancel 会真的改动学校的预约记录：提交前把教室、时间、事由、参与人跟用户确认一遍。
- room-booking__reservations 查看我的预约（含可取消的 id），cancel 传那里的 id。
- 如果提示需要完善「个人信息」，原样告诉用户去浏览器打开 https://bdkj.pku.edu.cn/personal 完成，不要反复重试。
