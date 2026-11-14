/**
 * The checks made before anything is migrated or uploaded. Each returns the reasons to refuse,
 * one line each, and an empty list when there are none. None of them changes anything: they read
 * what they are given and say what differs.
 */
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'

import { PRODUCTION } from './wrangler-config.js'

/** @typedef {import('./wrangler-config.js').WorkerConfig} WorkerConfig */

/** The D1 binding EmDash's database is bound as, and the one migrated. */
export const DB_BINDING = 'DB'

/**
 * Check a build (`dist/server/wrangler.json`, read with `workerConfig`) against what
 * `wrangler.jsonc` resolves to for `environment`.
 *
 * Refuses unless the Worker name, the Wrangler environment, `account_id`, `workers_dev` and
 * every D1, KV and R2 binding are the resolved ones; there is a `DB` D1 binding; every D1 has a
 * `database_id` and every KV an `id` (Wrangler creates a new, empty one for any that has none);
 * and, for any environment other than production, `workers_dev` is `true`, there are no routes,
 * and nothing (Worker, D1, KV, R2) is shared with production.
 *
 * @param {object} input
 * @param {string} input.environment `production` or a name under `env`.
 * @param {WorkerConfig} input.build The build's configuration.
 * @param {WorkerConfig} input.expected `wrangler.jsonc` resolved for `environment`.
 * @param {WorkerConfig} input.production `wrangler.jsonc` resolved for production (the top level).
 * @returns {string[]}
 */
export function checkBuild({ environment, build, expected, production }) {
  /** @type {string[]} */
  const problems = []
  const isProduction = environment === PRODUCTION

  if (expected.name === undefined) {
    problems.push(`wrangler.jsonc gives ${environment} no Worker name`)
  } else if (build.name !== expected.name) {
    problems.push(
      `the build's Worker is ${show(build.name)}; ${environment} deploys ${show(expected.name)}`,
    )
  }

  const targetEnvironment = isProduction ? undefined : environment
  if (build.targetEnvironment !== targetEnvironment) {
    problems.push(
      `the build was made for the Wrangler environment ${show(build.targetEnvironment)}; ${environment} needs ${show(targetEnvironment)}`,
    )
  }

  if (build.account_id !== expected.account_id) {
    problems.push(
      `the build's account_id is ${show(build.account_id)}; wrangler.jsonc gives ${environment} ${show(expected.account_id)}`,
    )
  }

  if (build.workers_dev !== expected.workers_dev) {
    problems.push(
      `the build's workers_dev is ${show(build.workers_dev)}; wrangler.jsonc gives ${environment} ${show(expected.workers_dev)}`,
    )
  }
  if (!isProduction) {
    if (build.workers_dev !== true || expected.workers_dev !== true) {
      problems.push(
        `${environment} must have workers_dev true (it lives on its workers.dev address); the build has ${show(build.workers_dev)}`,
      )
    }
    if (build.routes.length > 0 || expected.routes.length > 0) {
      problems.push(
        `${environment} must have no routes, so it cannot take production's domain; it has ${JSON.stringify(build.routes.length > 0 ? build.routes : expected.routes)}${expected.routes.length > 0 ? ' (an env without its own "routes" inherits the top level\'s)' : ''}`,
      )
    }
  }

  // Wrangler creates a D1 or KV that has no id when it deploys, and binds the Worker to it: a new,
  // empty database or namespace. That is what the 2026-11-04 deploy did.
  if (!build.d1_databases.some((entry) => entry.binding === DB_BINDING)) {
    problems.push(`the build has no D1 binding ${DB_BINDING}`)
  }
  for (const entry of build.d1_databases) {
    if (!entry.database_id) {
      problems.push(
        `D1 ${show(entry.binding)} has no database_id, so Wrangler would create a new, empty database`,
      )
    }
  }
  for (const entry of build.kv_namespaces) {
    if (!entry.id) {
      problems.push(
        `KV ${show(entry.binding)} has no id, so Wrangler would create a new, empty namespace`,
      )
    }
  }

  for (const entry of build.r2_buckets) {
    if (!entry.bucket_name) {
      problems.push(
        `R2 ${show(entry.binding)} has no bucket_name, so Wrangler would create a new, empty bucket`,
      )
    }
  }

  problems.push(
    ...compareBindings('D1', build.d1_databases, expected.d1_databases, [
      'database_id',
      'database_name',
    ]),
    ...compareBindings('KV', build.kv_namespaces, expected.kv_namespaces, ['id']),
    ...compareBindings('R2', build.r2_buckets, expected.r2_buckets, ['bucket_name']),
  )

  if (!isProduction) problems.push(...sharedWithProduction(environment, build, production))

  return problems
}

/**
 * Workers Builds deploys to the Worker it is connected to and passes its name as
 * `WRANGLER_CI_OVERRIDE_NAME`; Wrangler then deploys under that name whatever the configuration
 * says. Wrangler treats the variable as set whenever it is in the environment, empty too, so any
 * value that is not the environment's Worker is refused.
 *
 * @param {string | undefined} value The variable's value, `undefined` when it is not set.
 * @param {string} environment
 * @param {string | undefined} expectedName The resolved Worker name.
 * @returns {string[]}
 */
export function checkOverrideName(value, environment, expectedName) {
  if (value === undefined || value === expectedName) return []
  return [
    `WRANGLER_CI_OVERRIDE_NAME is ${show(value)}, so Wrangler would deploy to that Worker; ${environment} deploys ${show(expectedName)}`,
  ]
}

const ACCOUNT_ID = /^[a-f0-9]{32}$/i
const DATABASE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

/**
 * EmDash's migration target fingerprint for a D1 database: the SHA-256, in hex, of
 * `{"kind":"d1","identity":[<account id>,<database id>]}`, with both ids lower-cased as EmDash
 * does (`fingerprintTarget` and `canonical*Id` in `@emdash-cms/cloudflare`'s `d1-migrations`,
 * 1.3.1 to 1.5.0). Cradle's `targetFingerprint` is the same for lower-case ids.
 *
 * @param {string} accountId
 * @param {string} databaseId
 */
export function targetFingerprint(accountId, databaseId) {
  const identity = JSON.stringify({
    kind: 'd1',
    identity: [accountId.toLowerCase(), databaseId.toLowerCase()],
  })
  return createHash('sha256').update(identity).digest('hex')
}

/**
 * The account a deploy goes to: the build's `account_id`, else `CLOUDFLARE_ACCOUNT_ID`. Refused
 * when both are set and differ, when neither is, or when it is not an account id.
 *
 * @param {string | undefined} buildAccountId
 * @param {string | undefined} envAccountId `CLOUDFLARE_ACCOUNT_ID`.
 * @returns {{ accountId: string, problems: [] } | { accountId: undefined, problems: string[] }}
 */
export function deployAccount(buildAccountId, envAccountId) {
  const fromBuild = buildAccountId || undefined
  const fromEnv = envAccountId || undefined
  if (fromBuild && fromEnv && fromBuild.toLowerCase() !== fromEnv.toLowerCase()) {
    return {
      accountId: undefined,
      problems: [
        `the build's account_id is ${show(fromBuild)} but CLOUDFLARE_ACCOUNT_ID is ${show(fromEnv)}`,
      ],
    }
  }
  const accountId = fromBuild ?? fromEnv
  if (accountId === undefined) {
    return {
      accountId: undefined,
      problems: ['no account: the build has no account_id and CLOUDFLARE_ACCOUNT_ID is not set'],
    }
  }
  if (!ACCOUNT_ID.test(accountId)) {
    return {
      accountId: undefined,
      problems: [`the account id ${show(accountId)} is not a Cloudflare account id`],
    }
  }
  return { accountId, problems: [] }
}

/**
 * The fingerprint check. `EMDASH_TARGET_FINGERPRINT` is set on the Worker's Workers Builds
 * variables, outside the repo, so a pull request that changes the D1 (or account) in
 * `wrangler.jsonc` is refused here. It must equal the fingerprint of the account the deploy goes
 * to and the build's `DB` database.
 *
 * @param {object} input
 * @param {WorkerConfig} input.build
 * @param {string | undefined} input.envAccountId `CLOUDFLARE_ACCOUNT_ID`.
 * @param {string | undefined} input.fingerprint `EMDASH_TARGET_FINGERPRINT`.
 * @returns {{ fingerprint: string, accountId: string, databaseId: string, problems: [] } | { problems: string[] }}
 */
export function checkFingerprint({ build, envAccountId, fingerprint }) {
  const account = deployAccount(build.account_id, envAccountId)
  if (account.accountId === undefined) return { problems: account.problems }
  const databaseId = build.d1_databases.find((entry) => entry.binding === DB_BINDING)?.database_id
  if (!databaseId || !DATABASE_ID.test(databaseId)) {
    return {
      problems: [`the build's D1 ${DB_BINDING} has no valid database_id: ${show(databaseId)}`],
    }
  }
  const expected = targetFingerprint(account.accountId, databaseId)
  if (fingerprint === undefined || fingerprint.trim() === '') {
    return {
      problems: [
        "EMDASH_TARGET_FINGERPRINT is not set. Set it on the Worker's Workers Builds variables (Settings, Build, Variables and secrets): Cradle printed it at create, and the site's docs/deploying.md has it",
      ],
    }
  }
  if (fingerprint.trim().toLowerCase() !== expected) {
    return {
      problems: [
        `EMDASH_TARGET_FINGERPRINT is ${show(fingerprint)}, but this deploy goes to account ${account.accountId}, D1 ${databaseId}, whose fingerprint is ${show(expected)}`,
      ],
    }
  }
  return { fingerprint: expected, accountId: account.accountId, databaseId, problems: [] }
}

/**
 * The adapter's redirect (`.wrangler/deploy/config.json`) must point at the build just checked,
 * so that `wrangler deploy`, given no `--config`, deploys that file and does not read
 * `wrangler.jsonc` and bundle the source.
 *
 * @param {string} redirectFile Absolute path of `.wrangler/deploy/config.json`.
 * @param {string} redirectText Its contents.
 * @param {string} builtFile Absolute path of `dist/server/wrangler.json`.
 * @returns {string[]}
 */
export function checkRedirect(redirectFile, redirectText, builtFile) {
  /** @type {unknown} */
  let parsed
  try {
    parsed = JSON.parse(redirectText)
  } catch (error) {
    return [`${redirectFile} is not JSON: ${/** @type {Error} */ (error).message}`]
  }
  const configPath =
    typeof parsed === 'object' && parsed !== null && 'configPath' in parsed
      ? parsed.configPath
      : undefined
  if (typeof configPath !== 'string') return [`${redirectFile} has no configPath`]
  if (resolve(dirname(redirectFile), configPath) !== resolve(builtFile)) {
    return [`${redirectFile} points Wrangler at ${configPath}, not at ${builtFile}`]
  }
  return []
}

/**
 * What `wrangler deploy --dry-run` reports it would deploy: the file `WRANGLER_OUTPUT_FILE_PATH`
 * names, one JSON entry per line (Wrangler's `writeOutput`, which appends). Its `deploy` entry's
 * `worker_name` is the name after Wrangler has applied the environment and any
 * `WRANGLER_CI_OVERRIDE_NAME`. Exactly one `deploy` entry is accepted.
 *
 * @param {string} output
 * @param {string} environment
 * @param {string | undefined} expectedName
 * @returns {string[]}
 */
export function checkDryRunOutput(output, environment, expectedName) {
  const entries = output
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      try {
        const entry = JSON.parse(line)
        return typeof entry === 'object' && entry !== null ? [entry] : []
      } catch {
        return []
      }
    })
    .filter((entry) => entry.type === 'deploy')
  if (entries.length !== 1) {
    return [
      `wrangler deploy --dry-run reported ${entries.length} deploy entries in its output file, not one`,
    ]
  }
  const name = entries[0].worker_name
  if (typeof name !== 'string') {
    return ['wrangler deploy --dry-run did not report the Worker it would deploy']
  }
  if (name !== expectedName) {
    return [
      `wrangler deploy would deploy the Worker ${show(name)}; ${environment} deploys ${show(expectedName)}`,
    ]
  }
  return []
}

/**
 * Bindings compared by binding name: one on only one side, or a field that differs, is refused.
 *
 * @param {string} kind
 * @param {Array<Record<string, unknown>>} built
 * @param {Array<Record<string, unknown>>} expected
 * @param {string[]} fields
 * @returns {string[]}
 */
function compareBindings(kind, built, expected, fields) {
  /** @type {string[]} */
  const problems = []
  const names = [...new Set([...built, ...expected].map((entry) => String(entry.binding)))]
  for (const name of names) {
    const ours = built.filter((entry) => String(entry.binding) === name)
    const theirs = expected.filter((entry) => String(entry.binding) === name)
    if (ours.length !== 1 || theirs.length !== 1) {
      // @astrojs/cloudflare adds `{ binding: 'SESSION' }`, with no id, to a build whose
      // wrangler.jsonc has no SESSION KV, for Astro sessions.
      const hint =
        kind === 'KV' && ours.length === 1 && theirs.length === 0
          ? ' (the Cloudflare adapter adds a KV for Astro sessions when wrangler.jsonc has none: give it one with its id)'
          : ''
      problems.push(
        `${kind} ${show(name)}: the build has ${ours.length} and wrangler.jsonc ${theirs.length}${hint}`,
      )
      continue
    }
    const [built1 = {}] = ours
    const [expected1 = {}] = theirs
    for (const field of fields) {
      if (built1[field] !== expected1[field]) {
        problems.push(
          `${kind} ${show(name)}: the build's ${field} is ${show(built1[field])}, wrangler.jsonc's ${show(expected1[field])}`,
        )
      }
    }
  }
  return problems
}

/**
 * An environment other than production shares no Worker, D1, KV or R2 with production.
 *
 * @param {string} environment
 * @param {WorkerConfig} build
 * @param {WorkerConfig} production
 * @returns {string[]}
 */
function sharedWithProduction(environment, build, production) {
  /** @type {string[]} */
  const problems = []
  /**
   * @param {string} what
   * @param {Array<string | undefined>} ours
   * @param {Array<string | undefined>} theirs
   */
  const shared = (what, ours, theirs) => {
    const theirSet = new Set(theirs.filter(Boolean).map((value) => String(value).toLowerCase()))
    for (const value of ours) {
      if (value && theirSet.has(value.toLowerCase())) {
        problems.push(`${environment} shares ${what} ${show(value)} with production`)
      }
    }
  }
  shared('the Worker', [build.name], [production.name])
  shared(
    'the D1 database id',
    build.d1_databases.map((entry) => entry.database_id),
    production.d1_databases.map((entry) => entry.database_id),
  )
  shared(
    'the D1 database name',
    build.d1_databases.map((entry) => entry.database_name),
    production.d1_databases.map((entry) => entry.database_name),
  )
  shared(
    'the KV namespace id',
    build.kv_namespaces.map((entry) => entry.id),
    production.kv_namespaces.map((entry) => entry.id),
  )
  shared(
    'the R2 bucket',
    build.r2_buckets.map((entry) => entry.bucket_name),
    production.r2_buckets.map((entry) => entry.bucket_name),
  )
  return problems
}

/** @param {unknown} value */
function show(value) {
  return value === undefined ? 'not set' : JSON.stringify(value)
}
