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

The Agent preset cannot own Host services, so set these separately under **Plugins → Subagent**:

```text
Maximum recursion depth:            1
Continuable Subagent live limit:    1
One-shot concurrent run limit:      1
```

The preset itself makes the ordinary `subagent` tool use `spawn` in foreground `one-shot` mode, removes `run_in_background`, fixes its depth to 1, and disables `subagent_fork` by default. Workflow calls still share the Host's `maxConcurrentRuns` FIFO gate, so a workflow cannot bypass the single-run limit.

This intentionally produces phase-oriented delegation:

```text
Main -> one fresh spawn child -> result -> Main
```

rather than overlapping the main Agent with background children. `agentOptions.maxTokens` is not a substitute for these limits: it caps completion output, not prompt/context KV usage.
