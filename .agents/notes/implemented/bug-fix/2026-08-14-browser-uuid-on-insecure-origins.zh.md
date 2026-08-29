# Agent Note: 在非安全来源生成浏览器 UUID

Status: implemented

[English](2026-08-14-browser-uuid-on-insecure-origins.md) | 中文

## Problem

Web profile 在通过配置绑定服务器后会展示局域网 URL，但浏览器通过明文 HTTP 打开这些 URL 时不具备安全上下文，因而无法使用 `crypto.randomUUID()`。客户端 RPC carrier 与会话附件 composer 直接调用该 API，导致初始 API 流量或添加图片时可能在请求到达 host 前抛出异常。

connection client 已经针对一条 RPC 路径维护了基于 `getRandomValues()` 的本地实现。继续让它保持私有，会使共享 fetch client 与会话 UI 仍然暴露在同一问题下，也会使多个浏览器 UUID 实现逐渐分叉。

## Decision

`@deepseek-ai/dsh-host-apiproxy/api` 导出 `randomUuid()`：一个基于 `globalThis.crypto.getRandomValues()` 的 RFC 4122 version 4 生成器。该 Web Crypto 原语在非安全浏览器来源中仍然可用。此 helper 负责客户端相关性标识和临时标识，不替换仅在 Node 端使用的 UUID 生成逻辑。

抽象 fetch client、connection RPC 与 fixture carrier，以及会话草稿附件均使用这一共享 helper；原有的 connection 本地副本被删除。由于浏览器 bundle 会在运行时导入该 helper，`dsh-client-ui-conversation` 将 API package 声明为直接 peer dependency 与 development dependency。

## Alternatives considered

**在 Web 入口安装全局 `crypto.randomUUID` polyfill。** 拒绝，因为它会修改环境平台状态、依赖启动顺序，并且无法保护脱离该入口独立运行的客户端 bundle。

**逐个调用点增加判断并复制本地 fallback。** 拒绝，因为 connection package 已经证明，这种做法会只修复单一路径，而让等价的浏览器路径继续分叉或保持未修复状态。

**为一个函数建立新的 workspace utility package。** 暂不采用，因为 API package 已经拥有浏览器安全的 RPC 标识，并属于客户端契约。当前新增独立 package 会扩大发布和依赖表面，但尚无第二项领域无关的 utility 需求支撑它。

**替换仓库内所有 `randomUUID()` 调用。** 拒绝，因为大多数调用从 `node:crypto` 导入且只在受信任 host 上运行。fixture bundle 中出现的 LLM message constructor 也不属于本缺陷覆盖的实时 Web transport 或 composer 路径。

## Consequences

通过配置开放的局域网 HTTP 访问无需安全上下文即可生成实时客户端 RPC ID 与草稿附件 ID。UUID 保留 version 4 与 RFC variant 位，同时实现仍要求 Web Crypto 随机性，不会退化为 `Math.random()`。

聚焦测试从环境 crypto 对象中移除 `randomUUID`，保留确定性的 `getRandomValues()`，并固定 RPC 与草稿附件两类行为。TypeScript project build、package invariant、bundle purity 与 client library build 共同验证新的直接依赖保持浏览器安全。

该 helper 明确不是全仓库通用 UUID 抽象。如果未来另一个不应依赖 API 契约的领域无关浏览器 package 需要同一原语，再重新评估是否拆出独立 utility package。
