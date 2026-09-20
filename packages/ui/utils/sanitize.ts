/**
 * HTML Sanitization Utilities
 * 
 * Provides safe HTML handling to prevent XSS attacks.
 * All user-generated content should be sanitized before rendering.
 */

// DOMPurify import (will be installed as dependency)
// import DOMPurify from 'dompurify'

/**
 * Sanitize HTML string to prevent XSS attacks
 * @param html - Raw HTML string from user input
 * @param options - Optional configuration for sanitization
 * @returns Safe HTML string
 */
export function sanitizeHtml(html: string, options: { allowedTags?: string[] } = {}): string {
  // Fallback implementation if DOMPurify is not available
  // In production, use DOMPurify for robust sanitization
  
  if (!html) return ''
  
  // Basic fallback: escape all HTML tags
  const div = document.createElement('div')
  div.textContent = html
  return div.innerHTML
}

/**
 * Escape HTML special characters to prevent XSS
 * @param text - Plain text to escape
 * @returns Escaped text
 */
export function escapeHtml(text: string): string {
  if (typeof text !== 'string') return String(text)
  
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }
  
  return text.replace(/[&<>"']/g, (m) => map[m])
}

/**
 * Check if a string contains potentially dangerous content
 * @param input - Input string to check
 * @returns true if dangerous content detected
 */
export function containsDangerousContent(input: string): boolean {
  if (typeof input !== 'string') return false
  
  const dangerousPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i,  // Event handlers like onclick=
    /<iframe/i,
    /<object/i,
    /<embed/i
  ]
  
  return dangerousPatterns.some(pattern => pattern.test(input))
}

/**
 * Get safe text content from an element
 * @param element - DOM element
 * @returns Safe text content
 */
export function getSafeTextContent(element: Element): string {
  return element.textContent || element.innerText || ''
}
