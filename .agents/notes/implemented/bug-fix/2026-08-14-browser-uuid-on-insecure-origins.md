# Agent Note: Generate browser UUIDs on insecure origins

Status: implemented

English | [Chinese](2026-08-14-browser-uuid-on-insecure-origins.zh.md)

## Problem

The Web profile advertises LAN URLs when its server is bound through configuration, but a browser that opens one of those URLs over plain HTTP does not have a secure context. `crypto.randomUUID()` is unavailable there. The client RPC carrier and conversation attachment composer called that API directly, so initial API traffic or adding an image could throw before the request reached the host.

The connection client already carried a local `getRandomValues()` implementation for one RPC path. Keeping that implementation private left the shared fetch client and conversation UI exposed and encouraged more browser-only UUID implementations to diverge.

## Decision

`@deepseek-ai/dsh-host-apiproxy/api` exports `randomUuid()`, an RFC 4122 version 4 generator backed by `globalThis.crypto.getRandomValues()`. That Web Crypto primitive remains available on insecure browser origins. The helper owns client-side correlation and ephemeral identifiers; it does not replace Node-only UUID generation.

The abstract fetch client, connection RPC and fixture carriers, and conversation draft attachments use the shared helper. The former connection-local copy is removed. `dsh-client-ui-conversation` declares the API package as a direct peer and development dependency because its browser bundle imports the helper at runtime.

## Alternatives considered

**Install a global `crypto.randomUUID` polyfill in the Web entry point.** Rejected because it mutates ambient platform state, depends on bootstrap order, and leaves independently bundled client packages unsafe when they run outside that entry point.

**Guard each call and duplicate a local fallback.** Rejected because the connection package already demonstrated that this fixes one caller while allowing equivalent browser paths to drift or remain unpatched.

**Create a new workspace utility package for one function.** Rejected for now because the API package already owns browser-safe RPC identifiers and is part of the client contract. A dedicated package would add publication and dependency surface without a second domain-neutral utility requirement.

**Replace every `randomUUID()` call in the repository.** Rejected because most calls import `node:crypto` and run only on the trusted host. The LLM message constructor present in the fixture bundle is not one of the live Web transport or composer paths covered by this defect.

## Consequences

Configured LAN HTTP access can mint live client RPC IDs and draft attachment IDs without requiring a secure context. UUIDs retain their version 4 and RFC variant bits, and the implementation still requires Web Crypto randomness rather than falling back to `Math.random()`.

Focused tests remove `randomUUID` from the ambient crypto object while preserving deterministic `getRandomValues()` and pin both RPC and draft-attachment behavior. TypeScript project builds, package-invariant checks, bundle-purity checks, and the client library build verify that the new direct dependency remains browser-safe.

The helper is deliberately not a general repository UUID abstraction. If another domain-neutral browser package needs the same primitive without depending on the API contract, that additional consumer is the point to reconsider a dedicated utility package.
