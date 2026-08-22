# Agent Note: configurable session-title cadence (every-nth-prompt)

Status: implemented

English | [中文](2026-08-22-session-title-cadence.zh.md)

## Problem

The log-backed title service ([log-backed session titles](../../implemented/feature/2026-07-21-log-backed-session-titles.md)) shipped two provider-owned cadences: `first-prompt` (the bundled LLM provider's mode — a conversation is titled once and never again) and `all-prompts`. A deployment that wants periodic retitling had to choose "never again" or "on every single prompt"; there was no middle ground, and nothing was editable from the settings UI.

## Decision

1. **Service contract** (`dsh-session-title`): the automatic-mode union gains `'every-nth-prompt'`, and `SessionTitleProvider` gains an optional `promptInterval` that validation requires to be a positive integer exactly for that mode. Scheduling counts eligible human prompts: prompt 1 titles immediately, then every further batch of N prompts schedules one revision. The cadence stays provider-owned — the service only interprets the declared mode, so existing `first-prompt`/`all-prompts` providers are untouched.
2. **Deployed wrapper** (`session-title-first-prompt-llm`, historical name kept): registers unconditionally from its composition entry (so compositions without a settings service keep today's behavior), then layers the `session-title` settings namespace (`mode: 'first' | 'every-nth'`, `everyNPrompts`). A committed change disposes the previous registration through the service's drain-before-reregister contract before installing the next; the first-prompt mode frames only the opening message while every-nth frames the whole eligible history.
3. **Settings card**: ui-settings-plugins ships a card keyed on the `session-title` namespace with the cadence select and interval field, reusing the shared form specs.

## Alternatives considered

- **Throttling inside an `all-prompts` provider.** Rejected: the provider contract has no decline path, so skipping would mean appending duplicate title events or misusing the result shape; the cadence belongs where it is owned.
- **A third thin wrapper package** instead of extending the deployed one in place. Rejected: swapping the mounted row would change title provenance ids and churn composition manifests for no behavioral gain; the README documents the historical name.

## Testing

- Service: an every-nth spec pins scheduling at prompts 1 / 1+N / skipped between, full-history revisions, and registration validation failures; all first-prompt/all-prompts specs stay green unchanged.
- Wrapper: settings-driven registration with live dispose→register ordering, write rejection for a non-positive interval, and per-cadence message framing through a recording adapter.
- Card: controller projection/save and component render specs join the other cards.

## Consequences

"Turns" means eligible human prompts — the count the domain already derives titles from; agent reply turns do not drive retitling. The default (`first`) preserves pre-change behavior exactly.
