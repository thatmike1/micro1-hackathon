import { spawnSync } from 'node:child_process';

/**
 * Run a shell command and capture it instead of streaming it. Library suites are noisy and
 * the corpus scripts only care about the exit code plus, on failure, the tail of the output.
 *
 * @param {string} command
 * @param {string} cwd
 * @param {{timeoutMs?: number}} [options]
 * @returns {{ok: boolean, code: number|null, output: string, ms: number}}
 */
export function capture(command, cwd, options = {}) {
  const started = Date.now();
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeoutMs,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return {
    ok: result.status === 0,
    code: result.status,
    output,
    ms: Date.now() - started,
  };
}

/**
 * Last `lines` lines of captured output, for failure reporting.
 * @param {string} output
 * @param {number} [lines]
 */
export function tail(output, lines = 20) {
  return output.split('\n').slice(-lines).join('\n');
}
