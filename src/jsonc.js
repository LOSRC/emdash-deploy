/**
 * Parse JSON with line and block comments and trailing commas, as `wrangler.jsonc` is written.
 * Throws a `SyntaxError` like `JSON.parse` for anything else wrong. Comments and commas inside
 * strings (a URL in `vars`, say) are left alone.
 *
 * @param {string} text
 * @returns {unknown}
 */
export function parseJsonc(text) {
  return JSON.parse(stripTrailingCommas(stripComments(text)))
}

/**
 * Replace comments with nothing (keeping newlines, so `JSON.parse`'s positions still point at the
 * right line), leaving string contents untouched.
 *
 * @param {string} text
 */
function stripComments(text) {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]
    const next = text[i + 1]
    if (c === '"') {
      const end = endOfString(text, i)
      out += text.slice(i, end)
      i = end
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2)
      if (end === -1) throw new SyntaxError('Unterminated comment in JSONC')
      out += text.slice(i, end).replace(/[^\n]/g, '')
      i = end + 2
    } else {
      out += c
      i++
    }
  }
  return out
}

/**
 * Drop a comma that is followed (past whitespace) by `]` or `}`, outside strings.
 *
 * @param {string} text
 */
function stripTrailingCommas(text) {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '"') {
      const end = endOfString(text, i)
      out += text.slice(i, end)
      i = end
    } else if (c === ',' && /[\]}]/.test(text[i + 1 + countSpace(text, i + 1)] ?? '')) {
      i++
    } else {
      out += c
      i++
    }
  }
  return out
}

/**
 * @param {string} text
 * @param {number} from
 */
function countSpace(text, from) {
  let n = 0
  while (/\s/.test(text[from + n] ?? '')) n++
  return n
}

/**
 * The index just past the string that opens at `start`. An unterminated string runs to the end,
 * and `JSON.parse` then refuses it.
 *
 * @param {string} text
 * @param {number} start
 */
function endOfString(text, start) {
  let i = start + 1
  while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1
  return Math.min(i + 1, text.length)
}
