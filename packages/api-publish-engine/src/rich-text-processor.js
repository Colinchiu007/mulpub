// 富文本处理器 — 话题/@好友占位符替换 (提取自参考产品 RichTextProcessor)

function readAttribute (attributes, name) {
  const re = /(?:^|\s)([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g
  let match
  while ((match = re.exec(attributes)) !== null) {
    if (match[1].toLowerCase() === name) return match[2] ?? match[3] ?? match[4] ?? ''
  }
  return ''
}

function textFromMarkup (value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim()
}

function textFromRawAttribute (attributes) {
  const raw = readAttribute(attributes, 'raw') || readAttribute(attributes, 'data-raw')
  if (!raw) return ''
  try {
    const parsed = JSON.parse(decodeURIComponent(raw))
    if (!parsed || typeof parsed !== 'object') return ''
    for (const key of ['name', 'text', 'topicName', 'nickname']) {
      if (typeof parsed[key] === 'string' && parsed[key].trim()) return parsed[key].trim()
    }
  } catch (_) {
    // 没有合法 raw 属性时回退到标签正文。
  }
  return ''
}

function semanticLabel (attributes, innerHtml) {
  return textFromRawAttribute(attributes) || textFromMarkup(innerHtml)
}

function normalizeSemanticMarkup (html) {
  const mentions = []
  const content = html
    .replace(/<topic\b([^>]*)>([\s\S]*?)<\/topic>/gi, (full, attributes, innerHtml) => {
      const label = semanticLabel(attributes, innerHtml).replace(/#/g, '')
      return label ? `#${label}#` : textFromMarkup(innerHtml)
    })
    .replace(/<friend\b([^>]*)>([\s\S]*?)<\/friend>/gi, (full, attributes, innerHtml) => {
      const label = semanticLabel(attributes, innerHtml).replace(/@/g, '')
      if (!label) return textFromMarkup(innerHtml)
      const token = `__MP_MENTION_${mentions.length}__`
      mentions.push({ name: label, text: `@${label}` })
      return token
    })
  return { content, mentions }
}

function expandMentionTokens (value, mentions) {
  return value.replace(/__MP_MENTION_(\d+)__/g, (full, index) => mentions[Number(index)]?.text || '')
}

function isSafeImageUrl (value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch (_) {
    return false
  }
}

function sanitizeImageMarkup (html) {
  return html.replace(/<img\b([^>]*)>/gi, (full, attributes) => {
    const source = readAttribute(attributes, 'src') || readAttribute(attributes, 'data-src')
    return source && !isSafeImageUrl(source) ? '' : full
  })
}

function extractImageUrls (html) {
  const images = []
  const re = /<img\b([^>]*)>/gi
  let match
  while ((match = re.exec(html)) !== null) {
    const source = readAttribute(match[1], 'src') || readAttribute(match[1], 'data-src')
    if (source && isSafeImageUrl(source)) images.push(source)
  }
  return images
}

class RichTextProcessor {
  process(html) {
    const normalized = normalizeSemanticMarkup(typeof html === 'string' ? html : '')
    const template = sanitizeImageMarkup(normalized.content)
    const content = expandMentionTokens(template, normalized.mentions)
    const segments = [];
    let idx = 0;
    let match;
    const re = /(#([^#]+)#|@([\u4e00-\u9fa5\w-]+)|__MP_MENTION_(\d+)__)/g;

    while ((match = re.exec(template)) !== null) {
      if (match.index > idx) {
        segments.push({ type: "text", text: expandMentionTokens(template.slice(idx, match.index), normalized.mentions) });
      }
      if (match[2]) {
        segments.push({ type: "topic", text: match[0], name: match[2] });
      } else if (match[3]) {
        segments.push({ type: "mention", text: match[0], name: match[3] });
      } else if (match[4]) {
        const mention = normalized.mentions[Number(match[4])]
        if (mention) segments.push({ type: "mention", text: mention.text, name: mention.name });
      }
      idx = match.index + match[0].length;
    }
    if (idx < template.length) {
      segments.push({ type: "text", text: expandMentionTokens(template.slice(idx), normalized.mentions) });
    }

    // Build platform-specific format
    const topicOutput = segments
      .filter(s => s.type === "topic")
      .map((s, i) => ({ id: i, name: s.name, text: s.text }));

    const mentionOutput = segments
      .filter(s => s.type === "mention")
      .map((s, i) => ({ id: i, name: s.name, text: s.text }));

    return {
      content,
      segments,
      topics: topicOutput,
      mentions: mentionOutput,
      images: extractImageUrls(content),
    };
  }
}

module.exports = { RichTextProcessor };
