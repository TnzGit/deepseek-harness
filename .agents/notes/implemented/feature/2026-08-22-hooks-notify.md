# Agent Note: dsh-hooks-notify — the task-end webhook notifier

Status: implemented

English | [中文](2026-08-22-hooks-notify.zh.md)

## Problem

A personal deployment wants a sound when a task ends: the agent finished answering, or a goal completed. The existing hook bridges (`dsh-hooks-claude-code` / `dsh-hooks-codex`) can run a `curl` command hook on `Stop`, but that means maintaining a shell script outside the harness, and nothing about it is editable from the Web settings UI. The deployment wants a first-class, settings-editable notifier.

## Decision

One new function plugin in the hooks group, `@deepseek-ai/dsh-hooks-notify`, mounted as a base-composition row and inert until enabled:

- **Triggers.** `turn-end` (default) listens on `agent/turn-stopping`; `goal-complete` listens on `session/event` and fires when a `goal/change` event carries `operation: 'complete'`; `both` registers both listeners. Trigger changes re-wire the listeners live through `installSettingsSection`'s `onChange`.
- **Delivery.** One detached `POST {message, sound, repeat}` as `application/json` via platform `fetch`, bounded by `AbortSignal.timeout(timeoutMs)`, `redirect: 'error'` so session details cannot follow a redirect. No retries; failures are contained warnings. The loop never waits.
- **Configuration.** The entire `Config` is the `hooks-notify` settings namespace with schema defaults (`enabled: false`, the LAN endpoint URL, `任务完成` template with `{{cwd}}/{{session}}/{{turn}}/{{goal}}`, `Glass`, 1, 5000 ms). A `validate` hook refuses non-http(s) endpoint URLs at write time. The card in `ui-settings-plugins` (keyed on the namespace, like the other shipped cards) edits it all; `booleanField`/`selectField` joined the shared card-form specs to render the switch and the trigger choice.

## Testing

- `tests/notify.spec.ts` — template rendering and the delivery contract (single POST, JSON body, non-2xx fails loud, timeout aborts) against an injected fetch.
- `tests/task-end.spec.ts` — real composition: agent loop + mock model + file-backed settings + a loopback HTTP endpoint. Pins one notification per stopped turn, silence while disabled, goal-completion-only firing with the objective, and live re-wiring on settings updates.

## Alternatives considered

- **A command hook through `dsh-hooks-codex`/`dsh-hooks-claude-code` running `curl`.** Rejected: it moves deployment-specific policy into an out-of-repo `hooks.json`, cannot be edited from the settings UI, and couples a personal notifier to a compatibility bridge whose contract belongs to external protocols.
- **Extending one of the bridges with an HTTP hook type.** Rejected: the bridges deliberately run only sync command hooks of their dialects; a native webhook type would change their protocol contracts for a need a native plugin serves without touching them.

## Consequences

Turn end includes interactive stops (a pause that asks the user something notifies too); the harness exposes no stop-reason signal yet, so the README records this as a known limitation rather than guessing one.
