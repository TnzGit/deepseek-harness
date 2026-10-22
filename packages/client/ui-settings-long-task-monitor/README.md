---
description: "Web Plugins settings page for live long-conversation reports and foreground Bash watchdog intervals."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-long-task-monitor

English | [中文](README.zh.md)

## Summary

Open **Plugins → Long-task progress** to change conversation progress reports and foreground Bash watchdog timing without restarting DSH. The page is present while the Host serves the `long-task-monitor` entry. Edits are staged until **Save**.

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

The conversation controls enable or disable progress prompts, set the first report time, and set the following interval. The Bash controls enable a server-side watchdog for foreground calls whose explicit timeout exceeds the configured threshold. The watchdog logs checkpoints rather than queueing prompts that would become stale after a synchronous command returns. Use a background job and `job_output` when the agent must inspect progress while a command is still running. Changes to volatile fields take effect in the active process.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half is an empty Loader entry serving this package's browser half. The browser half binds `long-task-monitor` through `ctx.configForms.get`, stages edits with `SettingsFormModel`, and registers the card into `plugins.item` only while that namespace is served. Copy belongs to `settings.longTaskMonitor`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [long-task-monitor](../../core/long-task-monitor/README.md) — Host timers and foreground Bash behavior.
- [ui-plugin-manager](../ui-plugin-manager/README.md) — Plugins page and its `plugins.item` slot.
- [ui-primitives](../ui-primitives/README.md) — staged settings form.

-----

<a id="model-experience"></a>
## Model Experience

### Browser settings card

#### What the model sees

The `plugins.item` page itself sends no model request. A saved setting can change when the Host monitor later emits one plugin-sourced progress message.

#### Token effect

Opening or editing the page adds no model tokens. Only a later due Host progress message enters context.

#### KV Cache effect

The page has no direct KV-cache effect. A later progress message extends context only when its timer fires.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Foreground Bash cannot be inspected by the blocked agent** — watchdog checkpoints are server-log-only. No reminders are queued for delivery after the command finishes.
- **Runtime invariant:** No companion is published. The card derives from the settings mirror; the Host validates every write.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
