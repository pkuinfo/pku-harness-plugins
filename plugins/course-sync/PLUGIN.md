---
spec: 1
id: course-sync
name: 教务课表
description: 从学校同步本学期课表到日程。
version: 0.2.0
author: pkuinfo
icon: sync
homepage: https://github.com/pkuinfo/pku-harness-plugins/tree/main/plugins/course-sync
requires: [campus-session, network]
# Class timetable from PKU via the treehole course table (pkucli crates/treehole/src/api.rs
# get_coursetable + get_class_times). Writes into the shared timetable with source "campus";
# hand-added courses are never touched. Shares treehole's course-data token with grades:
# verifying in either unlocks both until the server expires it. The 40002 / 40077 second factor
# is the host's verify.treehole ability.
campus: [treehole]
abilities: [verify, timetable]
shared: shared.yaml
tools:
  sync: tools/sync.yaml
  sendCode: tools/sendCode.yaml
  status: tools/status.yaml
screens:
  home: screens/home.json
settings:
  - { screen: home, title: 教务课表, subtitle: 从学校同步课表, icon: sync }
i18n:
  en:
    name: Official timetable
    description: Syncs this semester’s timetable from the university into Schedule.
    tools:
      sync: { title: Sync official timetable, summary: Import this semester’s classes into Schedule (replaces the last sync) }
      sendCode: { title: Send verification code, summary: Text a timetable verification code to your phone }
      status: { title: Timetable sync status, summary: How many classes are synced and when the last sync ran }
    screens: { home: { title: Official timetable } }
    settings: { home: { title: Official timetable, subtitle: Sync your classes from the university } }
---

用户想导入/同步/更新课表时调用 course-sync__sync。
- 已在「手机令牌」插件绑定时，课表二次验证会自动完成，不必问用户。
- 返回 status "verification_required" 时：kind "login" 只能用短信；kind "course" 可用手机令牌（OTP）或短信。用 ui__render 给用户一个输入验证码的表单（发短信前先调用 course-sync__sendCode），拿到验证码后再调用 sync 并传 code 和 method。
- 同步结果里 location 是从教务原文 info 解析出的教室；解析不到时为 null，可用 timetable__updateCourse 补上。
