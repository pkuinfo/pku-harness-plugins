---
spec: 1
id: course-catalog
name: 全校课程目录
description: 按课程名、教师、院系搜索全校开课，含上课时间（选课网查询含教室）。只读。
version: 0.2.1
author: pkuinfo
icon: catalog
homepage: https://github.com/pkuinfo/pku-harness-plugins/tree/main/plugins/course-catalog
# 全校课程目录 (pkucli crates/claspider): the dean's public course search (dean.pku.edu.cn, no
# login) and the elective system's course query (elective.pku.edu.cn, signed in, has rooms).
# Read-only: electing and dropping courses are not here. Ported from the TypeScript plugin.
network: [dean.pku.edu.cn]
campus: [elective]
shared: shared.yaml
tools:
  search: tools/search.yaml
  departments: tools/departments.yaml
  searchElective: tools/searchElective.yaml
i18n:
  en:
    name: Course catalogue
    description: Search every course at Peking University by name, teacher or department, with class times (Elective searches include rooms). Read-only.
    tools:
      search: { title: Search courses, summary: Find courses by name, teacher or department }
      departments: { title: Departments and semesters, summary: Department and semester codes for course search }
      searchElective: { title: Search Elective (with rooms), summary: Search the Elective system by category, with classrooms }
---

全校课程目录（只读，不能选课/退课）：
- course-catalog__search：教务部课表查询（公开，无需登录），按课程名/教师/院系搜某学期的开课，返回课号、班号、学分、教师、开课单位、上课时间（星期、节次和时间）、起止周。没有教室。
- 需要教室地点时用 course-catalog__searchElective（选课网，需要已登录校园账号，按课程分类查，较慢）。
- 教务部网站可能要求网页验证码，这时 search 会报 captcha_required：改用 searchElective（按课程分类和名称关键词查），或请用户到 https://dean.pku.edu.cn/service/web/courseSearch.php 自己查。
- 院系可以直接写名称（如"信息科学技术学院"），不确定时先用 course-catalog__departments 查代码。
- 学期代码形如 "25-26-1"（25-26 学年第 1 学期），默认当前学期。
- 用户想把某门课加进课表时，用 timetable__addCourse，按 sessions 里的 weekday、start、end、room 和 weeks（单双周看 weekType）逐个添加。
