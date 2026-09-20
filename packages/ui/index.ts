// Multi-Publish UI Component Library
// Main Entry Point

export { Button } from './components/Button/Button.vue'
export type { default as ButtonProps } from './components/Button/Button.vue'

export { Input } from './components/Input/Input.vue'
export type { default as InputProps } from './components/Input/Input.vue'

export { Card } from './components/Card/Card.vue'
export type { default as CardProps } from './components/Card/Card.vue'

export { Modal } from './components/Modal/Modal.vue'
export type { default as ModalProps } from './components/Modal/Modal.vue'

export { Navigation } from './components/Navigation/Navigation.vue'
export type { default as NavigationProps, NavItem } from './components/Navigation/Navigation.vue'

// Export utils
export { sanitizeHtml, escapeHtml, containsDangerousContent, getSafeTextContent } from './utils/sanitize'

// Export design tokens (CSS variables will be imported separately)
export * from './utils/sanitize'
