Local single-KV Agent preset / 本地单 KV Agent preset

中文
====

用途
----
这个 fork 示例基于官方 Standard coding preset，但把所有会启动 child LLM 的路径改成前台串行，适用于单个本地推理引擎的 KV 缓存无法同时容纳主 Agent 长上下文与多个 child 上下文的部署。

安装
----
把本目录复制到可写的用户 preset 目录，目标名使用 local-single-kv：

  ${DSH_HOME:-$HOME/.dsh}/.agent-presets/local-single-kv/
    agent.cordis.yml
    preset.yml

然后为新会话选择 “Local single-KV”。

Host Subagent 设置
------------------
Agent preset 不能拥有 Host 服务，因此还要在 Plugins -> Subagent 单独设置：

  Maximum recursion depth / 最大递归深度:             1
  Continuable Subagent live limit / 可续接驻留上限:   1
  One-shot concurrent run limit / 一次性并发上限:     1

preset 本身会：
- subagent 使用 spawn + foreground one-shot；
- 移除 subagent 的 run_in_background；
- 继承 Host maxDepth，因此 Host 改成 0 仍可全局禁用 delegation；
- 默认禁用 subagent_fork；
- 不暴露 continuable 的 send_message/list_agents 控制；
- 禁用 workflow 的后台运行；
- workflow child 仍受 Host maxConcurrentRuns FIFO 阀门限制。

目标执行形态：

  Main -> one fresh spawn child -> result -> Main

普通 shell/background job 保留，因为它们不消耗模型 KV。agentOptions.maxTokens 只限制 completion 输出，不限制 prompt/context KV，不能代替上述设置。


English
=======

This fork example starts from the shipped Standard coding composition but makes every path that can launch child LLM work foreground and serial. It is intended for a single local inference engine whose KV cache cannot comfortably retain the main long context and concurrent child contexts.

Install this directory as:

  ${DSH_HOME:-$HOME/.dsh}/.agent-presets/local-single-kv/
    agent.cordis.yml
    preset.yml

Then select “Local single-KV” for new sessions.

Set these Host values separately under Plugins -> Subagent:

  Maximum recursion depth:            1
  Continuable Subagent live limit:    1
  One-shot concurrent run limit:      1

The preset uses foreground one-shot spawn, removes background subagent execution, inherits Host maxDepth, disables fork by default, omits continuable control tools, and disables background workflow runs. Workflow children still share the Host maxConcurrentRuns FIFO gate.

The intended execution shape is:

  Main -> one fresh spawn child -> result -> Main

Ordinary shell/background jobs remain available because they do not consume model KV. agentOptions.maxTokens caps completion output; it does not bound prompt/context KV usage.
