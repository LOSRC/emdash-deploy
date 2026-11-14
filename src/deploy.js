/**
 * The deploy order for one environment: branch guard, build, check the build, fingerprint,
 * redirect, dry run, then (unless `--dry-run`) migrate, deploy, check the migrations. Every check
 * comes before anything is migrated or uploaded, and every check can only refuse: nothing here
 * changes what is built or deployed. The processes are the site's own (`pnpm exec astro`,
 * `wrangler`, `emdash`), run through `run`, so a test can stand in for them.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DB_BINDING,
  checkBuild,
  checkDryRunOutput,
  checkFingerprint,
  checkOverrideName,
  checkRedirect,
} from './checks.js'
import { parseJsonc } from './jsonc.js'
import {
  PRODUCTION,
  environmentsOf,
  isRecord,
  resolveEnvironment,
  workerConfig,
} from './wrangler-config.js'

/** The site's Wrangler configuration, relative to the site's root. */
export const WRANGLER_CONFIG = 'wrangler.jsonc'
/** The configuration the Cloudflare adapter resolves for the build's environment. */
export const BUILT_CONFIG = join('dist', 'server', 'wrangler.json')
/** The adapter's redirect, which Wrangler follows when given no `--config`. */
export const REDIRECT = join('.wrangler', 'deploy', 'config.json')

export const USAGE = 'usage: emdash-deploy <production|env name> [--dry-run]'

/**
 * Runs one program and waits for it. `status` is its exit code, `null` when it did not run to an
 * exit (not found, killed by a signal); `error` is set when it could not be started.
 *
 * @callback Run
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd: string, env: Record<string, string | undefined> }} options
 * @returns {{ status: number | null, error?: Error }}
 */

/**
 * @typedef {object} DeployOptions
 * @property {string[]} argv The arguments after the command: `<env> [--dry-run]`.
 * @property {string} cwd The site's root.
 * @property {Record<string, string | undefined>} env The environment the deploy runs in.
 * @property {Run} run
 * @property {(line: string) => void} out Progress, one line per step.
 * @property {(line: string) => void} err Refusals and failures.
 * @property {string} [tmp] Where the dry run's output file goes (default: the OS's temp dir).
 */

/** A refusal: the deploy stops with exit code 1 and the lines say why. */
class Refusal extends Error {
  /**
   * @param {string} headline
   * @param {string[]} [problems]
   * @param {string} [prefix] What the first line starts with.
   * @param {string} [tail] What was and was not done, the last line.
   */
  constructor(
    headline,
    problems = [],
    prefix = 'Refusing to deploy',
    tail = 'Nothing was migrated or uploaded.',
  ) {
    super(headline)
    this.problems = problems
    this.prefix = prefix
    this.tail = tail
  }
}

/** Bad arguments or an environment `wrangler.jsonc` does not define: exit code 2. */
class UsageError extends Error {}

/**
 * Deploy, or with `--dry-run` check, one environment. Returns the exit code: 0 deployed (or
 * checked, or a branch build skipped), 1 refused or a step failed, 2 bad arguments or unknown
 * environment.
 *
 * @param {DeployOptions} options
 * @returns {number}
 */
export function deploy(options) {
  try {
    return deploySteps(options)
  } catch (error) {
    if (error instanceof UsageError) {
      options.err(error.message)
      options.err(USAGE)
      return 2
    }
    if (error instanceof Refusal) {
      options.err(`${error.prefix}: ${error.message}`)
      for (const problem of error.problems) options.err(`  - ${problem}`)
      options.err(error.tail)
      return 1
    }
    throw error
  }
}

/** @param {DeployOptions} options */
function deploySteps({ argv, cwd, env, run, out, tmp = tmpdir() }) {
  const { environment, dryRun } = parseArgs(argv)

  // 1. Branch guard. Workers Builds sets WORKERS_CI_BRANCH; only `main` deploys.
  const branch = env.WORKERS_CI_BRANCH
  if (branch !== undefined && branch !== 'main') {
    out(
      `Branch ${JSON.stringify(branch)} is not main: branch builds don't deploy to ${environment}. Nothing built, migrated or uploaded.`,
    )
    return 0
  }

  // 2. Environment. Read wrangler.jsonc for what this environment resolves to.
  const top = readWranglerConfig(cwd)
  if (!environmentsOf(top).includes(environment)) {
    throw new UsageError(
      `${WRANGLER_CONFIG} defines no environment ${JSON.stringify(environment)}; it has ${environmentsOf(top).join(', ')}`,
    )
  }
  /** @type {(env: string) => import('./wrangler-config.js').WorkerConfig} */
  const resolveFor = (name) => {
    try {
      return resolveEnvironment(top, name)
    } catch (error) {
      throw new UsageError(/** @type {Error} */ (error).message)
    }
  }
  const expected = resolveFor(environment)
  const production = resolveFor(PRODUCTION)
  /** @type {Record<string, string | undefined>} */
  const childEnv = { ...env }
  if (environment === PRODUCTION) delete childEnv.CLOUDFLARE_ENV
  else childEnv.CLOUDFLARE_ENV = environment
  out(
    environment === PRODUCTION
      ? `Deploying production (the top level of ${WRANGLER_CONFIG}) to the Worker ${expected.name}: CLOUDFLARE_ENV unset.`
      : `Deploying ${environment} (env.${environment} in ${WRANGLER_CONFIG}) to the Worker ${expected.name}: CLOUDFLARE_ENV=${environment}.`,
  )

  // 3. Build. A failed build must not leave an earlier build's configuration to be checked.
  const built = join(cwd, BUILT_CONFIG)
  const redirect = join(cwd, REDIRECT)
  rmSync(built, { force: true })
  rmSync(redirect, { force: true })
  out(`Building with astro build, after removing any earlier ${BUILT_CONFIG} and ${REDIRECT}.`)
  step(run, 'astro build', ['exec', 'astro', 'build'], cwd, childEnv)
  if (!existsSync(built)) throw new Refusal(`the build wrote no ${BUILT_CONFIG}`)

  // 4. Check the build against wrangler.jsonc, and the Worker Workers Builds deploys to.
  out(`Checking ${BUILT_CONFIG} against ${environment} in ${WRANGLER_CONFIG}.`)
  const build = workerConfig(readJson(built, BUILT_CONFIG))
  const buildProblems = [
    ...checkOverrideName(
      Object.hasOwn(env, 'WRANGLER_CI_OVERRIDE_NAME') ? env.WRANGLER_CI_OVERRIDE_NAME : undefined,
      environment,
      expected.name,
    ),
    ...checkBuild({ environment, build, expected, production }),
  ]
  if (buildProblems.length > 0) {
    throw new Refusal(`${BUILT_CONFIG} is not a ${environment} build.`, buildProblems)
  }

  // 5. Fingerprint: the account and D1 this deploy goes to are the ones recorded outside the repo.
  out('Checking EMDASH_TARGET_FINGERPRINT against the account and the D1 the build binds.')
  const fingerprint = checkFingerprint({
    build,
    envAccountId: env.CLOUDFLARE_ACCOUNT_ID,
    fingerprint: env.EMDASH_TARGET_FINGERPRINT,
  })
  if (!('fingerprint' in fingerprint)) {
    throw new Refusal('the migration target is not the one recorded.', fingerprint.problems)
  }
  out(
    `The target is account ${fingerprint.accountId}, D1 ${fingerprint.databaseId}: fingerprint ${fingerprint.fingerprint}.`,
  )

  // 6. Redirect: Wrangler, given no --config, must deploy the file just checked.
  out(`Checking that ${REDIRECT} points Wrangler at ${BUILT_CONFIG}.`)
  if (!existsSync(redirect)) throw new Refusal(`the build wrote no ${REDIRECT}`)
  const redirectProblems = checkRedirect(redirect, readFileSync(redirect, 'utf8'), built)
  if (redirectProblems.length > 0) {
    throw new Refusal('Wrangler would not deploy the checked build.', redirectProblems)
  }

  // 7. Dry run: the Worker Wrangler itself says it would deploy. No --config: with --config and
  // CLOUDFLARE_ENV, Wrangler appends the environment to a name that already has it.
  out('Checking the Worker wrangler deploy --dry-run would deploy.')
  const outputDir = mkdtempSync(join(tmp, 'emdash-deploy-'))
  try {
    const outputFile = join(outputDir, 'wrangler-output.json')
    step(run, 'wrangler deploy --dry-run', ['exec', 'wrangler', 'deploy', '--dry-run'], cwd, {
      ...childEnv,
      WRANGLER_OUTPUT_FILE_PATH: outputFile,
    })
    const output = existsSync(outputFile) ? readFileSync(outputFile, 'utf8') : ''
    const dryRunProblems = checkDryRunOutput(output, environment, expected.name)
    if (dryRunProblems.length > 0) {
      throw new Refusal('Wrangler would deploy another Worker.', dryRunProblems)
    }
  } finally {
    rmSync(outputDir, { recursive: true, force: true })
  }
  out(`Every check passed: this is a ${environment} build for the Worker ${expected.name}.`)

  // 8. --dry-run stops here.
  if (dryRun) {
    out('Dry run: nothing was migrated or uploaded.')
    return 0
  }

  // 9-11. Migrate the D1 the checked build binds (by id: EmDash refuses a binding with a
  // preview_database_id), deploy, then check no migration is pending.
  const selection = [
    '--wrangler-config',
    WRANGLER_CONFIG,
    ...(environment === PRODUCTION ? [] : ['--wrangler-env', environment]),
    '--d1',
    fingerprint.databaseId,
  ]
  out(`Applying EmDash's migrations to D1 ${fingerprint.databaseId} (emdash migrate).`)
  step(
    run,
    'emdash migrate',
    [
      'exec',
      'emdash',
      'migrate',
      ...selection,
      '--expected-target-fingerprint',
      fingerprint.fingerprint,
    ],
    cwd,
    childEnv,
    "Nothing was uploaded. emdash migrate's output above says what it applied, if anything.",
  )
  out(`Deploying the Worker ${expected.name} (wrangler deploy).`)
  step(
    run,
    'wrangler deploy',
    ['exec', 'wrangler', 'deploy'],
    cwd,
    childEnv,
    "EmDash's migrations were applied; wrangler deploy's output above says whether anything was uploaded.",
  )
  out('Checking no EmDash migration is pending (emdash migrate --check).')
  step(
    run,
    'emdash migrate --check',
    ['exec', 'emdash', 'migrate', ...selection, '--check'],
    cwd,
    childEnv,
    'The Worker was deployed, but emdash migrate --check did not pass: see its output above.',
  )
  out(`Deployed ${environment} to the Worker ${expected.name}.`)
  return 0
}

/**
 * @param {string[]} argv
 * @returns {{ environment: string, dryRun: boolean }}
 */
function parseArgs(argv) {
  const positional = argv.filter((arg) => !arg.startsWith('-'))
  const flags = argv.filter((arg) => arg.startsWith('-'))
  const unknown = flags.filter((flag) => flag !== '--dry-run')
  if (positional.length !== 1 || unknown.length > 0 || flags.length > 1) {
    throw new UsageError(
      unknown.length > 0 ? `unknown option ${unknown.join(' ')}` : 'name one environment',
    )
  }
  return { environment: /** @type {string} */ (positional[0]), dryRun: flags.length === 1 }
}

/**
 * @param {string} cwd
 * @returns {Record<string, unknown>}
 */
function readWranglerConfig(cwd) {
  const path = join(cwd, WRANGLER_CONFIG)
  /** @type {string} */
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new Refusal(`cannot read ${WRANGLER_CONFIG}: ${/** @type {Error} */ (error).message}`)
  }
  /** @type {unknown} */
  let parsed
  try {
    parsed = parseJsonc(text)
  } catch (error) {
    throw new Refusal(`${WRANGLER_CONFIG} is not valid JSONC: ${/** @type {Error} */ (error).message}`)
  }
  if (!isRecord(parsed)) throw new Refusal(`${WRANGLER_CONFIG} is not an object`)
  return parsed
}

/**
 * @param {string} path
 * @param {string} name
 * @returns {unknown}
 */
function readJson(path, name) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Refusal(`cannot read ${name}: ${/** @type {Error} */ (error).message}`)
  }
}

/**
 * Run one step through `pnpm`, and stop the deploy unless it exits 0.
 *
 * @param {Run} run
 * @param {string} what
 * @param {string[]} args
 * @param {string} cwd
 * @param {Record<string, string | undefined>} env
 * @param {string} [tail] What was and was not done when this step fails; by default nothing was
 *   migrated or uploaded.
 */
function step(run, what, args, cwd, env, tail) {
  const result = run('pnpm', args, { cwd, env })
  if (result.error === undefined && result.status === 0) return
  const why = result.error
    ? `could not run: ${result.error.message}`
    : result.status === null
      ? 'stopped without an exit code'
      : `exited ${result.status}`
  if (tail === undefined) throw new Refusal(`${what} failed (${why}).`)
  throw new Refusal(`${what} failed (${why}).`, [], 'Deploy failed', tail)
}
