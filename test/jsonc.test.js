import { describe, expect, it } from 'vitest'

import { parseJsonc } from '../src/jsonc.js'
import { christophergoddardJsonc, creativeCareJsonc, losrcJsonc } from './fixtures.js'

describe('parseJsonc', () => {
  it('reads line and block comments and trailing commas', () => {
    expect(parseJsonc('{\n  // a\n  "a": [1, 2,], /* b */ "b": { "c": 3, },\n}')).toEqual({
      a: [1, 2],
      b: { c: 3 },
    })
  })

  it('leaves comment markers and commas inside strings alone', () => {
    expect(
      parseJsonc('{ "url": "https://x.example//y", "s": "/* no */", "t": ",}", "q": "a\\"//b" }'),
    ).toEqual({ url: 'https://x.example//y', s: '/* no */', t: ',}', q: 'a"//b' })
  })

  it("reads the three sites' wrangler.jsonc, losrc's tabs too", () => {
    const cg = /** @type {any} */ (parseJsonc(christophergoddardJsonc))
    expect(cg.vars.SHOP_URL).toBe('https://shop.example.com//path')
    expect(Object.keys(cg.env)).toEqual(['staging'])
    expect(Object.keys(/** @type {any} */ (parseJsonc(creativeCareJsonc)).env)).toEqual([
      'preview',
      'staging',
    ])
    expect(/** @type {any} */ (parseJsonc(losrcJsonc)).name).toBe('losrc')
  })

  it('refuses what is not JSONC', () => {
    expect(() => parseJsonc('{ "a": 1 /* open')).toThrow(SyntaxError)
    expect(() => parseJsonc('{ a: 1 }')).toThrow(SyntaxError)
    expect(() => parseJsonc('{ "a": "unterminated }')).toThrow(SyntaxError)
  })
})
