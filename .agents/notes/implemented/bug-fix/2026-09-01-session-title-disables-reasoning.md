# Agent Note: session-title requests disable supported reasoning

Status: implemented

English | [中文](2026-09-01-session-title-disables-reasoning.zh.md)

## Problem

The bundled session-title provider gives its auxiliary model call a small output budget. A reasoning model whose deployment default is a high thinking level can spend that budget on private reasoning and return no title, leaving the fallback title in place even though automatic naming dispatched successfully.

## Decision

The pi-ai adapter treats `session-title` like `compaction`: when the selected model explicitly supports `off`, the auxiliary request uses it instead of the request or profile reasoning default. Models that do not expose `off` keep the provider default because the adapter cannot claim a control the route does not support. Main agent requests retain their selected thinking level.

## Alternatives considered

- **Increase the title output cap.** Rejected because it delays the same failure and spends more output tokens on reasoning unrelated to the title.
- **Disable thinking in the model server.** Rejected because the server default also serves main agent requests that intentionally use reasoning.
- **Set `reasoningEffort: 'off'` only in the bundled title provider.** Rejected because purpose-aware reasoning selection already belongs to the adapter, which can check the exact selected model before network I/O.

## Testing

Adapter tests cover both DeepSeek-style and Qwen chat-template requests, verify that `compaction` and `session-title` disable supported reasoning, and preserve the normal request's configured effort.

## Consequences

Title generation uses its bounded output budget for visible title text on controllable reasoning models. A route that omits `off` from its declared capabilities may still spend the budget on provider-default reasoning; the deployment must describe that capability before the adapter can disable it.
