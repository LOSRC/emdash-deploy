/**
 * The Worker a site's `wrangler.jsonc` describes for one environment, resolved the way Wrangler
 * resolves it, so a build can be checked against it.
 *
 * Read from Wrangler's own source (`normalizeAndValidateEnvironment`, 4.147.0 and 4.152.0): an
 * environment takes `account_id`, `workers_dev`, `preview_urls`, `route` and `routes` from the
 * top level when it does not set them (`??`, so an environment's `routes: []` or
 * `workers_dev: false` stays as written), and its `name` is its own or `<top name>-<env>`. Bindings
 * (`d1_databases`, `kv_namespaces`, `r2_buckets`, ...) and `vars` are not inherited: an
 * environment without its own has none.
 */

/** @typedef {{ binding?: string, database_name?: string, database_id?: string, preview_database_id?: string }} D1Binding */
/** @typedef {{ binding?: string, id?: string }} KvBinding */
/** @typedef {{ binding?: string, bucket_name?: string }} R2Binding */

/**
 * One Worker's configuration, in Wrangler's own field names: a section of `wrangler.jsonc` after
 * inheritance, or a built `dist/server/wrangler.json`, which is already in this shape.
 *
 * @typedef {object} WorkerConfig
 * @property {string | undefined} name
 * @property {string | undefined} account_id
 * @property {boolean | undefined} workers_dev
 * @property {string | undefined} targetEnvironment The Wrangler environment a build was made
 *   for; absent for production. Only a build has it.
 * @property {unknown[]} routes The routes Wrangler deploys: `routes` when set, else `route`.
 * @property {D1Binding[]} d1_databases
 * @property {KvBinding[]} kv_namespaces
 * @property {R2Binding[]} r2_buckets
 */

/** The keys an environment takes from the top level when it does not set them. */
export const INHERITED_KEYS = /** @type {const} */ ([
  'account_id',
  'workers_dev',
  'preview_urls',
  'route',
  'routes',
])

/** The name the top level of `wrangler.jsonc` is deployed under by this package. */
export const PRODUCTION = 'production'

/**
 * The environments a `wrangler.jsonc` defines: `production` (the top level) and every name
 * under `env`.
 *
 * @param {Record<string, unknown>} top
 * @returns {string[]}
 */
export function environmentsOf(top) {
  return [PRODUCTION, ...Object.keys(asRecord(top.env))]
}

/**
 * The raw section Wrangler would deploy for `environment`: the top level for `production`,
 * otherwise `env.<environment>` with what Wrangler lets it inherit and its name worked out.
 * Throws when the environment is not defined; an environment named `production` under `env` is
 * refused as ambiguous.
 *
 * @param {Record<string, unknown>} top
 * @param {string} environment
 * @returns {Record<string, unknown>}
 */
export function sectionFor(top, environment) {
  const envs = asRecord(top.env)
  if (environment === PRODUCTION) {
    if (Object.hasOwn(envs, PRODUCTION)) {
      throw new Error(
        'wrangler.jsonc defines an env named "production", which this package reserves for the top level',
      )
    }
    return top
  }
  if (!Object.hasOwn(envs, environment) || !isRecord(envs[environment])) {
    throw new Error(`wrangler.jsonc has no env.${environment}`)
  }
  const own = asRecord(envs[environment])
  // Wrangler treats an empty account_id as unset (`mutateEmptyStringAccountIDValue`).
  const section = { ...own }
  if (section.account_id === '') delete section.account_id
  const inherited = Object.fromEntries(
    INHERITED_KEYS.filter((key) => section[key] === undefined && top[key] !== undefined).map(
      (key) => [key, top[key]],
    ),
  )
  const topName = typeof top.name === 'string' && top.name !== '' ? top.name : undefined
  const name =
    typeof section.name === 'string' && section.name !== ''
      ? section.name
      : topName === undefined
        ? undefined
        : `${topName}-${environment}`
  return { ...inherited, ...section, ...(name === undefined ? {} : { name }) }
}

/**
 * The Worker `wrangler.jsonc` describes for `environment`.
 *
 * @param {Record<string, unknown>} top The parsed `wrangler.jsonc`.
 * @param {string} environment
 * @returns {WorkerConfig}
 */
export function resolveEnvironment(top, environment) {
  return workerConfig(sectionFor(top, environment))
}

/**
 * Read a Worker configuration (a resolved section or a build) into the fields the checks use.
 *
 * @param {unknown} value
 * @returns {WorkerConfig}
 */
export function workerConfig(value) {
  const section = asRecord(value)
  /** @param {string} key */
  const list = (key) => {
    const entries = section[key]
    return Array.isArray(entries) ? entries.map(asRecord) : []
  }
  // What Wrangler deploys: `routes` when set (an env's own `[]` included), else `route`.
  const route = section.route
  const routes = Array.isArray(section.routes)
    ? section.routes
    : route === undefined || route === ''
      ? []
      : [route]
  return {
    name: typeof section.name === 'string' ? section.name : undefined,
    account_id: typeof section.account_id === 'string' ? section.account_id : undefined,
    workers_dev: typeof section.workers_dev === 'boolean' ? section.workers_dev : undefined,
    targetEnvironment:
      typeof section.targetEnvironment === 'string' ? section.targetEnvironment : undefined,
    routes,
    d1_databases: list('d1_databases'),
    kv_namespaces: list('kv_namespaces'),
    r2_buckets: list('r2_buckets'),
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * @param {unknown} value
 * @returns {Record<string, any>}
 */
function asRecord(value) {
  return isRecord(value) ? value : {}
}
