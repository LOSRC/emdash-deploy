# Changelog

Every change Cradle should be able to require bumps the version (see "Releasing" in the README).
Sites pin a commit; the version is what Cradle compares.

## 0.1.0

- First release: `emdash-deploy <env> [--dry-run]`, the branch guard, build, build check,
  fingerprint, redirect and dry-run checks, then `emdash migrate`, `wrangler deploy` and
  `emdash migrate --check`. Taken from christophergoddard's `scripts/deploy.sh` and
  `scripts/deploy-target.ts`, without a per-site table, and with `EMDASH_TARGET_FINGERPRINT`
  required.
