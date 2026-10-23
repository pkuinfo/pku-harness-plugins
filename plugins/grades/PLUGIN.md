---
spec: 1
id: grades
name: 成绩
description: 查询各学期成绩和绩点（GPA）。
version: 0.2.0
author: pkuinfo
icon: medal
homepage: https://github.com/pkuinfo/pku-harness-plugins/tree/main/plugins/grades
requires: [campus-session, network]
# Scores and GPA via the treehole course API (pkucli crates/treehole/src/api.rs get_scores,
# display.rs print_scores). Read-only. Shares treehole's course-data token with course-sync:
# verifying in either unlocks both until the server expires it.
campus: [treehole]
abilities: [verify]
tools:
  listScores: tools/listScores.yaml
  gpa: tools/gpa.yaml
  sendCode: tools/sendCode.yaml
widgets:
  gpa: widgets/gpa.json
i18n:
  en:
    name: Grades
    description: Your grades and GPA, semester by semester.
    tools: { listScores: { title: Check grades }, gpa: { title: Check GPA }, sendCode: { title: Send verification code } }
    widgets: { gpa: { title: Overall GPA, description: 'Your overall GPA and total credits; hidden until you tap, since grades are private.' } }
---

成绩和绩点是隐私：只在用户明确问起时才调用 grades 的工具或提及具体分数，不要主动在其他回答、总结或看板建议里带出成绩。
- 问某学期/某门课的分数用 grades__listScores（可传 semester，如 "25-26-1" 或 "2025-2026-1"）；只问绩点用 grades__gpa。
- 已在「手机令牌」插件绑定时，成绩二次验证会自动完成，不必问用户。
- 返回 status "verification_required" 时：kind "login" 只能用短信；kind "course" 可用手机令牌（OTP）或短信。用 ui__render 给用户一个输入验证码的表单（发短信前先调用 grades__sendCode），拿到验证码后再调用原工具并传 code 和 method。
- GPA 以学校返回的为准（4 分制）；gpa 为 null 表示学校没给出，不要自己估算冒充官方数字。
