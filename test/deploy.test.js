import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { deploy } from '../src/deploy.js'
import {
  cgBadBuild,
  cgProductionBuild,
  cgStagingBuild,
  christophergoddardJsonc,
  fingerprints,
  ids,
  losrcBuild,
  losrcJsonc,
} from './fixtures.js'

/**
 * @typedef {object} Call
 * @property {string} command
 * @property {string[]} args
 * @property {Record<string, string | undefined>} env
 */

/**
 * @typedef {object} FakeOptions
 * @property {unknown} [build] What `astro build` writes as dist/server/wrangler.json; undefined
 *   writes nothing.
 * @property {string} [redirect] What it writes as .wrangler/deploy/config.json.
 * @property {(env: Record<string, string | undefined>) => string | undefined} [dryRunName] The
 *   Worker the dry run reports; by default the build's name.
 * @property {Partial<Record<string, number | null>>} [status] Exit status by step key.
 */

let site = ''
let tmp = ''

beforeEach(() => {
  site = mkdtempSync(join(tmpdir(), 'emdash-deploy-site-'))
  tmp = mkdtempSync(join(tmpdir(), 'emdash-deploy-tmp-'))
})

afterEach(() => {
  rmSync(site, { recursive: true, force: true })
  rmSync(tmp, { recursive: true, force: true })
})

/** @param {string[]} args */
function key(args) {
  return args.slice(1).join(' ')
}

/**
 * Run `deploy` in a temporary site against fake processes, recording every call.
 *
 * @param {object} input
 * @param {string[]} input.argv
 * @param {string} [input.jsonc]
 * @param {Record<string, string | undefined>} [input.env]
 * @param {FakeOptions} [input.fake]
 */
function run({ argv, jsonc = christophergoddardJsonc, env = {}, fake = {} }) {
  writeFileSync(join(site, 'wrangler.jsonc'), jsonc)
  /** @type {Call[]} */
  const calls = []
  /** @type {string[]} */
  const out = []
  /** @type {string[]} */
  const err = []
  const code = deploy({
    argv,
    cwd: site,
    env,
    tmp,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    run: (command, args, options) => {
      expect(options.cwd).toBe(site)
      calls.push({ command, args, env: { ...options.env } })
      const k = key(args)
      const status = fake.status?.[k]
      if (k === 'astro build' && fake.build !== undefined) {
        mkdirSync(join(site, 'dist', 'server'), { recursive: true })
        writeFileSync(join(site, 'dist', 'server', 'wrangler.json'), JSON.stringify(fake.build))
        mkdirSync(join(site, '.wrangler', 'deploy'), { recursive: true })
        writeFileSync(
          join(site, '.wrangler', 'deploy', 'config.json'),
          fake.redirect ?? '{"configPath":"../../dist/server/wrangler.json","auxiliaryWorkers":[]}',
        )
      }
      if (k === 'wrangler deploy --dry-run') {
        const file = options.env.WRANGLER_OUTPUT_FILE_PATH
        const name = fake.dryRunName
          ? fake.dryRunName(options.env)
          : /** @type {any} */ (fake.build)?.name
        if (file) {
          writeFileSync(
            file,
            `${JSON.stringify({ type: 'wrangler-session', version: 1 })}\n${JSON.stringify({ type: 'deploy', version: 1, worker_name: name })}\n`,
          )
        }
      }
      return { status: status === undefined ? 0 : status }
    },
  })
  return { code, calls, out, err, steps: calls.map((call) => key(call.args)) }
}

const stagingEnv = {
  WORKERS_CI_BRANCH: 'main',
  WRANGLER_CI_OVERRIDE_NAME: 'christophergoddard-staging',
  EMDASH_TARGET_FINGERPRINT: fingerprints.cgStaging,
  CLOUDFLARE_ACCOUNT_ID: ids.cg.stagingAccount,
  CLOUDFLARE_API_TOKEN: 'token',
}

const productionEnv = {
  WORKERS_CI_BRANCH: 'main',
  WRANGLER_CI_OVERRIDE_NAME: 'christophergoddard',
  EMDASH_TARGET_FINGERPRINT: fingerprints.cgProduction,
  CLOUDFLARE_API_TOKEN: 'token',
}

const MIGRATE_OR_UPLOAD = ['emdash migrate', 'wrangler deploy']

/** @param {string[]} steps */
function migratedOrUploaded(steps) {
  return steps.filter((step) => MIGRATE_OR_UPLOAD.some((prefix) => step.startsWith(prefix)) && step !== 'wrangler deploy --dry-run')
}

describe('a full deploy', () => {
  it('runs every step in order with the exact arguments, for staging', () => {
    const { code, calls, err } = run({ argv: ['staging'], env: stagingEnv, fake: { build: cgStagingBuild } })
    expect(err).toEqual([])
    expect(code).toBe(0)
    expect(calls.map((call) => [call.command, ...call.args])).toEqual([
      ['pnpm', 'exec', 'astro', 'build'],
      ['pnpm', 'exec', 'wrangler', 'deploy', '--dry-run'],
      [
        'pnpm', 'exec', 'emdash', 'migrate',
        '--wrangler-config', 'wrangler.jsonc', '--wrangler-env', 'staging',
        '--d1', ids.cg.stagingD1,
        '--expected-target-fingerprint', fingerprints.cgStaging,
      ],
      ['pnpm', 'exec', 'wrangler', 'deploy'],
      [
        'pnpm', 'exec', 'emdash', 'migrate',
        '--wrangler-config', 'wrangler.jsonc', '--wrangler-env', 'staging',
        '--d1', ids.cg.stagingD1,
        '--check',
      ],
    ])
    for (const call of calls) expect(call.env.CLOUDFLARE_ENV).toBe('staging')
    expect(calls[1]?.env.WRANGLER_OUTPUT_FILE_PATH).toMatch(/emdash-deploy-/)
    for (const call of [calls[0], ...calls.slice(2)]) {
      expect(call?.env.WRANGLER_OUTPUT_FILE_PATH).toBeUndefined()
    }
    // The dry run's output directory is removed.
    expect(readdirSync(tmp)).toEqual([])
  })

  it('runs production with CLOUDFLARE_ENV removed and no --wrangler-env', () => {
    const { code, calls } = run({
      argv: ['production'],
      env: { ...productionEnv, CLOUDFLARE_ENV: 'staging' },
      fake: { build: cgProductionBuild },
    })
    expect(code).toBe(0)
    for (const call of calls) expect(Object.hasOwn(call.env, 'CLOUDFLARE_ENV')).toBe(false)
    expect(calls[2]?.args).toEqual([
      'exec', 'emdash', 'migrate',
      '--wrangler-config', 'wrangler.jsonc',
      '--d1', ids.cg.productionD1,
      '--expected-target-fingerprint', fingerprints.cgProduction,
    ])
  })

  it('never passes --config, --env or --name to wrangler', () => {
    const { calls } = run({ argv: ['staging'], env: stagingEnv, fake: { build: cgStagingBuild } })
    for (const call of calls.filter((c) => c.args[1] === 'wrangler')) {
      expect(call.args.filter((arg) => /^--(config|env|name)\b|^-[ce]$/.test(arg))).toEqual([])
    }
  })

  it('removes an earlier build before building', () => {
    mkdirSync(join(site, 'dist', 'server'), { recursive: true })
    writeFileSync(join(site, 'dist', 'server', 'wrangler.json'), JSON.stringify(cgStagingBuild))
    mkdirSync(join(site, '.wrangler', 'deploy'), { recursive: true })
    writeFileSync(join(site, '.wrangler', 'deploy', 'config.json'), '{}')
    const { code, steps, err } = run({ argv: ['staging'], env: stagingEnv, fake: {} })
    expect(code).toBe(1)
    expect(steps).toEqual(['astro build'])
    expect(err[0]).toContain('the build wrote no dist/server/wrangler.json')
    expect(existsSync(join(site, '.wrangler', 'deploy', 'config.json'))).toBe(false)
  })
})

describe('--dry-run', () => {
  it('builds and checks, and never migrates or uploads', () => {
    const { code, steps, out } = run({
      argv: ['staging', '--dry-run'],
      env: stagingEnv,
      fake: { build: cgStagingBuild },
    })
    expect(code).toBe(0)
    expect(steps).toEqual(['astro build', 'wrangler deploy --dry-run'])
    expect(out.at(-1)).toBe('Dry run: nothing was migrated or uploaded.')
  })

  it('takes the flag before the environment too', () => {
    const { code, steps } = run({
      argv: ['--dry-run', 'staging'],
      env: stagingEnv,
      fake: { build: cgStagingBuild },
    })
    expect(code).toBe(0)
    expect(migratedOrUploaded(steps)).toEqual([])
  })
})

describe('the branch guard', () => {
  it('exits 0 before building on a branch that is not main', () => {
    for (const branch of ['feature', '']) {
      const { code, steps, out } = run({
        argv: ['staging'],
        env: { ...stagingEnv, WORKERS_CI_BRANCH: branch },
        fake: { build: cgStagingBuild },
      })
      expect(code).toBe(0)
      expect(steps).toEqual([])
      expect(out[0]).toContain("branch builds don't deploy to staging")
    }
  })

  it('goes on when WORKERS_CI_BRANCH is unset (a deploy by hand)', () => {
    const { WORKERS_CI_BRANCH: _branch, ...env } = stagingEnv
    expect(run({ argv: ['staging'], env, fake: { build: cgStagingBuild } }).code).toBe(0)
  })
})

describe('arguments and environments', () => {
  it('exits 2, running nothing, for an unknown environment, option or no environment', () => {
    for (const argv of [['preview'], ['staging', '--force'], [], ['staging', 'production']]) {
      const { code, steps } = run({ argv, env: stagingEnv, fake: { build: cgStagingBuild } })
      expect(code).toBe(2)
      expect(steps).toEqual([])
    }
  })

  it('exits 2 for losrc staging: wrangler.jsonc has no env yet', () => {
    const { code, err } = run({ argv: ['staging'], jsonc: losrcJsonc, env: {}, fake: {} })
    expect(code).toBe(2)
    expect(err[0]).toBe('wrangler.jsonc defines no environment "staging"; it has production')
  })

  it('refuses losrc production today: no ids, no account', () => {
    const { code, steps, err } = run({
      argv: ['production', '--dry-run'],
      jsonc: losrcJsonc,
      env: { EMDASH_TARGET_FINGERPRINT: 'x' },
      fake: { build: losrcBuild },
    })
    expect(code).toBe(1)
    expect(steps).toEqual(['astro build'])
    expect(err.join('\n')).toContain('D1 "DB" has no database_id')
  })

  it('refuses a site with no wrangler.jsonc', () => {
    rmSync(join(site, 'wrangler.jsonc'), { force: true })
    /** @type {string[][]} */
    const calls = []
    const code = deploy({
      argv: ['production'],
      cwd: site,
      env: {},
      tmp,
      out: () => {},
      err: () => {},
      run: (command, args) => {
        calls.push([command, ...args])
        return { status: 0 }
      },
    })
    expect(code).toBe(1)
    expect(calls).toEqual([])
  })
})

describe('nothing migrates or uploads after a failed check', () => {
  /** @type {Array<[string, Parameters<typeof run>[0], string]>} */
  const cases = [
    [
      'the 2026-11-04 build deployed as staging',
      { argv: ['staging'], env: stagingEnv, fake: { build: cgBadBuild } },
      'is not a staging build',
    ],
    [
      'a production deploy aimed at the staging Worker (2026-11-04)',
      {
        argv: ['production'],
        env: { ...productionEnv, WRANGLER_CI_OVERRIDE_NAME: 'christophergoddard-staging' },
        fake: { build: cgProductionBuild },
      },
      'WRANGLER_CI_OVERRIDE_NAME is "christophergoddard-staging"',
    ],
    [
      'an empty WRANGLER_CI_OVERRIDE_NAME',
      {
        argv: ['staging'],
        env: { ...stagingEnv, WRANGLER_CI_OVERRIDE_NAME: '' },
        fake: { build: cgStagingBuild },
      },
      'WRANGLER_CI_OVERRIDE_NAME is ""',
    ],
    [
      'no EMDASH_TARGET_FINGERPRINT',
      {
        argv: ['staging'],
        env: { ...stagingEnv, EMDASH_TARGET_FINGERPRINT: undefined },
        fake: { build: cgStagingBuild },
      },
      'EMDASH_TARGET_FINGERPRINT is not set',
    ],
    [
      "production's fingerprint on staging",
      {
        argv: ['staging'],
        env: { ...stagingEnv, EMDASH_TARGET_FINGERPRINT: fingerprints.cgProduction },
        fake: { build: cgStagingBuild },
      },
      'EMDASH_TARGET_FINGERPRINT is',
    ],
    [
      'CLOUDFLARE_ACCOUNT_ID not the build account',
      {
        argv: ['staging'],
        env: { ...stagingEnv, CLOUDFLARE_ACCOUNT_ID: ids.cg.productionAccount },
        fake: { build: cgStagingBuild },
      },
      'but CLOUDFLARE_ACCOUNT_ID is',
    ],
    [
      'a redirect to wrangler.jsonc',
      {
        argv: ['staging'],
        env: stagingEnv,
        fake: { build: cgStagingBuild, redirect: '{"configPath":"../../wrangler.jsonc"}' },
      },
      'points Wrangler at ../../wrangler.jsonc',
    ],
    [
      'a dry run reporting the doubled name',
      {
        argv: ['staging'],
        env: stagingEnv,
        fake: { build: cgStagingBuild, dryRunName: () => 'christophergoddard-staging-staging' },
      },
      'would deploy the Worker "christophergoddard-staging-staging"',
    ],
    [
      'a dry run reporting nothing',
      {
        argv: ['staging'],
        env: stagingEnv,
        fake: { build: cgStagingBuild, dryRunName: () => undefined },
      },
      'did not report the Worker',
    ],
    [
      'a failed build',
      { argv: ['staging'], env: stagingEnv, fake: { build: cgStagingBuild, status: { 'astro build': 1 } } },
      'astro build failed (exited 1)',
    ],
    [
      'a build killed by a signal',
      { argv: ['staging'], env: stagingEnv, fake: { build: cgStagingBuild, status: { 'astro build': null } } },
      'astro build failed (stopped without an exit code)',
    ],
    [
      'a failed dry run',
      {
        argv: ['staging'],
        env: stagingEnv,
        fake: { build: cgStagingBuild, status: { 'wrangler deploy --dry-run': 1 } },
      },
      'wrangler deploy --dry-run failed',
    ],
  ]

  for (const [name, input, reason] of cases) {
    it(`refuses ${name}`, () => {
      const { code, steps, err } = run(input)
      expect(code).toBe(1)
      expect(migratedOrUploaded(steps)).toEqual([])
      expect(err.join('\n')).toContain(reason)
      expect(err.at(-1)).toBe('Nothing was migrated or uploaded.')
    })
  }

  it('refuses when pnpm cannot be started', () => {
    writeFileSync(join(site, 'wrangler.jsonc'), christophergoddardJsonc)
    /** @type {string[]} */
    const steps = []
    /** @type {string[]} */
    const err = []
    const code = deploy({
      argv: ['staging'],
      cwd: site,
      env: stagingEnv,
      tmp,
      out: () => {},
      err: (line) => err.push(line),
      run: (_command, args) => {
        steps.push(key(args))
        return { status: null, error: new Error('spawnSync pnpm ENOENT') }
      },
    })
    expect(code).toBe(1)
    expect(steps).toEqual(['astro build'])
    expect(err[0]).toContain('could not run: spawnSync pnpm ENOENT')
  })
})

describe('a step failing after the checks', () => {
  it('does not deploy when emdash migrate fails', () => {
    const migrate = `emdash migrate --wrangler-config wrangler.jsonc --wrangler-env staging --d1 ${ids.cg.stagingD1} --expected-target-fingerprint ${fingerprints.cgStaging}`
    const { code, steps, err } = run({
      argv: ['staging'],
      env: stagingEnv,
      fake: { build: cgStagingBuild, status: { [migrate]: 1 } },
    })
    expect(code).toBe(1)
    expect(steps).toEqual(['astro build', 'wrangler deploy --dry-run', migrate])
    expect(err[0]).toBe('Deploy failed: emdash migrate failed (exited 1).')
    expect(err.at(-1)).toContain('Nothing was uploaded.')
  })

  it('does not check migrations when wrangler deploy fails, and says they were applied', () => {
    const { code, steps, err } = run({
      argv: ['staging'],
      env: stagingEnv,
      fake: { build: cgStagingBuild, status: { 'wrangler deploy': 1 } },
    })
    expect(code).toBe(1)
    expect(steps.at(-1)).toBe('wrangler deploy')
    expect(err.at(-1)).toContain("EmDash's migrations were applied")
  })

  it('exits 1 when emdash migrate --check fails after the deploy', () => {
    const check = `emdash migrate --wrangler-config wrangler.jsonc --wrangler-env staging --d1 ${ids.cg.stagingD1} --check`
    const { code, err } = run({
      argv: ['staging'],
      env: stagingEnv,
      fake: { build: cgStagingBuild, status: { [check]: 1 } },
    })
    expect(code).toBe(1)
    expect(err.at(-1)).toContain('The Worker was deployed')
  })
})
