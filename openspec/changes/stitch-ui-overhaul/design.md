# Design: Stitch UI Overhaul Implementation Approach

## Overview

This design document describes how the Apple-inspired design language from the spec will be implemented in the Multi-Publish Vue 3 + Electron desktop app. The approach is token-first, non-breaking, and validated through visual regression testing.

## Implementation Strategy

### Token-First CSS Approach

1. Create pps/desktop/src/styles/apple-design-tokens.css containing all --apple-* tokens
2. Import it after cohere-design-system.css so new tokens override old ones where needed
3. Existing cohere-* tokens remain untouched for backward compatibility
4. Components gradually adopt new tokens in their defaults

### Layered Migration

`
Layer 0: apple-design-tokens.css (NEW - pure token definitions)
Layer 1: cohere-design-system.css (EXISTING - unchanged, imports Layer 0)
Layer 2: Ui*.vue components (UPDATE visual defaults, props/emits unchanged)
Layer 3: Feature views (UPDATE layout/structure, per-page basis)
Layer 4: Page-level views (UPDATE information architecture, per-page basis)
`

Each layer is independently deployable and testable. No layer requires all others to be complete.

## /publish Page Restructuring

### Current State Analysis

The Publish.vue (591 lines) is a single-file component with:
- Drafts tab and publish tab in one component
- Content editor, target selector, account picker all interleaved
- Batch mode toggle in the header
- Template picker, AI features, tags, platform overrides mixed with core flow
- No clear visual separation between primary (editor) and secondary (configuration) areas

### Proposed Information Architecture

**Primary Zone** (70% width, always visible):
- Title input (full width, prominent)
- Content editor (textarea, full height)
- This is what the user interacts with 80% of the time

**Secondary Zone** (30% width, right panel):
- Platform target selector (WeChat, Zhihu, Douyin, Xiaohongshu)
- Account selector (dropdown or card list)
- Publish / Schedule button (sticky at bottom)

**Tertiary Zone** (collapsible, below secondary or in overflow menu):
- Tags input
- AI optimization features
- Template picker
- Platform-specific overrides
- Batch mode controls

### Progressive Disclosure Pattern

1. Default view: Title + Content + Target + Account + Publish button
2. Expand tags: Click to reveal tag input
3. Expand AI features: Click to reveal AI tools
4. Platform overrides: Only shown when multiple targets selected
5. Batch mode: Toggle switches the entire layout to batch view

## Component Updates (Non-BREAKING)

### UiButton Changes

- Update default styling to use apple tokens (radius, padding, shadow)
- Existing props (variant, size, disabled, tag) remain identical
- New optional prop: pple-style (boolean) - opt-in for new look during migration
- Visual diff: new default has 6px radius (was 4px), slightly larger padding, no border for primary variant

### UiCard Changes

- Replace shadow-based definition with border-based (1px border + subtle hover shadow)
- Background stays white, but removes heavy gradient overlay
- No prop changes

### UiInput Changes

- Focus ring changes from box-shadow to outline (2px solid accent)
- Border radius updates to 6px
- No prop changes

### UiBadge Changes

- Background becomes semantic color at 10% opacity
- Border removed (pure background + text contrast)
- No prop changes

## Test Strategy

### Visual Regression Baseline

New baselines will be captured for:
1. /publish - editor form (single mode)
2. /publish - editor form (batch mode)
3. /publish - draft list
4. UiButton - all variants and sizes
5. UiInput - default, focused, disabled, error states
6. UiCard - default, with header/footer
7. UiBadge - all semantic variants

### Existing Tests

- All existing .test.js files for Ui components must continue to pass
- Props/emits API must not change
- Component rendering tests validate visual output

### New Tests

- Token CSS validation: all --apple-* tokens are defined
- Accessibility: contrast ratios meet WCAG 2.1 AA
- Visual regression: pixel-diff comparison against new baselines
- Component compatibility: existing prop combinations still render correctly

## File Changes Summary

| File | Action | Risk |
|------|--------|------|
| styles/apple-design-tokens.css | CREATE | Low (additive) |
| styles/cohere-design-system.css | MODIFY (import tokens) | Low |
| components/UiButton.vue | MODIFY (visual defaults) | Medium |
| components/UiInput.vue | MODIFY (visual defaults) | Medium |
| components/UiCard.vue | MODIFY (visual defaults) | Medium |
| components/UiBadge.vue | MODIFY (visual defaults) | Low |
| iews/Publish.vue | MODIFY (layout restructure) | High |
| 	ests/visual-testing/ | ADD baselines | Low |

## Implementation Order

1. Create pple-design-tokens.css and import in cohere-design-system.css
2. Update UiButton visual defaults (most visible component)
3. Update UiCard visual defaults (most used container)
4. Update UiInput visual defaults (form experience)
5. Update UiBadge visual defaults (status display)
6. Capture visual regression baselines for updated components
7. Restructure /publish layout (primary + secondary + tertiary zones)
8. Capture visual regression baselines for /publish
9. Run full test suite + visual regression
10. Update design-system-usage.md documentation

## Risk Mitigation

- **Token coexistence**: Old tokens never deleted, new tokens prefixed --apple-*
- **Component API frozen**: No props/emits changes, only CSS default updates
- **Visual regression gates**: New baselines captured before layout restructure
- **Incremental rollout**: Each component updated and tested independently
- **Rollback**: Git branch isolation allows easy revert per-component

## Open Questions

1. Should the pple-style opt-in prop be used during migration, or should we update defaults directly?
2. How to handle the MpSidebar layout (current: 376 lines, complex) - inline or separate task?
3. Dark mode priority: implement token mapping now or defer to after all pages migrated?
