---
spec: 1
id: elective
name: 选课网
description: 选课网选课结果、补退选课程余量和课程搜索（只读，选课请到官网）。
version: 0.2.0
author: pkuinfo
icon: ballot
homepage: https://github.com/pkuinfo/pku-harness-plugins/tree/main/plugins/elective
requires: [campus-session, network]
# 选课网 elective.pku.edu.cn (pkucli crates/elective/src/api.rs), read-only. Electing and dropping
# need a CAPTCHA and can't be undone, so they stay on the official site. The host's `elective`
# adapter signs in, follows redirects and signs in again when the session is lost; the request
# header `x-elective-program: major | minor` picks 主修 / 辅双 on dual-degree accounts, and every
# response says which program it shows in the same header.
campus: [elective]
shared: shared.yaml
tools:
  schedule: tools/schedule.yaml
  results: tools/results.yaml
  supplements: tools/supplements.yaml
  search: tools/search.yaml
i18n:
  en:
    name: Elective (选课网)
    description: 'Elective (选课网): your enrolment results, open seats in add/drop courses, and course search. Read-only; enrol on the official site.'
    tools:
      schedule: { title: Enrolment stages, summary: Enrolment stages and dates and the site’s notice }
      results: { title: Enrolment results, summary: Your enrolment results this term }
      supplements: { title: Add/drop courses, summary: Courses in add/drop with open seats, one page at a time }
      search: { title: Search add/drop courses, summary: Find add/drop courses by name, teacher or course code }
---

选课网（elective.pku.edu.cn）只读：elective__results 选课结果（已选上 / 未选上 / 待抽签），elective__supplements 补退选课程列表和余量（按页，含已选课程），elective__search 按课程名 / 教师 / 课程号搜索补退选课程。
- 只能查，不能选课、退课：这两步要验证码且不可撤销。用户想选或退时，告诉他到官网 https://elective.pku.edu.cn 自己操作；可以先帮他查余量、班号，或用 scheduler 建提醒（例如补退选开放时）。
- 选课网只在选课阶段开放；返回"不在选课阶段"之类提示时如实转告。
- 双学位学生每次只能看一个项目：program=major 主修（默认），minor 辅双；结果里的 program 字段说明看到的是哪个。
- 问"这学期课表 / 什么时候上课"不要用这里（用 timetable / course-sync），这里只看一个项目且不含完整时间表。
- remaining = 限数 − 已选；full=true 表示已满（有候补时 waitlist 是候补人数）。
