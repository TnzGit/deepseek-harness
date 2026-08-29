# Agent Note: 显式 RTK shell 指引

Status: implemented

[English](2026-08-20-rtk-shell-guidance.md) | 中文

## Problem

本地 DSH 安装可能已经提供 Rust Token Killer（`rtk`），用它包装常见仓库检查命令可以减少输出体积。但如果模型自行安装 RTK Hook 或执行 `rtk init`，就会改变当前 DSH 调用之外共享的 Git／工具行为，并可能影响 Codex 等其他 agent。这里需要的是请求指引，而不是环境安装。

## Decision

模型可见的 bash 提示词现在会说明：当 RTK 已经存在、且普通的人类可读仓库检查足够时，优先使用 `rtk grep`、`rtk find`、`rtk read`、`rtk git`、`rtk test` 和 `rtk log`。如果任务需要完整、精确或机器可读输出，或者 RTK wrapper 不支持所需操作，则必须回退原生命令。

同一提示词会明确禁止 `rtk init`、安装 RTK Hook，以及任何其他 Git／工具 Hook 修改。DSH 只把 RTK 当作显式命令 wrapper。极简模式使用完整 persona，因此其 persistent-bash 描述也携带同样规则，而不是依赖普通的 `tool:bash` 提示词段落。

不会新增可执行文件发现器、安装器、Hook 或自动命令改写。没有安装 RTK 的部署继续正常使用原生命令。

## Alternatives considered

**为 DSH 执行 `rtk init` 或安装 Hook。** 不采用，因为这类变更会影响共享仓库和其他 agent，超出一次模型请求的权限范围。

**把所有受支持的原生命令自动改写为 RTK。** 不采用，因为部分任务需要精确的机器可读输出，而且部分部署没有 RTK；显式指引能保留两种回退。

## Verification

`packages/shell/tool-bash/tests/rtk-guidance.spec.ts` 会组装真实 `tool:bash` 提示词段落，并固定六个优先 wrapper、原生命令回退与 Hook 禁令。`examples/headless-agent/tests/rtk-guidance.snapshot.ts` 会让组装后的 headless 应用连接本地 DeepSeek 兼容 SSE server，并验证真正发往提供方请求的 `system` 字段包含同样规则。

## Consequences

当 RTK 已经存在时，DSH 可以减少上下文消耗，同时不改变开发者的仓库 Hook 或其他 agent 的环境。对于任何不适合有损紧凑输出的任务，模型仍有明确的原生命令回退路径。
