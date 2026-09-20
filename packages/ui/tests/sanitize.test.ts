import { describe, it, expect } from 'vitest'
import {
  sanitizeHtml,
  escapeHtml,
  containsDangerousContent,
  getSafeTextContent,
} from '../utils/sanitize'

describe('sanitizeHtml', () => {
  it('returns an empty string for falsy input', () => {
    expect(sanitizeHtml('')).toBe('')
  })

  it('escapes HTML tags so markup cannot be injected', () => {
    expect(sanitizeHtml('<b>hi</b>')).toBe('&lt;b&gt;hi&lt;/b&gt;')
    expect(sanitizeHtml('<script>alert(1)</script>')).not.toContain('<script')
  })

  it('escapes ampersands', () => {
    expect(sanitizeHtml('a&b')).toBe('a&amp;b')
  })
})

describe('escapeHtml', () => {
  it('escapes all HTML special characters', () => {
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#039;')
  })

  it('passes plain text through unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world')
  })

  it('coerces non-string input to a string', () => {
    expect(escapeHtml(123 as unknown as string)).toBe('123')
  })
})

describe('containsDangerousContent', () => {
  it('detects script tags', () => {
    expect(containsDangerousContent('<script>bad()</script>')).toBe(true)
  })

  it('detects javascript: urls', () => {
    expect(containsDangerousContent('href="javascript:alert(1)"')).toBe(true)
  })

  it('detects inline event handlers', () => {
    expect(containsDangerousContent('<img onerror=boom>')).toBe(true)
  })

  it('returns false for safe content', () => {
    expect(containsDangerousContent('just normal text')).toBe(false)
  })

  it('returns false for non-string input', () => {
    expect(containsDangerousContent(null as unknown as string)).toBe(false)
  })
})

describe('getSafeTextContent', () => {
  it('returns the text content of an element', () => {
    const el = document.createElement('div')
    el.textContent = 'safe text'
    expect(getSafeTextContent(el)).toBe('safe text')
  })

  it('returns an empty string for an element without text', () => {
    const el = document.createElement('span')
    expect(getSafeTextContent(el)).toBe('')
  })
})
