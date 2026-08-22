# @deepseek-ai/dsh-session-title-first-prompt-llm

English | [中文](README.zh.md)

Optional `ctx.sessionTitle` provider that summarizes human messages through `ctx.llm` with a user-configurable cadence. The historical package name reflects the original behavior; the `session-title` settings namespace now selects between two modes:

| `mode` | Behavior |
|---|---|
| `first` (default) | Titles once from the opening eligible prompt of a fresh non-fork session, exactly as before. |
| `every-nth` | Titles on prompt 1 and regenerates after each further batch of `everyNPrompts` eligible prompts, framing the whole conversation history so retitles track how it moved. |

A committed cadence change disposes the previous registration — draining any in-flight auxiliary call — before the next installs. A user rename still pins the title regardless of mode. An automatic failure retains the latest title and is retried only through `ctx.sessionTitle.refresh()`.

The plugin uses the complete required [shared LLM configuration](../session-title-llm/README.md#configuration). Omit both `provider` and `model` to inherit the exact route from the current logged main request, or set both to route title generation independently.

## Settings: `session-title`

| Key | Default | Meaning |
|---|---|---|
| `mode` | `first` | `first` or `every-nth`; edits apply live by re-registering the provider. |
| `everyNPrompts` | `3` | Positive integer; eligible prompts between automatic revisions on the `every-nth` cadence. |

## Model Experience

### Title request

#### What the model sees

The title model receives the shared title instruction and a JSON array of the selected human messages: only the opening prompt on `first`, the whole eligible history on `every-nth`. Fork inheritance and the cadence decide whether later prompts trigger another automatic call.

#### Token effect

On `first`, at most one automatic auxiliary request runs per fresh session; on `every-nth`, one per boundary — each bounded by `maxInputBytes` and `maxOutputTokens`. Explicit refreshes may make additional calls. The main agent request gains zero tokens.

#### KV Cache effect

No main-request invalidation. The auxiliary request uses the configured or logged route and has provider-specific cache behavior.

## Known Limitations and Deferred Work

- On the default `first` mode, the first message alone may cease to represent a long-running session; switch the card to `every-nth`, or compose the all-messages provider when later prompts should retitle it.
- A fork keeps its inherited title and never runs this provider automatically, even when its seeded first message came from the parent.
