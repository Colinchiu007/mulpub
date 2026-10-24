/**
 * announcement namespace copy (ops-center announcement banner; UX audit 1.2)
 * Maintained in pairs with zh.js; pairing is enforced by src/locales/announcement-copy.test.js
 * because CI Gate 7 is blind to split locale files.
 */
export default {
  regionLabel: 'Service announcements',
  closeLabel: 'Dismiss announcement',
  severity: {
    info: 'Notice',
    warning: 'Important',
    maintenance: 'Maintenance',
  },
}
