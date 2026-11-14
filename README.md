# @losrc/emdash-deploy

The deploy order for [EmDash](https://emdashcms.com) sites on Cloudflare Workers Builds, as one
checked command every site runs instead of its own script:

```sh
emdash-deploy <env> [--dry-run]
```

It builds the site for one environment, checks that the build is that environment's (Worker,
account, D1, KV, R2, `workers_dev`, routes), that the database is the one recorded outside the
repo, and that Wrangler will deploy the checked file to the right Worker. Only then does it apply
EmDash's migrations, deploy, and check the migrations. **Every check can only refuse.** Nothing
here changes what is built or deployed.

## Why

- **2026-11-04.** christophergoddard's staging Worker had no `deploy:staging` script. Workers
  Builds fell back to a plain build and `wrangler deploy` of the top-level (production)
  configuration, under the staging Worker's name. That turned `workers_dev` off (the staging
  address answered error 1042). It also bound a new, empty D1 database and R2 bucket, which
  Wrangler created because the top level had no ids.
- **Production's first Workers Build** failed in `emdash migrate`. EmDash refuses a D1 binding
  with a `preview_database_id`, which production keeps for the dev server. The fix was
  `--d1 <id>`.
- **`--config dist/server/wrangler.json`** with `CLOUDFLARE_ENV=staging` makes Wrangler append
  the environment again, deploying `christophergoddard-staging-staging`.

christophergoddard then wrote its own guarded `scripts/deploy.sh` with a table of its own
resource names. Creative Care's older copy checks nothing, and losrc ran
`astro build && wrangler deploy`. This package is that guarded script, made shared and
table-free. Cradle refuses to hand an environment to Workers Builds without it
(`cradle builds <site> add` sets a site up).

## Install

Sites install it from GitHub, pinned by commit:

```sh
pnpm add github:LOSRC/emdash-deploy#<commit>
```

It is plain JavaScript with no build step and no install scripts, so a site needs no
`allowBuilds` line. Cradle requires a minimum version and reads it from the site's lockfile.

Peer ranges, the versions this release was checked against:

| Peer | Range | Checked |
|---|---|---|
| `wrangler` | 4.147.0 to 4.152.x | Environment inheritance, the output file's `deploy` entry, `WRANGLER_CI_OVERRIDE_NAME`, read in 4.147.0 and 4.152.0 |
| `emdash` | 1.3.1 to 1.5.x | `emdash migrate`'s flags, read in 1.3.1, 1.4.0 and 1.5.0 |
| `@emdash-cms/cloudflare` | 1.3.1 to 1.5.x | The D1 target and fingerprint, read in 1.3.1, 1.4.0 and 1.5.0 |

pnpm warns outside them. That is on purpose: re-check those places before you widen a range.

## The site's scripts

For every environment, production included, there are two scripts. Cradle's
`cradle builds <site> add` writes them:

```json
{
  "scripts": {
    "build": "astro build",
    "build:production": "astro build",
    "deploy:production": "emdash-deploy production",
    "build:staging": "CLOUDFLARE_ENV=staging astro build",
    "deploy:staging": "emdash-deploy staging",
    "deploy": "emdash-deploy production"
  }
}
```

- `build:<env>` is a plain build. The container and the upgrade skill run build scripts, and
  they have no account or fingerprint.
- `deploy:<env>` makes every check itself, then deploys.
- A bare `deploy` is absent or exactly `emdash-deploy production`.

`<env>` is `production` (the top level of `wrangler.jsonc`) or any name under `env` in
`wrangler.jsonc` (`staging`, Creative Care's `preview`). Any other name exits 2. So does an
`env` named `production`, which this package reserves for the top level.

## Workers Builds, per Worker

Workers & Pages, the Worker, Settings, Build:

- **Production branch** `main`.
- **Build command** `pnpm run build:<env>`.
- **Deploy command** `pnpm run deploy:<env>`.
- **Non-production branch deploy command** `echo "Branch builds don't deploy to <env>"`. Never a
  deploy script, `wrangler deploy` or `wrangler versions upload`. The command also exits 0
  without building when `WORKERS_CI_BRANCH` is set and is not `main`, in case this setting is
  wrong.
- **Variable** `EMDASH_TARGET_FINGERPRINT`, the fingerprint below. The deploy refuses until it is
  set.
- **Build token.** Give it **D1 Edit** as well as its Workers permissions:
  `emdash migrate` writes to the D1 before the deploy.
- **Never click "Set up Worker Previews".** It cannot be undone, and it runs `wrangler preview`
  instead of this command.

## What a deploy does

Run from the site's root. Each step prints one line. Before step 9, a refusal exits 1 and says
what differs and that nothing was migrated or uploaded.

1. **Branch guard.** If `WORKERS_CI_BRANCH` is set and is not `main`, it exits 0. Nothing is
   built.
2. **Environment.** `wrangler.jsonc` is read. For production `CLOUDFLARE_ENV` is removed; for
   another environment it is set to that environment. Every later step runs with the same
   variables.
3. **Build.** It removes `dist/server/wrangler.json` and `.wrangler/deploy/config.json`, so a
   failed build can't leave an old one, then runs `pnpm exec astro build`. It refuses if the
   build fails or writes no `dist/server/wrangler.json`.
4. **Check the build.** It reads `dist/server/wrangler.json` (the configuration the Cloudflare
   adapter resolved) and compares it with the environment's section of `wrangler.jsonc`,
   resolved as Wrangler does. An environment inherits `account_id`, `workers_dev`,
   `preview_urls`, `route` and `routes` from the top level when it doesn't set them. Its name is
   its own or `<top name>-<env>`. Bindings and `vars` are not inherited. The step refuses unless:
   - the Worker name is the resolved one;
   - `targetEnvironment` is the environment (absent for production);
   - `account_id` and `workers_dev` are the resolved ones;
   - outside production, `workers_dev` is `true` and there are no routes (an env with no
     `"routes": []` inherits the top level's, Custom Domain and all);
   - there is a `DB` D1 binding, every D1 has a `database_id` and every KV an `id`. Wrangler
     creates a new, empty one for any that has none. The Cloudflare adapter adds a `SESSION` KV
     with no id when `wrangler.jsonc` has none, for Astro sessions; give it one;
   - every D1 (id, name), KV (id) and R2 (bucket) binding matches `wrangler.jsonc`'s by binding
     name, with none on one side only;
   - outside production, the Worker, D1 ids and names, KV ids and R2 buckets share nothing with
     production's;
   - `WRANGLER_CI_OVERRIDE_NAME`, the Worker Workers Builds deploys to, is the resolved Worker
     when set. Empty counts as set, since Wrangler uses any value that is set.
5. **Fingerprint.** The account is the build's `account_id`, else `CLOUDFLARE_ACCOUNT_ID`. It
   refuses if both are set and differ, or neither is. `EMDASH_TARGET_FINGERPRINT` must equal the
   fingerprint of that account and the build's `DB` database id (below).
6. **Redirect.** `.wrangler/deploy/config.json`'s `configPath` must point at
   `dist/server/wrangler.json`. Then Wrangler, given no `--config`, deploys the checked file and
   refuses a `CLOUDFLARE_ENV` the build wasn't made for.
7. **Dry run.** It runs `pnpm exec wrangler deploy --dry-run` with no `--config`, its output
   file (`WRANGLER_OUTPUT_FILE_PATH`) in a fresh temporary directory. There must be exactly one
   `deploy` entry, and its `worker_name` must be the resolved Worker. That name comes after
   Wrangler has applied the environment and any `WRANGLER_CI_OVERRIDE_NAME`.
8. **`--dry-run` stops here** and exits 0: nothing migrated, nothing uploaded.
9. **Migrate.** It runs `pnpm exec emdash migrate --wrangler-config wrangler.jsonc
   [--wrangler-env <env>] --d1 <DB's database_id> --expected-target-fingerprint <fingerprint>`.
   The database is given by id because EmDash refuses a binding with a `preview_database_id`.
   EmDash checks the fingerprint again against the database the API returns.
10. **Deploy.** It runs `pnpm exec wrangler deploy`, with no `--config`, `--env` or `--name`.
11. **Check.** It runs `pnpm exec emdash migrate … --check` with the same selection.

If a step from 9 on fails, the deploy exits 1 and says what had already been done.

The checks are exported from the package's main entry and change nothing. Each returns the
reasons to refuse, an empty list when there are none:

```js
import {
  checkBuild,
  checkDryRunOutput,
  checkFingerprint,
  checkOverrideName,
  checkRedirect,
  resolveEnvironment,
  targetFingerprint,
  workerConfig,
} from '@losrc/emdash-deploy'
```

### What the checks don't catch

- **A wrong R2 bucket name or KV id** in both `wrangler.jsonc` and the build. They match each
  other, and only the D1 is anchored outside the repo. Cradle's `status`, `create` and
  `refresh` compare those with the Site Description.
- **The dashboard's commands.** If Workers Builds' deploy command isn't
  `pnpm run deploy:<env>`, none of this runs. Cradle's walk-through prints the settings; reading
  them back from Cloudflare is a later piece of work.

## `--dry-run`

`emdash-deploy <env> --dry-run` makes every check, steps 1 to 7, and stops. It needs what a real
deploy needs, `EMDASH_TARGET_FINGERPRINT` and an account included, and `wrangler deploy
--dry-run` needs no credentials. It neither migrates nor uploads.

## The fingerprint

EmDash's migration target fingerprint for a D1 database is the SHA-256, in hex, of:

```json
{"kind":"d1","identity":["<account id>","<database id>"]}
```

Both ids are lower-cased, as EmDash does (`fingerprintTarget` in `@emdash-cms/cloudflare`). It
changes only if the account or the D1 changes. Cradle prints it at `cradle create`, and the
site's `docs/deploying.md` has it. Set it as `EMDASH_TARGET_FINGERPRINT` on the Worker's
Workers Builds variables.

A pull request that changes the D1 or the account in `wrangler.jsonc` is refused here: the value
sits in the dashboard, outside the repo. To confirm the value from a checkout:

```sh
CLOUDFLARE_ENV=<env> pnpm exec astro build
pnpm exec emdash migrate --wrangler-config wrangler.jsonc --wrangler-env <env> --d1 <id> --status
```

For production, build with `CLOUDFLARE_ENV` unset and leave out `--wrangler-env`.

## For Cradle

```js
import { PACKAGE_VERSION } from '@losrc/emdash-deploy'
```

`PACKAGE_VERSION` is the installed version, the same as `package.json`'s. Cradle reads the
version from the site's lockfile and refuses a site below the one it requires.

## Releasing

A site pins a commit, and Cradle compares versions. So every change Cradle should be able to
require bumps the version, in the same pull request:

1. Bump `version` in `package.json` and `PACKAGE_VERSION` in `src/version.js`. A test holds
   them together.
2. Add the change to `CHANGELOG.md`.
3. After merging, Cradle raises `REQUIRED_DEPLOY` to the new version, pinned to the merge commit
   on `main`, and `cradle builds <site> add` moves each site to it.

## Develop

Plain ESM JavaScript with JSDoc types, checked by TypeScript (`checkJs`). Tests run with vitest,
against fake processes; nothing is deployed.

```sh
pnpm install
pnpm typecheck
pnpm test
```

## Licence

MIT
