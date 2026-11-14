import { spawnSync } from 'node:child_process'

/**
 * Run a program with its output going straight to ours, without a shell, and wait for it.
 *
 * @type {import('./deploy.js').Run}
 */
export function runProcess(command, args, { cwd, env }) {
  /** @type {NodeJS.ProcessEnv} */
  const childEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) childEnv[key] = value
  }
  const result = spawnSync(command, args, { cwd, env: childEnv, stdio: 'inherit', shell: false })
  return result.error ? { status: result.status, error: result.error } : { status: result.status }
}
