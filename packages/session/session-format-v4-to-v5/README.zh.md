---
description: "将 V4 Session 日志恢复为 V5，同时保留旧版本文件并支持 V5 写入。"
kind: "package-library"
---

# @deepseek-ai/dsh-session-format-v4-to-v5

[English](README.md) | 中文

## 概述

将有效的 V4 Session 版本恢复为 V5，不改动已保存的文件。静态 Session 格式目录在读取历史日志时使用这条相邻迁移；JSONL 持久化只在以写入方式打开时发布已验证的 V5 后继文件。本包还提供原生 V5 物理 codec 与验证器，没有 Cordis 挂载配置。

## 目录

- [使用此包](#use-this-package)
- [V4 到 V5 规范](#v4-to-v5-specification)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发注记](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

[静态目录](../session-format-catalog/README.zh.md)是应用入口。它从[本包导出](src/index.ts)中引入迁移、已发布的 V4 来源 codec、V5 目标 codec、头部验证器与目标恢复器。调用方不把这个库作为插件安装或挂载。

```text
const restore = sessionFormatCatalog.createRestore(physicalHeader, {
  recovery: 'strict', validation: 'current',
})
for (const row of physicalRows) restore.decodeRow(row)
const artifact = restore.finish()
```

历史读取成功时会在内存中返回 V5 逻辑事件。来源损坏、必需事件不受支持或目标关系无效时，恢复会被拒绝；目录不会发布部分后继文件。[JSONL 持久化](../session-persistence-jsonl/README.zh.md)负责写入打开时的验证与排他发布。

-----

<a id="v4-to-v5-specification"></a>
## V4 到 V5 规范

| 来源 | V5 结果 |
|---|---|
| 有效的 V4 逻辑头 | 仅把 `version: 4` 改为 `version: 5`；id、创建时间、父会话、种子、cwd、预设和委托字段保持不变。 |
| V4 物理头和行 | 使用已发布的 V4 codec 解码；V5 codec 在 V5 头部下沿用相同的行封装。 |
| 每个已解码 V4 事件及紧凑运行 | 按原顺序输出事件，不修改类型、序号、时间、载荷、消息字段、来源标记、surface 操作或引用。 |
| 继承前缀 | 最后一个继承 end-seed 标记给出相同的逻辑截点；如来源截点已知，必须一致。 |
| V4 投递标记 | 检查其有效的 V4 坐标；若来源标记宣称属于目标 V5 版本，则拒绝迁移。 |

迁移阶段不重新解释 V4 消息位置，也不伪造新的来源类型。原生 V5 写入器可以使用当前 Session 类型声明的新生产者来源和恢复事件。V5 验证保留 V4 的工具角色、developer、surface、生命周期、目录及投递关系，同时检查有效 V5 投递归属。未知必需事件被拒绝；未知可忽略事件在已安装类型范围之外保持不解释。

V4 来源 codec 和先前的相邻迁移边保持不变。只读打开在内存中转换；写入打开只在不改动来源文件的前提下编码、验证并排他发布最终 V5 版本。[Session 格式决策](../../../.agents/notes/implemented/architecture/2026-08-31-released-session-format-migrations.zh.md)规定发布和恢复策略。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——展开查看</summary>

迁移会为每个文件创建独立的流式阶段。目标 codec 将物理事件封装交给冻结的 V4 codec，只改变头部版本。目标恢复器按 V5 投递归属执行已有的 V4 关系检查，随后目录按需执行已安装 Session 的验证。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Session 格式协议](../session-format/README.zh.md)定义阶段组合及 codec 策略。
- [历史 V4 参考](../../../docs/persistence-changes/historical-formats/v4.zh.md)保留旧版声明 schema。
- [Session 格式状态](../../../docs/session-format-status.zh.md)区分写入版本、已接受基线和已发布版本。

-----

<a id="model-experience"></a>
## 模型体验

### 历史恢复

#### 模型看到什么

恢复后的模型收到由未改动 V4 事件载荷重建的消息，例如 `user/message`。这条迁移边不添加提示词、工具 schema 或结果。

#### Token 影响

迁移边保留已有模型可见内容，不增加 token。后续 Agent 步骤可以独立追加内容。

#### KV Cache 影响

迁移边保留重建后的历史前缀。恢复后提供商能否复用它取决于完整请求及提供商缓存，而非本库。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **历史拒绝仍可能发生** — 身份保持型迁移不会修复损坏或不受支持的 V4 内容；来源版本保持不变，且不会发布 V5 后继文件。
- **开发中写出的 V5 版本不会重跑迁移** — V5 文件已经带有目标版本；验证后续转换器修复时，必须在隔离的 Harness home 中重新读取未改动的 V4 来源。

本纯迁移库不维护独立的运行时观测，因此不发布运行时不变量配套文件。

### 开发备注

<a id="dev-note"></a>

<details>
<summary>维护者工作背景——展开查看</summary>

无。

</details>
