import { describe, expect, it } from 'vitest'

import { parseJsonc } from '../src/jsonc.js'
import { environmentsOf, resolveEnvironment, sectionFor } from '../src/wrangler-config.js'
import { christophergoddardJsonc, creativeCareJsonc, ids, losrcJsonc } from './fixtures.js'

const top = (/** @type {string} */ text) => /** @type {Record<string, unknown>} */ (parseJsonc(text))

describe('environmentsOf', () => {
  it('is production plus every env', () => {
    expect(environmentsOf(top(christophergoddardJsonc))).toEqual(['production', 'staging'])
    expect(environmentsOf(top(creativeCareJsonc))).toEqual(['production', 'preview', 'staging'])
    expect(environmentsOf(top(losrcJsonc))).toEqual(['production'])
  })
})

describe('resolveEnvironment', () => {
  it('reads production from the top level', () => {
    const production = resolveEnvironment(top(christophergoddardJsonc), 'production')
    expect(production).toMatchObject({
      name: 'christophergoddard',
      account_id: ids.cg.productionAccount,
      workers_dev: false,
      routes: [{ pattern: 'christophergoddard.net', custom_domain: true }],
    })
    expect(production.d1_databases[0]?.database_id).toBe(ids.cg.productionD1)
  })

  it("keeps an env's own account, workers_dev and empty routes", () => {
    expect(resolveEnvironment(top(christophergoddardJsonc), 'staging')).toMatchObject({
      name: 'christophergoddard-staging',
      account_id: ids.cg.stagingAccount,
      workers_dev: true,
      routes: [],
    })
  })

  it('inherits account_id, workers_dev and routes, as Wrangler does', () => {
    const resolved = resolveEnvironment(
      {
        name: 'site',
        account_id: 'acc',
        workers_dev: false,
        route: 'example.com/*',
        routes: [{ pattern: 'example.com', custom_domain: true }],
        env: { staging: {} },
      },
      'staging',
    )
    expect(resolved).toMatchObject({ account_id: 'acc', workers_dev: false })
    expect(resolved.routes).toEqual(['example.com/*', { pattern: 'example.com', custom_domain: true }])
  })

  it('names an env with no name of its own <top>-<env>', () => {
    expect(resolveEnvironment({ name: 'site', env: { staging: {} } }, 'staging').name).toBe(
      'site-staging',
    )
    expect(resolveEnvironment({ env: { staging: {} } }, 'staging').name).toBeUndefined()
  })

  it('does not inherit bindings or vars', () => {
    const resolved = resolveEnvironment(
      {
        name: 'site',
        d1_databases: [{ binding: 'DB', database_id: 'x' }],
        kv_namespaces: [{ binding: 'SESSION', id: 'y' }],
        r2_buckets: [{ binding: 'MEDIA', bucket_name: 'z' }],
        vars: { A: '1' },
        env: { staging: {} },
      },
      'staging',
    )
    expect(resolved.d1_databases).toEqual([])
    expect(resolved.kv_namespaces).toEqual([])
    expect(resolved.r2_buckets).toEqual([])
    expect(sectionFor({ vars: { A: '1' }, env: { staging: {} } }, 'staging').vars).toBeUndefined()
  })

  it("reads each of Creative Care's three environments", () => {
    const cc = top(creativeCareJsonc)
    expect(resolveEnvironment(cc, 'production').name).toBe('creativecareltd')
    expect(resolveEnvironment(cc, 'preview')).toMatchObject({
      name: 'creativecareltd-preview',
      account_id: ids.cc.account,
      workers_dev: true,
      routes: [],
    })
    expect(resolveEnvironment(cc, 'staging').d1_databases[0]?.database_id).toBe(ids.cc.stagingD1)
  })

  it('refuses an env that is not defined, and an env named production', () => {
    expect(() => resolveEnvironment(top(losrcJsonc), 'staging')).toThrow('no env.staging')
    expect(() => resolveEnvironment({ env: { production: {} } }, 'production')).toThrow(
      'reserves',
    )
  })
})
