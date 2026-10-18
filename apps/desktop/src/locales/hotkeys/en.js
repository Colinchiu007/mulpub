/**
 * hotkeys namespace copy (UX-AUDIT-2026-10-17, phase 1.6)
 * label.* maps 1:1 to labelKey in electron/services/hotkeys.js. zh/en pairs (CI Gate 7).
 */
export default {
    title: 'Keyboard shortcuts',
    subtitle: 'App-wide shortcuts that work on every page. Keys are built in and not customizable yet.',
    colKeys: 'Keys',
    colAction: 'Action',
    loading: 'Loading shortcuts…',
    unavailable: 'The shortcut list is unavailable here (running in a browser preview without the desktop main process).',
    retry: 'Reload',
    customizeHint: 'Need different keys? Tell us via Settings → Send feedback.',
    label: {
      publish: 'Open Publish',
      newPublish: 'New publish',
      dashboard: 'Open Dashboard',
      collection: 'Open Collection',
      home: 'Back to Home',
      accounts: 'Open Accounts',
      keywords: 'Open Keyword Monitor',
      viral: 'Open Viral Analysis',
      quit: 'Quit the app',
    },
  }
