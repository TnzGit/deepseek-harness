---
description: "Progress prompts for long-running root turns and a non-steering watchdog for long foreground Bash calls."
kind: "package-reference"
---

# @deepseek-ai/dsh-long-task-monitor

English | [中文](README.zh.md)

## Summary

Mount `dsh-long-task-monitor` to remind a running root agent to report progress after a configured duration. It also records periodic server-log checkpoints while a foreground Bash call with a long explicit timeout is active. The latter never queues model prompts that would be delivered only after the command returns.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Web base bundle mounts the plugin for every preset. Its `enabled`, `startAfterMinutes`, `reportEveryMinutes`, `bashEnabled`, `bashStartAfterMinutes`, and `bashReportEveryMinutes` fields are volatile and editable under **Plugins → Long-task progress** without a restart. Defaults are 15 minutes before the first conversation report, every 10 minutes thereafter, 15 minutes before the first foreground Bash checkpoint, and every 10 minutes thereafter. `rootOnly` defaults to true and is a startup-only composition choice.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin observes `agent/created` and `agent/status`, attaching one disposable timer per root agent. On a due conversation check it sends one plugin-sourced steer, logged in the session when consumed. A `tools/execute` wrapper records a foreground Bash interval only when `timeoutMs` is explicitly long enough; the wrapper always calls `next()` and releases its timer in `finally`. Conversation steering pauses throughout any synchronous foreground Bash call and resumes no earlier than one report interval after it settles. Loader volatile updates reschedule live conversation timers.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Web settings card](../../client/ui-settings-long-task-monitor/README.md) — live browser controls.
- [agent](../agent/README.md) — lifecycle and steering events.
- [tools](../tools/README.md) — around-dispatch execution waterfall.

-----

<a id="model-experience"></a>
## Model Experience

### Progress checkpoint

#### What the model sees

After the conversation timer fires, the next agent step receives one short `long-task-monitor`-sourced user message requesting a concise progress report and continued work. Foreground Bash checkpoints never reach the model.

#### Token effect

Only a due conversation check adds tokens. No catalog or recurring instruction is inserted into every request.

#### KV Cache effect

Only the due progress message extends the active context; ordinary turns and Bash log checkpoints add none.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Foreground Bash is synchronous** — the model cannot inspect output until it returns. Use `run_in_background` and `job_output` for actual live inspection; this plugin does not convert commands automatically.
- **Runtime invariant:** No companion is published. Agent-owned timers and the around-dispatch Bash watchdog have matching cleanup callbacks; neither persists independent state.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
