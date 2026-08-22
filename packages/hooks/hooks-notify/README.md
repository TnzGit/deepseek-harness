# @deepseek-ai/dsh-hooks-notify

English | [中文](README.zh.md)

Task-end webhook notifier. When an agent turn stops or a goal completes, it POSTs a JSON payload to a configured endpoint — typically a LAN device that plays a sound. It is a function/namespace plugin with no required services; its entire configuration lives in the `hooks-notify` settings namespace (`ctx.settings`), so every value edits live from configuration surfaces without a restart.

## Triggers

| Trigger | Source | Fires |
|---|---|---|
| `turn-end` (default) | `agent/turn-stopping` | Every time an agent turn stops, including stops that end in a question to the user. |
| `goal-complete` | `goal/change` session events | When the current goal's phase becomes `complete`. |
| `both` | both of the above | Either fact notifies. |

Delivery is detached by contract: the loop never waits for the endpoint, notifications are not retried, and a failure (network error, timeout, non-2xx answer) is a contained warning. Redirects are refused before the target is contacted so session details cannot follow one. Each request waits at most `timeoutMs`.

## Config

All keys are optional; the schema defaults below ship in the base composition row.

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Master switch. While false nothing is sent and no listeners are registered. |
| `url` | `http://192.168.10.111:18473/notify` | Notify endpoint receiving the JSON payload. Must be an absolute http(s) URL; anything else refuses the write that produced it. |
| `trigger` | `turn-end` | Which task ends notify: `turn-end`, `goal-complete`, or `both`. Changes re-wire the listeners live. |
| `message` | `任务完成` | Message template. `{{cwd}}`, `{{session}}`, `{{turn}}`, and `{{goal}}` substitute the ended task's facts; unknown placeholders stay verbatim. |
| `sound` | `Glass` | Device sound name forwarded verbatim. |
| `repeat` | `1` | Positive integer; how many times the device repeats the sound. |
| `timeoutMs` | `5000` | Positive integer; bounded wait for the endpoint's answer. |

The body is always `{ message, sound, repeat }` posted as `application/json`.

```yaml
- id: hooks-notify
  name: '@deepseek-ai/dsh-hooks-notify'
```

The row above is the base layer of the `hooks-notify` Settings section: a user-layer edit reaches the next task end without a restart, because the plugin reads the resolved section per notification and re-registers its listeners when `trigger` changes.

## Model Experience

### Task-end notification

#### What the model sees

Nothing. Notifications travel outbound only; no session event, context message, or prompt section is added, and delivery failures never reach a model request.

#### Token effect

None.

## Known Limitations and Deferred Work

- **Turn end includes interactive stops:** an agent pause that ends in `ask_user_question` or another user-facing ask counts as a turn end and notifies. Distinguishing stop reasons needs a harness signal that does not exist yet.
- **No retry or dead-letter:** a failed notification is warned once and dropped; there is no queue.
- **Goal completion follows the durable event stream:** notifications fire from committed `goal/change` events, so a goal completed while the process was down does not notify retroactively.
