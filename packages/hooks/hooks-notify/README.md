---
description: "Send configurable task-end webhook notifications when an agent turn stops or a goal completes, without changing model context."
kind: "package-reference"
---

# @deepseek-ai/dsh-hooks-notify

English | [中文](README.zh.md)

## Summary

`dsh-hooks-notify` sends a small JSON webhook when an agent turn stops or a goal completes. It ships disabled, supports live Settings edits through volatile configuration, and never blocks the agent loop on delivery. Use it for a LAN notification service, phone bridge, or similar task-completion signal when missed notifications are preferable to retrying or delaying model work.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The base composition already mounts the plugin. It is disabled until its `hooks-notify` configuration is enabled, so no webhook is sent by default. All fields are volatile: Settings edits reach the running plugin without a restart.

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Master switch |
| `url` | `http://192.168.10.111:18473/notify` | Absolute HTTP(S) endpoint |
| `trigger` | `turn-end` | `turn-end`, `goal-complete`, or `both` |
| `message` | `任务完成` | Template with `{{cwd}}`, `{{session}}`, `{{turn}}`, and `{{goal}}` |
| `sound` | `Glass` | Device sound name forwarded verbatim |
| `repeat` | `1` | Positive repeat count |
| `timeoutMs` | `5000` | Delivery deadline in milliseconds |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-hooks-notify) is the exhaustive field reference.

Each request is `POST`ed as `application/json` with this body:

```json
{
  "message": "任务完成",
  "sound": "Glass",
  "repeat": 1
}
```

Delivery is detached from the task boundary. The plugin does not retry. Network errors, timeouts, redirects, and non-2xx responses are contained as warnings. Redirects are refused so session details cannot be forwarded to another origin.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`src/index.ts` owns trigger wiring and live configuration. `agent/turn-stopping` is observed globally across agent scopes; goal completion is observed from committed `goal/change` Session events. Changing `enabled` or `trigger` rewires only those listeners. Other volatile fields are read immediately before each delivery, so message or endpoint edits take effect without listener churn.

`src/notify.ts` owns pure variable projection, template substitution, and the bounded HTTP POST. In-flight deliveries are tracked by the plugin: disposal aborts them and drains their promises so no late callback outlives the fiber.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [agent-loop](../../core/agent-loop/README.md) — owns the turn-stopping boundary.
- [goal](../../goal/goal/README.md) — owns durable goal completion changes.
- [settings](../../settings/settings/README.md) — projects volatile plugin configuration into Settings forms.

-----

<a id="model-experience"></a>
## Model Experience

None, as task-end notifications are outbound Host effects and add no prompt, message, tool schema, tool result, or provider request.

#### KV Cache effect

None; this package neither assembles nor changes model input.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Turn end includes interactive stops:** a turn that stops to ask the user a question also qualifies as `turn-end`.
- **No retry or dead-letter queue:** a failed notification is warned once and dropped.
- **No retroactive delivery:** task ends that occur while the process is down are not replayed when it restarts.
