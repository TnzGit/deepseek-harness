# Agent Note: Recover capped compaction summaries

Status: implemented

English | [中文](2026-09-26-capped-summary-recovery.zh.md)

## Problem

A long session can qualify for pressure compaction yet repeatedly fail to land a checkpoint when the summarizer consumes its full output cap. Continuing from the unchanged history then reaches the provider's context limit. An adapter that hides its effective default output cap also prevents request admission from reserving the same output budget that the provider uses.

## Decision

The basic compaction backend retries a `MAX_TOKENS` summary on progressively smaller, token-meter-priced prefixes. Each prefix ends after a complete tool-call/result unit, and `summaryRangeRetries` bounds the additional attempts. Every failed attempt closes its durable marker without publishing a partial checkpoint. An indivisible span or exhausted retry budget preserves the original summary failure.

The pi-ai adapter reports the resolved model's effective `maxTokens` to the LLM service, including catalog and route fallbacks. For `purpose: 'compaction'`, it selects `off` when the model declares that reasoning level, independent of ordinary-turn defaults. Models without `off` keep their provider behavior.

## Alternatives considered

- **Increase the summary cap alone** — rejected because long histories can still fill a larger cap, especially when a provider spends tokens on reasoning.
- **Commit truncated summaries** — rejected because an incomplete checkpoint can silently omit work the session must preserve.
- **Reduce ordinary-turn reasoning** — rejected because compaction is a separate auxiliary request and should not change the user's chosen thinking level.

## Consequences

Capped summaries can converge without changing the vLLM server or discarding partial history. Recovery costs extra model calls, bounded by `summaryRangeRetries`; when no balanced split exists, the backend still fails closed. Exposing the effective output cap can start pressure handling earlier for routes whose catalog default was previously invisible.
