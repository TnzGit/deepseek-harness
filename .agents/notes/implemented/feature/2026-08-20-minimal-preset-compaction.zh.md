# Agent Note: 极简模式上下文压缩

Status: implemented

[English](2026-08-20-minimal-preset-compaction.md) | 中文

## Problem

已发布的 `minimal` 极简模式会刻意把模型可见工具目录收窄为持久 shell 与 `str_replace_editor`，但此前也一并去掉了上下文维护能力。长时间运行的极简会话因此没有 standard 编码组合已有的自动压力压缩、本地 `/compact` 命令，以及不调用模型的大工具结果裁剪。

## Decision

极简模式现在挂载一个独立的、agent 本地的 `compaction` 组，但不会增加任何模型可见工具。该组同时隔离 `compaction` 与 `toolResultPruner`，并组合现有的 `@deepseek-ai/dsh-compaction-basic`、`@deepseek-ai/dsh-command-compact` 和 `@deepseek-ai/dsh-compaction-tool-result-pruner` 插件。

`compaction-basic` 保留正常的自动压力压缩与上下文溢出恢复行为。`/compact` 复用现有本地命令，因此会出现在极简模式的斜杠菜单中。工具结果裁剪器沿用 standard 模式的显式限制：结果超过 8192 个字符时，替换为前 4096 个字符加后 1024 个字符。token meter 继续归 Host 所有；本地组只包含必须随 agent preset 切换的能力。

这不会扩大模型工具 schema。极简模式下模型仍只看到持久 shell 与 `str_replace_editor`；压缩继续属于会话维护与命令能力。

## Alternatives considered

**要求极简模式用户在长会话中切换到标准模式。** 不采用，因为这会扩大模型可见工具目录，背离极简编码模式的目的。

**把压缩暴露成另一个模型可见工具。** 不采用，因为压力维护和 `/compact` 属于 Host／session 能力；增加工具只会消耗 schema token，并不会改善自动恢复。

## Verification

`apps/web/tests/agent-preset-selection.e2e.ts` 会让组装后的 Web 应用加载真实发布 preset 目录，将一个空白会话切换到 minimal，并要求 `compact` 出现，同时 `plan` 与本地 skill 发现仍然缺席。切回 standard 后仍必须恢复其更大的斜杠菜单。

## Consequences

极简会话可以在长对话中自动释放更早的上下文，也允许用户显式要求压缩。大型工具结果会在长期占据上下文之前被缩减，而极简模式的定义属性——模型只拥有两个编码工具——保持不变。
