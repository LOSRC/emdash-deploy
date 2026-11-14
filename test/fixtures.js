/**
 * The three sites' real `wrangler.jsonc` shapes and the builds the Cloudflare adapter writes for
 * them, as of 2026-11-14. The repo is public, so every account id, D1 id and KV id is replaced by
 * a made-up one of the same form; names, comments' kinds, tabs, trailing commas and structure are
 * the sites' own.
 */
import { targetFingerprint } from '../src/checks.js'

export const ids = {
  cg: {
    productionAccount: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa0001',
    stagingAccount: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbb0002',
    productionD1: '11111111-1111-4111-8111-111111110001',
    stagingD1: '22222222-2222-4222-8222-222222220002',
    productionKv: 'cccccccccccccccccccccccccccc0001',
    stagingKv: 'cccccccccccccccccccccccccccc0002',
  },
  cc: {
    account: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbb0002',
    productionD1: '33333333-3333-4333-8333-333333330001',
    previewD1: '44444444-4444-4444-8444-444444440002',
    stagingD1: '55555555-5555-4555-8555-555555550003',
    productionKv: 'dddddddddddddddddddddddddddd0001',
    previewKv: 'dddddddddddddddddddddddddddd0002',
    stagingKv: 'dddddddddddddddddddddddddddd0003',
  },
}

/** christophergoddard: production in one account with a Custom Domain, staging in another. */
export const christophergoddardJsonc = `{
  "$schema": "node_modules/wrangler/config-schema.json",
  // Two Workers, one per environment, in two Cloudflare accounts.
  "name": "christophergoddard",
  "account_id": "${ids.cg.productionAccount}",
  "main": "./src/worker.ts",
  "compatibility_date": "2026-09-04",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "preview_urls": false,
  "routes": [{ "pattern": "christophergoddard.net", "custom_domain": true }],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "christophergoddard",
      "database_id": "${ids.cg.productionD1}",
      // The dev server keeps its local database.
      "preview_database_id": "DB",
    },
  ],
  "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "christophergoddard-media" }],
  "kv_namespaces": [{ "binding": "SESSION", "id": "${ids.cg.productionKv}" }],
  "images": { "binding": "IMAGES" },
  "version_metadata": { "binding": "CF_VERSION_METADATA" },
  "send_email": [
    { "name": "EMAIL", "allowed_sender_addresses": ["noreply@mail.example.net"] },
  ],
  "cache": { "enabled": true },
  /* A URL in a string must survive comment stripping. */
  "vars": { "SHOP_URL": "https://shop.example.com//path", "KIND": "private" },
  "observability": { "enabled": true },
  "triggers": { "crons": ["* * * * *"] },
  "env": {
    "staging": {
      "name": "christophergoddard-staging",
      "account_id": "${ids.cg.stagingAccount}",
      "routes": [],
      "workers_dev": true,
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "christophergoddard-staging",
          "database_id": "${ids.cg.stagingD1}",
        },
      ],
      "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "christophergoddard-staging-media" }],
      "kv_namespaces": [{ "binding": "SESSION", "id": "${ids.cg.stagingKv}" }],
      "images": { "binding": "IMAGES" },
      "version_metadata": { "binding": "CF_VERSION_METADATA" },
      "vars": { "SHOP_URL": "https://shop.example.com//path", "KIND": "private" },
      "send_email": [],
    },
  },
}
`

/** Creative Care: one account, production plus `preview` and `staging`. */
export const creativeCareJsonc = `{
  "$schema": "node_modules/wrangler/config-schema.json",
  // Three Workers in one account, one per environment.
  "name": "creativecareltd",
  "account_id": "${ids.cc.account}",
  "main": "./src/worker.ts",
  "compatibility_date": "2026-09-04",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "preview_urls": false,
  "d1_databases": [
    { "binding": "DB", "database_name": "creativecareltd", "database_id": "${ids.cc.productionD1}" },
  ],
  "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "creativecareltd-media" }],
  "kv_namespaces": [{ "binding": "SESSION", "id": "${ids.cc.productionKv}" }],
  "images": { "binding": "IMAGES" },
  "version_metadata": { "binding": "CF_VERSION_METADATA" },
  "cache": { "enabled": true },
  "exports": {
    "default": { "type": "worker", "cache": { "enabled": false } },
    "Site": { "type": "worker", "cache": { "enabled": true } },
  },
  "observability": { "enabled": true },
  "triggers": { "crons": ["* * * * *"] },
  "env": {
    "preview": {
      "name": "creativecareltd-preview",
      "routes": [],
      "workers_dev": true,
      "d1_databases": [
        { "binding": "DB", "database_name": "creativecareltd-preview", "database_id": "${ids.cc.previewD1}" },
      ],
      "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "creativecareltd-preview-media" }],
      "kv_namespaces": [{ "binding": "SESSION", "id": "${ids.cc.previewKv}" }],
      "images": { "binding": "IMAGES" },
      "version_metadata": { "binding": "CF_VERSION_METADATA" },
    },
    "staging": {
      "name": "creativecareltd-staging",
      "routes": [],
      "workers_dev": true,
      "d1_databases": [
        { "binding": "DB", "database_name": "creativecareltd-staging", "database_id": "${ids.cc.stagingD1}" },
      ],
      "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "creativecareltd-staging-media" }],
      "kv_namespaces": [{ "binding": "SESSION", "id": "${ids.cc.stagingKv}" }],
      "images": { "binding": "IMAGES" },
      "version_metadata": { "binding": "CF_VERSION_METADATA" },
    },
  },
}
`

/** losrc as it is: tabs, no account, no D1 id, no KV, no env yet. */
export const losrcJsonc = `{
\t"$schema": "node_modules/wrangler/config-schema.json",
\t"name": "losrc",
\t"main": "./src/worker.ts",
\t"version_metadata": { "binding": "CF_VERSION_METADATA" },
\t"cache": { "enabled": true },
\t"exports": {
\t\t"default": { "type": "worker", "cache": { "enabled": false } },
\t\t"Site": { "type": "worker", "cache": { "enabled": true } }
\t},
\t"compatibility_date": "2026-02-24",
\t"compatibility_flags": ["nodejs_compat"],
\t"d1_databases": [
\t\t{
\t\t\t"binding": "DB",
\t\t\t"database_name": "losrc",
\t\t},
\t],
\t"r2_buckets": [
\t\t{
\t\t\t"binding": "MEDIA",
\t\t\t"bucket_name": "losrc-media",
\t\t},
\t],
\t// Sandboxed plugins require Worker Loader. Uncomment to enable:
\t// "worker_loaders": [{ "binding": "LOADER" }],
\t"triggers": {
\t\t"crons": ["* * * * *"],
\t},
}
`

/** The keys every build the adapter writes starts with. */
const redirected = (/** @type {string} */ top, /** @type {string[]} */ envs) => ({
  configPath: '../../wrangler.jsonc',
  userConfigPath: '../../wrangler.jsonc',
  topLevelName: top,
  definedEnvironments: envs,
})

/** christophergoddard's production build (`dist/server/wrangler.json`), trimmed. */
export const cgProductionBuild = {
  ...redirected('christophergoddard', ['staging']),
  account_id: ids.cg.productionAccount,
  compatibility_date: '2026-09-04',
  compatibility_flags: ['nodejs_compat'],
  name: 'christophergoddard',
  main: 'entry.mjs',
  routes: [{ pattern: 'christophergoddard.net', custom_domain: true }],
  triggers: { crons: ['* * * * *'] },
  workers_dev: false,
  preview_urls: false,
  vars: { SHOP_URL: 'https://shop.example.com//path', KIND: 'private' },
  kv_namespaces: [{ binding: 'SESSION', id: ids.cg.productionKv }],
  send_email: [{ name: 'EMAIL', allowed_sender_addresses: ['noreply@mail.example.net'] }],
  r2_buckets: [{ binding: 'MEDIA', bucket_name: 'christophergoddard-media' }],
  d1_databases: [
    {
      binding: 'DB',
      database_name: 'christophergoddard',
      database_id: ids.cg.productionD1,
      preview_database_id: 'DB',
      migrations_dir: '../../migrations',
    },
  ],
  images: { binding: 'IMAGES' },
  version_metadata: { binding: 'CF_VERSION_METADATA' },
  cache: { enabled: true },
  no_bundle: true,
}

/** christophergoddard's staging build (`CLOUDFLARE_ENV=staging astro build`). */
export const cgStagingBuild = {
  ...redirected('christophergoddard', ['staging']),
  targetEnvironment: 'staging',
  account_id: ids.cg.stagingAccount,
  compatibility_date: '2026-09-04',
  compatibility_flags: ['nodejs_compat'],
  name: 'christophergoddard-staging',
  main: 'entry.mjs',
  routes: [],
  triggers: { crons: ['* * * * *'] },
  workers_dev: true,
  preview_urls: false,
  kv_namespaces: [{ binding: 'SESSION', id: ids.cg.stagingKv }],
  send_email: [],
  r2_buckets: [{ binding: 'MEDIA', bucket_name: 'christophergoddard-staging-media' }],
  d1_databases: [
    {
      binding: 'DB',
      database_name: 'christophergoddard-staging',
      database_id: ids.cg.stagingD1,
      migrations_dir: '../../migrations',
    },
  ],
  images: { binding: 'IMAGES' },
  version_metadata: { binding: 'CF_VERSION_METADATA' },
  cache: { enabled: true },
  no_bundle: true,
}

/**
 * The 2026-11-04 build: Workers Builds ran a plain production build (no deploy script) and
 * deployed it to the staging Worker. The top level then had no ids, and `workers_dev` false.
 */
export const cgBadBuild = {
  ...redirected('christophergoddard', ['staging']),
  account_id: ids.cg.productionAccount,
  name: 'christophergoddard',
  workers_dev: false,
  routes: [],
  kv_namespaces: [{ binding: 'SESSION' }],
  r2_buckets: [{ binding: 'MEDIA', bucket_name: 'christophergoddard-media' }],
  d1_databases: [{ binding: 'DB', database_name: 'christophergoddard', migrations_dir: '../../migrations' }],
}

/**
 * A Creative Care build for `environment` (`production`, `preview` or `staging`).
 *
 * @param {'production' | 'preview' | 'staging'} environment
 */
export function ccBuild(environment) {
  const suffix = environment === 'production' ? '' : `-${environment}`
  const d1 = { production: ids.cc.productionD1, preview: ids.cc.previewD1, staging: ids.cc.stagingD1 }
  const kv = { production: ids.cc.productionKv, preview: ids.cc.previewKv, staging: ids.cc.stagingKv }
  return {
    ...redirected('creativecareltd', ['preview', 'staging']),
    ...(environment === 'production' ? {} : { targetEnvironment: environment, routes: [] }),
    account_id: ids.cc.account,
    name: `creativecareltd${suffix}`,
    workers_dev: environment !== 'production',
    preview_urls: false,
    kv_namespaces: [{ binding: 'SESSION', id: kv[environment] }],
    r2_buckets: [{ binding: 'MEDIA', bucket_name: `creativecareltd${suffix}-media` }],
    d1_databases: [
      {
        binding: 'DB',
        database_name: `creativecareltd${suffix}`,
        database_id: d1[environment],
        migrations_dir: '../../migrations',
      },
    ],
    images: { binding: 'IMAGES' },
  }
}

/**
 * losrc's production build today: no account, a D1 with no id, and the SESSION KV (no id) that
 * the Cloudflare adapter adds for Astro sessions when wrangler.jsonc has none.
 */
export const losrcBuild = {
  ...redirected('losrc', []),
  name: 'losrc',
  kv_namespaces: [{ binding: 'SESSION' }],
  r2_buckets: [{ binding: 'MEDIA', bucket_name: 'losrc-media' }],
  d1_databases: [{ binding: 'DB', database_name: 'losrc', migrations_dir: '../../migrations' }],
  images: { binding: 'IMAGES' },
}

export const fingerprints = {
  cgProduction: targetFingerprint(ids.cg.productionAccount, ids.cg.productionD1),
  cgStaging: targetFingerprint(ids.cg.stagingAccount, ids.cg.stagingD1),
  ccProduction: targetFingerprint(ids.cc.account, ids.cc.productionD1),
  ccPreview: targetFingerprint(ids.cc.account, ids.cc.previewD1),
  ccStaging: targetFingerprint(ids.cc.account, ids.cc.stagingD1),
}
