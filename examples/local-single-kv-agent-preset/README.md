# Local single-KV Agent preset

This fork example starts from the shipped Standard coding composition but changes delegation for a single local inference engine whose KV cache cannot comfortably retain the main long context and concurrent child contexts.

## Install

Copy this directory to the writable user preset root as `local-single-kv`:

```text
${DSH_HOME:-$HOME/.dsh}/.agent-presets/local-single-kv/
  agent.cordis.yml
  preset.yml
```

Then select **Local single-KV** for new sessions.

## Host Subagent limits

The Agent preset cannot own Host services, so set these separately under **Plugins → Subagent**. The tool intentionally inherits the Host recursion-depth policy, so changing that value to `0` still disables delegation globally:

```text
Maximum recursion depth:            1
Continuable Subagent live limit:    1
One-shot concurrent run limit:      1
```

The preset itself makes the ordinary `subagent` tool use `spawn` in foreground `one-shot` mode, removes its `run_in_background` option, inherits the Host recursion-depth policy, disables `subagent_fork` by default, and omits the continuable `send_message`/`list_agents` controls. It also disables background workflow runs. Workflow children still share the Host's `maxConcurrentRuns` FIFO gate, so orchestration cannot bypass the single-run limit.

This intentionally produces phase-oriented delegation:

```text
Main -> one fresh spawn child -> result -> Main
```

rather than overlapping the main Agent with background children. Ordinary shell/background jobs remain available because they do not consume model KV, but delegation and workflow paths that can start child LLM work are foreground-only. `agentOptions.maxTokens` is not a substitute for these limits: it caps completion output, not prompt/context KV usage.
