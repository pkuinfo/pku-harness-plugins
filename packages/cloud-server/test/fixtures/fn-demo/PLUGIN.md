---
spec: 1
id: fn-demo
name: 函数演示
description: Fixture plugin for the cloud server's function tests.
version: 1.0.0
author: pkuinfo
cloud:
  disclosure: { zh: ["访问计数和你输入的文字会发送到云端"] }
server:
  network: [api.example.org]
  secrets: [API_KEY]
  functions:
    visit:
      effect: write
      input:
        name: { type: string, default: world }
      steps:
        - let: prev
          ability: kv.get
          args: "{ key: 'visits' }"
        - let: visits
          value: "(prev ?? 0) + 1"
        - ability: kv.set
          args: "{ key: 'visits', value: visits }"
        - let: tag
          ability: crypto.sha256
          args: "{ text: input.name }"
        - let: sig
          ability: crypto.hmacSha256
          args: "{ text: input.name, secret: 'API_KEY' }"
        - let: rid
          ability: crypto.randomId
          args: "{}"
        - let: echo
          request:
            url: https://api.example.org/v1/echo
            query: { name: '${input.name}', key: '${secrets.API_KEY}' }
            headers: { authorization: 'Bearer ${secrets.API_KEY}' }
          as: json
      return: "{ visits, tag, sig, ridLength: length(rid), me: caller.id, echo }"
    leak:
      effect: read
      steps:
        - let: r
          request: { url: 'https://api.example.org/v1/fail', headers: { x-key: '${secrets.API_KEY}' } }
          as: response
        - check: "false"
          error: "upstream said ${r.text}"
    hop:
      effect: read
      steps:
        - let: r
          request: { url: 'https://api.example.org/v1/redirect' }
          as: json
      return: r
    later:
      effect: write
      steps:
        - ability: collection.add
          args: "{ collection: 'reports', value: { a: 1 } }"
      return: "{ ok: true }"
    stats:
      effect: read
      access: public
      cache: 30s
      input:
        n: { type: integer, default: 1 }
      steps:
        - let: c
          request: { url: 'https://api.example.org/v1/count' }
          as: json
      return: "{ count: c.count, n: input.n }"
    whoami:
      effect: read
      access: public
      return: "{ caller }"
---

Fixture for packages/cloud-server/test/fn.test.ts.
