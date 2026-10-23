/**
 * The plugin language in one page, for the model (`plugins.reference`) and other tools. Keep it
 * in step with pku-harness docs/PLUGIN-LANGUAGE.md; it is sent only when the agent asks for it.
 */
export const LANGUAGE_REFERENCE = `# PKU Harness plugin language (spec 1)

A plugin is a folder: PLUGIN.md (YAML frontmatter = manifest, Markdown body = instructions for
the AI) + files it names (tools/*.yaml, widgets/*.json, screens/*.json). Pass them to plugins
tools as { "PLUGIN.md": "...", "tools/x.yaml": "..." }.

## PLUGIN.md frontmatter
spec: 1 · id: kebab-case · name · description (4–200) · version: 1.0.0 · author
optional: icon, homepage, campus: [card|its|treehole|blackboard|elective|cwfw|cwpay|bdkj|library|library-space]
(campus services called with the user's signed-in session), network: [host, *.host] (public
HTTPS hosts), abilities: [verify|otp|todos|timetable|scheduler|browser|campusPage|sms|files|crypto|cloud],
tools: { name: tools/name.yaml }, dataSources: { name: { tool, args?, ttl: 10m } },
widgets: { name: widgets/name.json }, screens, settings, commands: { name: { description, prompt: "...{{input}}" } },
i18n: { en: { name, description, tools: { name: { title } } } }

## Tool file (YAML)
title (short, Chinese) · description (for the AI) · effect: read|write|money|public ·
untrusted?: true when results carry third-party text · input: { field: { type: string|number|integer|boolean|array|object, enum?, default?, optional?, min?, max?, description? } } ·
constants: { NAME: data } · functions: { f: "(a, b) => expr" } · steps: [...] · return: expr

## Steps (run in order; \`let: name\` binds the result)
- { let, value: expr }
- { let, request: { campus?: service, url, method?, query?, headers?, json? | form? | body?+contentType?, timeout? }, as: json|text|html|response }
  campus url = path on that service; public url must be https on a network host. html → a node for select().
- { let, each: listExpr, concurrency?: 1–4, request | steps + return | value }  (item, index in scope; ≤ 50 items)
- { let, paginate: { start?, request (uses cursor), items: expr (page), next: expr (null stops), max ≤ 30 } }
- { let, extract: { from: expr, each: css, fields: { name: "css | text" } }, limit? }
  pipes: text, html, attr X, data X, url (absolute), num, date, match RE [group], trim, squash; "." or "" = the item
- { if: expr, then: [steps], else?: [steps] } · { check: expr, error: "template" } · { return: expr }
- { try: [steps], catch: [steps] }  (error.message in catch)
- { let?, kv: get|set|delete, key: "template", value?: expr, ttl? }  (plugin's own storage)
- { let, cache: { key, ttl: 10m, staleOnError?: true }, steps: [...], return: expr }
- { let, call: otherTool, input: expr } · { let, ability: group.op, args: expr }
Abilities: verify.treehole { request, code?, via? } (SMS/OTP second factor; returns data or
{status:'verification_required'}), verify.treeholeSendCode, otp.code, todos.list/add/update/setDone/remove,
timetable.get/upsert/remove, scheduler.list/create/update/remove, browser.open {url}, campusPage.open {service},
sms.awaitCode, files.pick, crypto.sha256 {text}, cloud.call {fn, input}. The tool's effect must cover the ability's.

## Expressions and templates
Expression fields (value, each, if, check, return, items, next, from, call input, ability args,
functions) hold one expression: a safe JS subset — literals, objects/arrays with spread, . ?. [],
+ - * / %, == != (strict), < <= > >=, && || ?? !, a ? b : c, arrow functions as arguments.
No assignment, no new, no globals. In scope: input, constants, functions, now (ms), bound lets,
item/index in each. Unbound names are errors (bind optional values first).
Every other string is a template: "text \${expr}"; exactly "\${expr}" keeps the value's type.
YAML: quote an expression containing ": " or starting with { [ ' " (or use a | block).

stdlib (also as methods, x.f(...)):
lists: map filter find some every flatMap reduce flat slice concat includes indexOf join reverse sort sortBy(l, f, desc) groupBy unique sum count min max range(a, b) chunk zip length compactRanges
objects: keys values entries fromEntries pick omit merge
strings: str trim squash lower upper split replace(s, re, with) replaceText match(s, re, group?) matchAll test startsWith endsWith padStart clip(s, n) fmt('{a}', obj)
numbers: num(x, fallback) int round(x, digits) fixed abs floor ceil yuan(fen)
dates (Beijing time, ms): date(text) formatDate(ms, 'YYYY-MM-DD HH:mm W') addDays addMinutes daysBetween startOfDay minutesOf('HH:mm'|ms) weekday (1=Mon)
urls/json: url(base, path) query(url, name) encode decode json(text) path(v, 'a.b[0]')
html: html(text, url?) select(node, css) first(node, css) node.text node.html node.attrs attr(node, name) data(node, name) children parent tableRows(node, {header}) options(select) htmlText(s) largestText(node)

## Limits per run
200 steps, 60 requests (4 in flight), 60 s, 2 MB per response, 1 MB result, 100 000 operations.

## Widgets / screens (JSON)
{ title, description?, sizes?: [sm,md,lg], spec: { root, elements: { id: { type, props, children?, repeat?: { statePath, key }, on? } }, state? },
  bindings: { "/path": { tool: readTool, path?, ttlMinutes? } } }
Components come from the app's UI catalog (plugins.reference doesn't list them; use ui.render's
catalog). In a repeat: { "$item": "field" }, { "$template": "\${field}" }. Actions: ask {text},
open {url}, navigate {href}, callTool {tool, input}.

## Example tool
title: 空闲教室
description: Free rooms in one teaching building.
effect: read
input:
  building: { type: string, default: 二教 }
steps:
  - let: r
    request: { url: https://portal.pku.edu.cn/publicQuery/classroomQuery/retrClassRoomFree.do, query: { buildingName: '\${input.building}', time: 今天 } }
    as: json
  - check: r.success
    error: 查询失败
return: "r.rows.filter(x => x.c5 == '').map(x => ({ room: x.room, seats: num(x.cap, 0) }))"
`;
