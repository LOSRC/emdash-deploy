#!/usr/bin/env node
// emdash-deploy <production|env name> [--dry-run]: build, check, migrate, deploy, check, from the
// site's root. See the package README.
import { deploy } from '../src/deploy.js'
import { runProcess } from '../src/run.js'

process.exitCode = deploy({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: { ...process.env },
  run: runProcess,
  out: (line) => console.log(`emdash-deploy: ${line}`),
  err: (line) => console.error(`emdash-deploy: ${line}`),
})
