{
  "schemaVersion": 1,
  "issues": [
    {
      "id": "i1",
      "severity": "Critical",
      "dimension": "correctness",
      "finding": ".ccg/reviews/dd8ec146...json uses sha: 71a61e540... but declared head is 04005ae35...; review artifact references a different commit, invalidating the review decision.",
      "suggestion": "Regenerate .ccg/reviews/ from actual head SHA or remove stale artifact before merging."
    },
    {
      "id": "i2",
      "severity": "Critical",
      "dimension": "maintainability",
      "finding": "empty-state.contract.test.js binds deferred registry DASHED_REGISTRY to live regex scan; fixing a deferred item breaks the test with no auto-update mechanism.",
      "suggestion": "Derive registry from source automatically or add a sync-failure CI gate instead of manual registry."
    },
    {
      "id": "i3",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "dashedEmptyStateClasses() regex ([^{}]*) misses dashed rules in nested blocks or multi-selector rules where empty/zero class is not first selector; false negatives possible.",
      "suggestion": "Replace regex scan with a CSS parser (postcss) to reliably read selectors and declarations."
    },
    {
      "id": "i4",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "DASHED_REGISTRY has 8 items (includes s2v-estimate-note) but docs only list 3 kept and omit it; registry and documentation are out of sync.",
      "suggestion": "Sync docs with all registry entries or remove unmentioned items; enforce doc-check in CI."
    },
    {
      "id": "i5",
      "severity": "Warning",
      "dimension": "correctness",
      "finding": "Diff updates claims to 43 PNG baselines but only one binary (06-performance-insights-after.png) changed; rest of claimed 43 files unverified in commit.",
      "suggestion": "Commit all 43 PNG updates or adjust claim to match actual diff contents."
    },
    {
      "id": "i6",
      "severity": "Warning",
      "dimension": "maintainability",
      "finding": "READY_TIMEOUT fixed in ui-audit-probes.js but other split scripts (curate-ui-audit-evidence.js, scenes, etc.) not shown with constant/import audits.",
      "suggestion": "Audit every split file for missing references and add a per-script smoke execution test."
    },
    {
      "id": "i7",
      "severity": "Info",
      "dimension": "maintainability",
      "finding": "CHANGELOG/doc references 210-line manifest but ui-audit-manifest.md/.json updates are absent from the diff; numbers refer to uncommitted files.",
      "suggestion": "Include manifest updates in the same commit or reference them explicitly with file paths."
    }
  ],
  "dimensionScores": {
    "correctness": 4,
    "security": 7,
    "performance": 6,
    "maintainability": 3
  }
}