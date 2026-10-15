/**
 * cards namespace copy (paired with cards/zh.js — CI Gate 7 enforces parity)
 */
export default {
  entryLabel: 'Generate image cards',
  entryDesc: 'Split a long article into per-page image cards and export each as PNG',

  rendering: 'Generating image cards…',
  renderingStep: 'Page {current} / {total}',

  resultTitle: 'Image cards generated',
  resultCount: '{count} card(s)',
  resultHint: 'Saved to a temporary folder; available when publishing',

  failedTitle: 'Failed to generate image cards',
  failedValidation: 'Invalid input: {message}',
  failedService: 'Rendering service is temporarily unavailable, please retry',
  failedCount: 'Page count mismatch (expected {expected}, got {actual}); this run was discarded',
  failedUnknown: 'Generation failed: {message}',

  // Warnings must be surfaced whenever non-empty — never silently dropped.
  warningsTitle: 'Please note',
  warningItemExceedsPage: 'A single block exceeded one page and was placed on its own page (layout may look sparse)',
  warningPageLimitReached: 'The page limit was reached; remaining content was not included',
}
