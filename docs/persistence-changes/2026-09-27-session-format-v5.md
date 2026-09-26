---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-27-session-format-v5

English | [中文](2026-09-27-session-format-v5.zh.md)

## Summary

Advances the Session writer to format V5 for explicit long-task and Agent-loop recovery records, and expands producer-owned message attribution.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-27-session-format-v5
baseline: false
changes:
  - root: "SessionHeader"
    previous: "2026-09-16-session-format-v4"
    after: "22c6899a78214dd841c266348ae997027ef391174ddb21127f1b71dc1b362824"
    decision: version-bump
  - root: "event:agent/degenerate-response"
    previous: null
    after: "14fa8a996f2a9563d248c4acf81ac1d7d45e522f275575d31903d8ceb2b00ca9"
    decision: version-bump
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-16-session-format-v4"
    after: "a2fd7837ead8ae147cd7e597aafd411375bf022f0aa8e0efe4e9fe91a396d993"
    decision: version-bump
  - root: "event:agent/max-token-continuation"
    previous: null
    after: "6decc04f2620a0ab82a16f7a42888df7ba1ce59b395a409f3a2075c64e302d00"
    decision: version-bump
  - root: "event:developer/message"
    previous: "2026-09-16-session-format-v4"
    after: "23c04b27666c16ff59dd33633850772541758afe5cc965265d57af52d3047a5f"
    decision: version-bump
  - root: "event:session/title-llm-request"
    previous: "2026-09-16-session-format-v4"
    after: "8b9a9cb1e2163f2327fff111f4d61af08da2d454289da980b209bd0c4f0f31f5"
    decision: version-bump
  - root: "event:turn/end"
    previous: "2026-09-16-session-format-v4"
    after: "6f32bb39c52c9d4b64ca564c4fb0176347c21bae212fbb72fd2d1d276da94552"
    decision: version-bump
  - root: "event:user/message"
    previous: "2026-09-16-session-format-v4"
    after: "b3a60937c1561523c58892b7470b28f4f5a711e2205cecc6075408b86dc3c187"
    decision: version-bump
```

<a id="compatibility"></a>
## Compatibility

The V4-to-V5 adjacent stage preserves historical event identities, payloads, order, and inherited cuts while changing only the header version. The static catalog retains the V4 codec and all earlier edges. Read opens migrate in memory; write opens publish a verified V5 successor beside the unchanged historical generation. Older binaries must not write V5 logs and will reject their newer generation.

<a id="verification"></a>
## Verification

The adjacent-format, catalog, and JSONL persistence suite passed: 44 test files, 1159 tests passed, one skipped. The Host TypeScript project built.

<a id="dev-note"></a>
## Dev Note

None.
