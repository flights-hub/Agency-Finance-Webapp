import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const children = [
  spawn(process.execPath, [resolve(projectRoot, 'server/index.js')], {
    cwd: projectRoot,
    stdio: 'inherit',
  }),
  spawn(process.execPath, [resolve(projectRoot, 'node_modules/vite/bin/vite.js')], {
    cwd: projectRoot,
    stdio: 'inherit',
  }),
];

let shuttingDown = false;

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

// Ask a child to stop and resolve only once it is really gone, escalating to a
// forced kill if it ignores the polite request.
function stopChild(child) {
  if (hasExited(child)) return Promise.resolve();
  return new Promise((resolve) => {
    const force = setTimeout(() => {
      if (!hasExited(child)) child.kill('SIGKILL');
      resolve();
    }, 3000);
    child.once('exit', () => {
      clearTimeout(force);
      resolve();
    });
    child.kill();
  });
}

// Ctrl+C reaches this parent, but the children can outlive it and keep holding
// 8787/5173 — which makes the next `npm run dev` fail with EADDRINUSE. So wait
// for every child to actually exit before this process does.
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.all(children.map(stopChild));
  process.exit(code);
}

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
if (process.platform === 'win32') SIGNALS.push('SIGBREAK');
for (const signal of SIGNALS) {
  process.on(signal, () => { shutdown(0); });
}

// Last resort: if this process exits some other way, still take the children
// down. Only synchronous work runs on 'exit', so this cannot await them.
process.on('exit', () => {
  for (const child of children) {
    if (!hasExited(child)) child.kill();
  }
});

for (const child of children) {
  child.on('exit', (code) => {
    if (shuttingDown) return;
    // Half the dev stack died on its own; take the rest down rather than leave
    // a half-running stack behind.
    shutdown(code || 0);
  });
}
