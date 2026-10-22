---
description: "Restore V4 Session logs as V5 while preserving old generations and admitting the V5 writer."
kind: "package-library"
---

# @deepseek-ai/dsh-session-format-v4-to-v5

English | [中文](README.zh.md)

## Summary

Restore valid V4 Session generations as V5 without changing their stored files. The static Session format catalog uses this adjacent migration when it reads historical logs; JSONL persistence publishes a verified V5 successor only for a write open. The package also provides the native V5 physical codec and validator. It has no Cordis mount configuration.

## Table of Contents

- [Use this package](#use-this-package)
- [V4-to-V5 specification](#v4-to-v5-specification)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The [static catalog](../session-format-catalog/README.md) is the application entry point. It imports the migration, the released V4 source codec, the V5 target codec, the header validator, and the target restorer from [this package's exports](src/index.ts). A caller does not install or mount this library as a plugin.

```text
const restore = sessionFormatCatalog.createRestore(physicalHeader, {
  recovery: 'strict', validation: 'current',
})
for (const row of physicalRows) restore.decodeRow(row)
const artifact = restore.finish()
```

A successful historical read returns V5 logical events in memory. A malformed source, unsupported required event, or invalid target relationship refuses restoration; the catalog does not publish a partial successor. [JSONL persistence](../session-persistence-jsonl/README.md) owns verified, exclusive publication on write open.

-----

<a id="v4-to-v5-specification"></a>
## V4-to-V5 specification

| Source | V5 result |
|---|---|
| Valid V4 logical header | Only `version: 4` becomes `version: 5`; id, creation time, parent, seed, cwd, preset, and delegation fields stay unchanged. |
| V4 physical header and rows | The released V4 codec decodes them; the V5 codec retains the same row framing under the V5 header. |
| Every decoded V4 event and compact run | Events are emitted in order without changing type, sequence, time, data, message fields, source attribution, surface operations, or references. |
| Inherited prefix | The last inherited end-seed marker supplies the same logical cut; an available source cut must agree. |
| V4 delivery marker | Its active V4 coordinates are checked; a source marker claiming target generation V5 is refused. |

The stage does not reinterpret V4 message slots or invent new source kinds. Native V5 writers may use the new producer-owned source variants and recovery events declared by the current Session types. V5 validation retains V4's tool-role, developer, surface, lifecycle, catalog, and delivery relationships, including active V5 delivery ownership. Unknown required events are refused; unknown ignorable events remain uninterpreted under the installed vocabulary.

The V4 source codec and previous adjacent edges remain unchanged. A read open translates in memory; a write open encodes, verifies, and exclusively publishes only the final V5 generation beside the untouched source. The [Session format decision](../../../.agents/notes/implemented/architecture/2026-08-31-released-session-format-migrations.md) owns publication and recovery policy.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The migration creates one independent streaming stage per artifact. The target codec delegates physical event framing to the frozen V4 codec and changes only the header generation. The target restorer uses the established V4 relationship checks with V5 delivery ownership, then the catalog applies installed Session validation when requested.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Session format protocol](../session-format/README.md) defines stage composition and codec policies.
- [Historical V4 reference](../../../docs/persistence-changes/historical-formats/v4.md) retains the outgoing declared schema.
- [Session format status](../../../docs/session-format-status.md) distinguishes writer, accepted baseline, and published version.

-----

<a id="model-experience"></a>
## Model Experience

### Historical restoration

#### What the model sees

The resumed model receives messages such as `user/message` reconstructed from the unchanged V4 event payloads. This edge adds no prompt text, tool schema, or result.

#### Token effect

The edge preserves existing model-visible content without adding tokens. Later Agent steps may append their own content independently.

#### KV Cache effect

The edge preserves the reconstructed historical prefix. Whether a provider can reuse it after resuming depends on the full request and provider cache, not this library.

## Known Limitations and Deferred Work

- **Historical refusal remains possible** — malformed or unsupported V4 content is not repaired by an identity migration; the source generation remains unchanged and no V5 successor is published.
- **Interim V5 generations do not rerun** — a V5 file written during development already has the target version, so later converter fixes require replaying the unchanged V4 source in an isolated home for validation.

No runtime invariant companion is published because this pure migration library owns no independently maintained runtime observations.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
