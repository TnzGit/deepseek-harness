# Agent Note: Mobile history window and HTTP response compression

Status: implemented

English | [中文](2026-08-20-mobile-history-http-compression.zh.md)

## Problem

The browser client previously opened every conversation with the same 50-message history page regardless of viewport. On phones that makes first paint pay for far more Conversation events and rendered nodes than are immediately visible, and long assistant streams can make one logical message contain hundreds or thousands of raw events. Unary JSON API responses were also sent uncompressed even when the browser advertised Brotli or gzip support.

An older local implementation additionally had to prevent the Host from cutting a message or tool call at a page boundary. The current upstream paginator already owns that invariant: `session.history` selects complete append-origin message groups and pulls an assistant message's `sourceEventSeqs` plus its following tool-call/result tail into the same page. This change reuses that authority instead of adding a second pagination algorithm.

## Decision

Desktop history keeps the existing 50-message tail and older-page size. A compact mobile viewport (`max-width: 767px`) starts with the latest three complete message groups. The mobile tail also has a soft 1500-event budget: if the complete three-message page exceeds it, the client re-requests two messages and then one message if necessary. It never slices a returned event array. A single logical message that itself exceeds 1500 events therefore remains complete; message/tool integrity outranks the soft event target. Loading older history always returns to the ordinary 50-message page size.

The same mobile tail policy is used for initial open, reconnect rebuild, and gap repair so those paths cannot silently re-expand the first window to desktop size.

At the node:http bridge, JSON responses larger than 1 KiB are compressed when the request's `Accept-Encoding` permits it. Brotli is preferred when its quality is at least gzip's; otherwise gzip is used. Existing `Content-Encoding` is preserved, compressed responses set `Content-Length` and vary on `Accept-Encoding`, and small JSON stays uncompressed. Non-JSON and streaming responses remain on the existing incremental path, so SSE is never buffered merely for compression.

## Alternatives considered

**Hard-cap the raw event count even when it splits a logical message.** Rejected because replay and tool-call integrity require complete append-origin groups.

**Buffer and compress SSE responses too.** Rejected because it would destroy incremental delivery and increase time to first visible output; compression is limited to completed unary JSON bodies.

## Verification

`packages/client/runtime/tests/mobile-history.client.spec.ts` pins desktop 50-message opening, mobile three-message opening, the three-to-two-to-one soft-event fallback, preservation of an intrinsically larger single message, and 50-message upward pagination. `packages/host/apiproxy/tests/api-proxy-view.spec.ts` pins the Host invariant that a one-message page containing an assistant tool call also contains all cited assistant chunks plus the tool call and result while the older message stays outside the page. `packages/client/connection/tests/http-bridge.host.spec.ts` pins Brotli preference, gzip fallback, the 1 KiB threshold, and the uncompressed streaming path.

## Consequences

Phone conversations do substantially less history assembly and rendering before first interaction, while desktop behavior and upward history throughput are unchanged. Extremely event-heavy single messages can still exceed the 1500-event soft target because returning a replay-safe whole message is more important than a hard event cap. Large unary JSON responses consume less network bandwidth when the client supports compression without changing the streaming transport semantics.
