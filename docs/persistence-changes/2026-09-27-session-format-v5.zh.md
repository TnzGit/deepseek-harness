---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-27-session-format-v5

[English](2026-09-27-session-format-v5.md) | 中文

## 概述

将 Session 写入格式提升至 V5，以记录长任务与 Agent 循环恢复事件，并扩展由生产者标记的消息来源类型。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-27-session-format-v5
baseline: false
changes:
  - root: "SessionHeader"
    previous: "2026-09-16-session-format-v4"
    after: "22c6899a78214dd841c266348ae997027ef391174ddb21127f1b71dc1b362824"
    decision: version-bump
  - root: "event:agent/degenerate-response"
    previous: null
    after: "14fa8a996f2a9563d248c4acf81ac1d7d45e522f275575d31903d8ceb2b00ca9"
    decision: version-bump
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-16-session-format-v4"
    after: "a2fd7837ead8ae147cd7e597aafd411375bf022f0aa8e0efe4e9fe91a396d993"
    decision: version-bump
  - root: "event:agent/max-token-continuation"
    previous: null
    after: "6decc04f2620a0ab82a16f7a42888df7ba1ce59b395a409f3a2075c64e302d00"
    decision: version-bump
  - root: "event:developer/message"
    previous: "2026-09-16-session-format-v4"
    after: "23c04b27666c16ff59dd33633850772541758afe5cc965265d57af52d3047a5f"
    decision: version-bump
  - root: "event:session/title-llm-request"
    previous: "2026-09-16-session-format-v4"
    after: "8b9a9cb1e2163f2327fff111f4d61af08da2d454289da980b209bd0c4f0f31f5"
    decision: version-bump
  - root: "event:turn/end"
    previous: "2026-09-16-session-format-v4"
    after: "6f32bb39c52c9d4b64ca564c4fb0176347c21bae212fbb72fd2d1d276da94552"
    decision: version-bump
  - root: "event:user/message"
    previous: "2026-09-16-session-format-v4"
    after: "b3a60937c1561523c58892b7470b28f4f5a711e2205cecc6075408b86dc3c187"
    decision: version-bump
```

<a id="compatibility"></a>
## 兼容性

相邻的 V4 到 V5 阶段保留历史事件的身份、载荷、顺序和继承截点，仅变更头部版本。静态目录继续保留 V4 codec 和全部更早的迁移边。只读打开在内存中迁移；写入打开在不改动历史文件的前提下发布已验证的 V5 后继文件。旧版程序必须拒绝较新的 V5 文件，不得写入。

<a id="verification"></a>
## 验证

相邻格式、目录及 JSONL 持久化测试通过：44 个测试文件、1159 项通过、1 项跳过。Host TypeScript 项目构建通过。

<a id="dev-note"></a>
## 开发备注

无。
