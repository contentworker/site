#!/usr/bin/env node
/** `npm create @contentworker/site`: the terminal around src/create.ts. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { create, UsageError } from './create.js';

const rl = process.stdin.isTTY
  ? createInterface({ input: process.stdin, output: process.stdout })
  : null;
const io = {
  cwd: process.cwd(),
  env: process.env,
  interactive: rl !== null,
  async ask(question, fallback) {
    if (!rl) return fallback ?? '';
    const answer = (await rl.question(`${question}${fallback ? ` (${fallback})` : ''}: `)).trim();
    return answer || fallback || '';
  },
  log: (line) => console.log(line),
  run: (cmd, args, { cwd, env }) =>
    new Promise((done) => {
      const child = spawn(cmd, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
      child.on('close', (code) => done(code ?? 1));
      child.on('error', () => done(1));
    }),
};
try {
  process.exitCode = await create(process.argv.slice(2), io);
} catch (error) {
  console.error(error instanceof UsageError ? error.message : error);
  process.exitCode = error instanceof UsageError ? 2 : 1;
} finally {
  rl?.close();
}
