## 做了什么

<!-- 改动说明；关联 issue：Closes #… -->

## 自查（插件规则见 CONTRIBUTING.md）

- [ ] `bun run check` 和 `bun test` 通过（解析器有测试）
- [ ] 工具的 `title`（中文）和 `description`（给模型看：何时用、怎么用）清楚，输入用 zod / JSON Schema 校验
- [ ] 效果类型如实声明（read / write / money / public），付款和公开发布不会绕过确认
- [ ] 不索取、不记录校园密码与令牌；工具结果里不含 Cookie / token
- [ ] 校园内容（帖子、公告）作为数据返回，没有拼进给模型的指令
- [ ] 声明了 `requires`；协议移植自 pkucli 的在注释里注明来源文件
- [ ] 在 App 里实测过（列出用到的工具和结果，注意打码）
