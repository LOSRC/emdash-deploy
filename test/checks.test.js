import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  checkBuild,
  checkDryRunOutput,
  checkFingerprint,
  checkOverrideName,
  checkRedirect,
  deployAccount,
  targetFingerprint,
} from '../src/checks.js'
import { parseJsonc } from '../src/jsonc.js'
import { resolveEnvironment, workerConfig } from '../src/wrangler-config.js'
import {
  ccBuild,
  cgBadBuild,
  cgProductionBuild,
  cgStagingBuild,
  christophergoddardJsonc,
  creativeCareJsonc,
  fingerprints,
  ids,
  losrcBuild,
  losrcJsonc,
} from './fixtures.js'

/**
 * @param {string} jsonc
 * @param {string} environment
 * @param {unknown} build
 */
function check(jsonc, environment, build) {
  const top = /** @type {Record<string, unknown>} */ (parseJsonc(jsonc))
  return checkBuild({
    environment,
    build: workerConfig(build),
    expected: resolveEnvironment(top, environment),
    production: resolveEnvironment(top, 'production'),
  })
}

/**
 * Change the top level or one env of a wrangler.jsonc.
 *
 * @param {string} jsonc
 * @param {(top: any) => void} change
 */
function edit(jsonc, change) {
  const top = /** @type {any} */ (parseJsonc(jsonc))
  change(top)
  return JSON.stringify(top)
}

/** @param {unknown} value */
const clone = (value) => JSON.parse(JSON.stringify(value))

describe('checkBuild: christophergoddard', () => {
  it('accepts its production build for production and its staging build for staging', () => {
    expect(check(christophergoddardJsonc, 'production', cgProductionBuild)).toEqual([])
    expect(check(christophergoddardJsonc, 'staging', cgStagingBuild)).toEqual([])
  })

  it('refuses the 2026-11-04 build checked as staging', () => {
    const problems = check(christophergoddardJsonc, 'staging', cgBadBuild).join('\n')
    expect(problems).toContain(`the build's Worker is "christophergoddard"`)
    expect(problems).toContain('Wrangler environment not set; staging needs "staging"')
    expect(problems).toContain(`the build's workers_dev is false`)
    expect(problems).toContain('staging must have workers_dev true')
    expect(problems).toContain(`D1 "DB" has no database_id`)
    expect(problems).toContain(`KV "SESSION" has no id`)
    expect(problems).toContain(`R2 "MEDIA": the build's bucket_name is "christophergoddard-media"`)
    expect(problems).toContain('staging shares the Worker "christophergoddard" with production')
    expect(problems).toContain(
      'staging shares the R2 bucket "christophergoddard-media" with production',
    )
  })

  it('refuses the 2026-11-04 build checked as production: it has no ids', () => {
    const problems = check(christophergoddardJsonc, 'production', cgBadBuild).join('\n')
    expect(problems).toContain(`D1 "DB" has no database_id`)
    expect(problems).toContain(`KV "SESSION" has no id`)
  })

  it('refuses a staging build checked as production, and the reverse', () => {
    expect(check(christophergoddardJsonc, 'production', cgStagingBuild)).not.toEqual([])
    expect(check(christophergoddardJsonc, 'staging', cgProductionBuild)).not.toEqual([])
  })

  it('refuses production made public at workers.dev by the build', () => {
    expect(
      check(christophergoddardJsonc, 'production', { ...cgProductionBuild, workers_dev: true }),
    ).toEqual([`the build's workers_dev is true; wrangler.jsonc gives production false`])
  })

  it('refuses a binding whose id differs from wrangler.jsonc', () => {
    const build = clone(cgStagingBuild)
    build.kv_namespaces[0].id = 'eeeeeeeeeeeeeeeeeeeeeeeeeeee0009'
    expect(check(christophergoddardJsonc, 'staging', build)).toEqual([
      `KV "SESSION": the build's id is "eeeeeeeeeeeeeeeeeeeeeeeeeeee0009", wrangler.jsonc's "${ids.cg.stagingKv}"`,
    ])
  })

  it('refuses a binding on one side only', () => {
    const extra = clone(cgStagingBuild)
    extra.d1_databases.push({ binding: 'OTHER', database_name: 'x', database_id: ids.cg.stagingD1 })
    expect(check(christophergoddardJsonc, 'staging', extra).join('\n')).toContain(
      `D1 "OTHER": the build has 1 and wrangler.jsonc 0`,
    )
    const missing = clone(cgStagingBuild)
    missing.r2_buckets = []
    expect(check(christophergoddardJsonc, 'staging', missing)).toEqual([
      `R2 "MEDIA": the build has 0 and wrangler.jsonc 1`,
    ])
  })

  it('refuses an account_id the build does not share with wrangler.jsonc', () => {
    expect(
      check(christophergoddardJsonc, 'staging', {
        ...cgStagingBuild,
        account_id: ids.cg.productionAccount,
      }),
    ).toEqual([
      `the build's account_id is "${ids.cg.productionAccount}"; wrangler.jsonc gives staging "${ids.cg.stagingAccount}"`,
    ])
  })

  it('refuses staging that inherits the Custom Domain because it has no routes of its own', () => {
    const jsonc = edit(christophergoddardJsonc, (top) => {
      delete top.env.staging.routes
    })
    expect(check(jsonc, 'staging', cgStagingBuild).join('\n')).toContain(
      'staging must have no routes',
    )
  })

  it("accepts staging's own routes: [] under a top-level route, which Wrangler deploys as none", () => {
    const jsonc = edit(christophergoddardJsonc, (top) => {
      delete top.routes
      top.route = 'christophergoddard.net/*'
    })
    expect(check(jsonc, 'staging', cgStagingBuild)).toEqual([])
  })

  it('refuses staging that inherits a top-level route', () => {
    const jsonc = edit(christophergoddardJsonc, (top) => {
      delete top.routes
      delete top.env.staging.routes
      top.route = 'christophergoddard.net/*'
    })
    expect(check(jsonc, 'staging', cgStagingBuild).join('\n')).toContain(
      'staging must have no routes',
    )
  })

  it('refuses an R2 with no bucket_name, which Wrangler would create', () => {
    const jsonc = edit(christophergoddardJsonc, (top) => {
      delete top.env.staging.r2_buckets[0].bucket_name
    })
    const build = clone(cgStagingBuild)
    delete build.r2_buckets[0].bucket_name
    expect(check(jsonc, 'staging', build)).toEqual([
      'R2 "MEDIA" has no bucket_name, so Wrangler would create a new, empty bucket',
    ])
  })

  it('refuses staging that shares a D1, KV or R2 with production', () => {
    const jsonc = edit(christophergoddardJsonc, (top) => {
      top.env.staging.d1_databases[0].database_id = ids.cg.productionD1
      top.env.staging.kv_namespaces[0].id = ids.cg.productionKv
      top.env.staging.r2_buckets[0].bucket_name = 'christophergoddard-media'
    })
    const build = clone(cgStagingBuild)
    build.d1_databases[0].database_id = ids.cg.productionD1
    build.kv_namespaces[0].id = ids.cg.productionKv
    build.r2_buckets[0].bucket_name = 'christophergoddard-media'
    expect(check(jsonc, 'staging', build)).toEqual([
      `staging shares the D1 database id "${ids.cg.productionD1}" with production`,
      `staging shares the KV namespace id "${ids.cg.productionKv}" with production`,
      'staging shares the R2 bucket "christophergoddard-media" with production',
    ])
  })
})

describe("checkBuild: Creative Care's three environments", () => {
  it('accepts each build for its own environment', () => {
    for (const environment of /** @type {const} */ (['production', 'preview', 'staging'])) {
      expect(check(creativeCareJsonc, environment, ccBuild(environment))).toEqual([])
    }
  })

  it('refuses each build for any other environment', () => {
    expect(check(creativeCareJsonc, 'staging', ccBuild('preview'))).not.toEqual([])
    expect(check(creativeCareJsonc, 'preview', ccBuild('staging'))).not.toEqual([])
    expect(check(creativeCareJsonc, 'production', ccBuild('preview'))).not.toEqual([])
    expect(check(creativeCareJsonc, 'preview', ccBuild('production'))).not.toEqual([])
  })

  it('refuses preview with workers_dev off', () => {
    const jsonc = edit(creativeCareJsonc, (top) => {
      top.env.preview.workers_dev = false
    })
    expect(check(jsonc, 'preview', { ...ccBuild('preview'), workers_dev: false })).toEqual([
      'preview must have workers_dev true (it lives on its workers.dev address); the build has false',
    ])
  })

  it("refuses an env that inherits production's workers_dev: false", () => {
    const jsonc = edit(creativeCareJsonc, (top) => {
      delete top.env.staging.workers_dev
    })
    expect(check(jsonc, 'staging', { ...ccBuild('staging'), workers_dev: false })).toEqual([
      'staging must have workers_dev true (it lives on its workers.dev address); the build has false',
    ])
  })
})

describe('checkBuild: losrc (no account, no D1 id, no KV, no env)', () => {
  it('refuses production: the D1 and the adapter-added SESSION KV have no ids', () => {
    expect(check(losrcJsonc, 'production', losrcBuild)).toEqual([
      'D1 "DB" has no database_id, so Wrangler would create a new, empty database',
      'KV "SESSION" has no id, so Wrangler would create a new, empty namespace',
      'KV "SESSION": the build has 1 and wrangler.jsonc 0 (the Cloudflare adapter adds a KV for Astro sessions when wrangler.jsonc has none: give it one with its id)',
    ])
  })

  it('accepts production once wrangler.jsonc has the ids and the SESSION KV', () => {
    const jsonc = edit(losrcJsonc, (top) => {
      top.d1_databases[0].database_id = '66666666-6666-4666-8666-666666660001'
      top.kv_namespaces = [{ binding: 'SESSION', id: 'ffffffffffffffffffffffffffff0001' }]
    })
    const build = clone(losrcBuild)
    build.d1_databases[0].database_id = '66666666-6666-4666-8666-666666660001'
    build.kv_namespaces = [{ binding: 'SESSION', id: 'ffffffffffffffffffffffffffff0001' }]
    expect(check(jsonc, 'production', build)).toEqual([])
  })

  it('refuses a build with no DB binding', () => {
    expect(
      check(losrcJsonc, 'production', { ...losrcBuild, d1_databases: [] }).join('\n'),
    ).toContain('the build has no D1 binding DB')
  })
})

describe('checkOverrideName', () => {
  it('accepts no override, or the Worker being deployed', () => {
    expect(checkOverrideName(undefined, 'staging', 'christophergoddard-staging')).toEqual([])
    expect(
      checkOverrideName('christophergoddard-staging', 'staging', 'christophergoddard-staging'),
    ).toEqual([])
  })

  it('refuses a production deploy aimed at the staging Worker (2026-11-04)', () => {
    expect(
      checkOverrideName('christophergoddard-staging', 'production', 'christophergoddard'),
    ).toEqual([
      'WRANGLER_CI_OVERRIDE_NAME is "christophergoddard-staging", so Wrangler would deploy to that Worker; production deploys "christophergoddard"',
    ])
  })

  it('refuses an empty value: Wrangler treats it as set', () => {
    expect(checkOverrideName('', 'staging', 'christophergoddard-staging')).toHaveLength(1)
  })
})

describe('targetFingerprint', () => {
  it("is EmDash's: sha256 of the d1 identity, ids lower-cased", () => {
    const account = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa0001'
    const database = '11111111-1111-4111-8111-111111110001'
    const expected = createHash('sha256')
      .update(`{"kind":"d1","identity":["${account}","${database}"]}`)
      .digest('hex')
    expect(targetFingerprint(account, database)).toBe(expected)
    expect(targetFingerprint(account.toUpperCase(), database.toUpperCase())).toBe(expected)
  })
})

describe('deployAccount', () => {
  const account = ids.cg.stagingAccount
  it("takes the build's account_id, else CLOUDFLARE_ACCOUNT_ID", () => {
    expect(deployAccount(account, undefined).accountId).toBe(account)
    expect(deployAccount(undefined, account).accountId).toBe(account)
    expect(deployAccount(account, account.toUpperCase()).accountId).toBe(account)
  })

  it('refuses both set and different, neither set, or not an account id', () => {
    expect(deployAccount(account, ids.cg.productionAccount).problems[0]).toContain(
      'but CLOUDFLARE_ACCOUNT_ID is',
    )
    expect(deployAccount(undefined, undefined).problems[0]).toContain('no account')
    expect(deployAccount(undefined, '').problems[0]).toContain('no account')
    expect(deployAccount('acc', undefined).problems[0]).toContain('not a Cloudflare account id')
  })
})

describe('checkFingerprint', () => {
  const build = workerConfig(cgStagingBuild)

  it('accepts the fingerprint of the account and the D1 the build binds', () => {
    expect(
      checkFingerprint({ build, envAccountId: undefined, fingerprint: fingerprints.cgStaging }),
    ).toEqual({
      fingerprint: fingerprints.cgStaging,
      accountId: ids.cg.stagingAccount,
      databaseId: ids.cg.stagingD1,
      problems: [],
    })
  })

  it('refuses when EMDASH_TARGET_FINGERPRINT is unset or empty', () => {
    for (const fingerprint of [undefined, '', '  ']) {
      const result = checkFingerprint({ build, envAccountId: undefined, fingerprint })
      expect(result.problems[0]).toContain('EMDASH_TARGET_FINGERPRINT is not set')
    }
  })

  it("refuses production's fingerprint for a staging build, and a changed D1", () => {
    expect(
      checkFingerprint({ build, envAccountId: undefined, fingerprint: fingerprints.cgProduction })
        .problems[0],
    ).toContain(`whose fingerprint is "${fingerprints.cgStaging}"`)
    const moved = clone(cgStagingBuild)
    moved.d1_databases[0].database_id = '77777777-7777-4777-8777-777777770001'
    expect(
      checkFingerprint({
        build: workerConfig(moved),
        envAccountId: undefined,
        fingerprint: fingerprints.cgStaging,
      }).problems,
    ).toHaveLength(1)
  })

  it('uses CLOUDFLARE_ACCOUNT_ID when the build has no account_id, and refuses a conflict', () => {
    const noAccount = workerConfig({ ...cgStagingBuild, account_id: undefined })
    expect(
      checkFingerprint({
        build: noAccount,
        envAccountId: ids.cg.stagingAccount,
        fingerprint: fingerprints.cgStaging,
      }).problems,
    ).toEqual([])
    expect(
      checkFingerprint({
        build: noAccount,
        envAccountId: undefined,
        fingerprint: fingerprints.cgStaging,
      }).problems[0],
    ).toContain('no account')
    expect(
      checkFingerprint({
        build,
        envAccountId: ids.cg.productionAccount,
        fingerprint: fingerprints.cgStaging,
      }).problems[0],
    ).toContain('but CLOUDFLARE_ACCOUNT_ID is')
  })

  it('refuses a build whose DB has no valid database_id', () => {
    expect(
      checkFingerprint({
        build: workerConfig(cgBadBuild),
        envAccountId: undefined,
        fingerprint: fingerprints.cgProduction,
      }).problems[0],
    ).toContain('has no valid database_id')
  })
})

describe('checkRedirect', () => {
  const redirect = '/site/.wrangler/deploy/config.json'
  const built = '/site/dist/server/wrangler.json'

  it("accepts the adapter's redirect to the build", () => {
    expect(
      checkRedirect(
        redirect,
        '{"configPath":"../../dist/server/wrangler.json","auxiliaryWorkers":[]}',
        built,
      ),
    ).toEqual([])
  })

  it('refuses a redirect elsewhere, none, or not JSON', () => {
    expect(checkRedirect(redirect, '{"configPath":"../../wrangler.jsonc"}', built)[0]).toContain(
      'points Wrangler at ../../wrangler.jsonc',
    )
    expect(checkRedirect(redirect, '{}', built)[0]).toContain('has no configPath')
    expect(checkRedirect(redirect, 'nope', built)[0]).toContain('is not JSON')
  })
})

describe('checkDryRunOutput', () => {
  /** @param {Record<string, unknown>[]} entries */
  const lines = (...entries) => entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
  const start = { version: 1, type: 'wrangler-session', wrangler_version: '4.147.0' }

  it("accepts Wrangler's deploy entry naming the Worker", () => {
    expect(
      checkDryRunOutput(
        lines(start, {
          type: 'deploy',
          version: 1,
          worker_name: 'christophergoddard-staging',
          wrangler_environment: 'staging',
          worker_name_overridden: false,
        }),
        'staging',
        'christophergoddard-staging',
      ),
    ).toEqual([])
  })

  it('refuses the doubled environment name --config would give', () => {
    expect(
      checkDryRunOutput(
        lines(start, { type: 'deploy', worker_name: 'christophergoddard-staging-staging' }),
        'staging',
        'christophergoddard-staging',
      ),
    ).toEqual([
      'wrangler deploy would deploy the Worker "christophergoddard-staging-staging"; staging deploys "christophergoddard-staging"',
    ])
  })

  it('refuses no deploy entry, two, or one with no name', () => {
    expect(checkDryRunOutput(lines(start), 'staging', 'x')[0]).toContain('0 deploy entries')
    expect(checkDryRunOutput('', 'staging', 'x')[0]).toContain('0 deploy entries')
    expect(
      checkDryRunOutput(
        lines({ type: 'deploy', worker_name: 'x' }, { type: 'deploy', worker_name: 'x' }),
        'staging',
        'x',
      )[0],
    ).toContain('2 deploy entries')
    expect(
      checkDryRunOutput(lines({ type: 'deploy', worker_name: null }), 'staging', 'x')[0],
    ).toContain('did not report the Worker')
  })
})
