/**
 * `@losrc/emdash-deploy`: the checked deploy order for an EmDash site on Cloudflare Workers, run
 * by `emdash-deploy <env> [--dry-run]`. The checks are exported so they can be tested and reused;
 * each returns the reasons to refuse and changes nothing.
 */
export {
  DB_BINDING,
  checkBuild,
  checkDryRunOutput,
  checkFingerprint,
  checkOverrideName,
  checkRedirect,
  deployAccount,
  targetFingerprint,
} from './checks.js'
export { BUILT_CONFIG, REDIRECT, USAGE, WRANGLER_CONFIG, deploy } from './deploy.js'
export { parseJsonc } from './jsonc.js'
export { PACKAGE_VERSION } from './version.js'
export {
  INHERITED_KEYS,
  PRODUCTION,
  environmentsOf,
  resolveEnvironment,
  sectionFor,
  workerConfig,
} from './wrangler-config.js'
