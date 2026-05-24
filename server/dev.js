import { spawn } from 'node:child_process';

const processes = [
  spawn(process.execPath, ['server/index.js'], { stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
];

function shutdown(signal) {
  for (const child of processes) child.kill(signal);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

for (const child of processes) {
  child.on('exit', (code) => {
    if (code && code !== 0) {
      for (const other of processes) {
        if (other !== child) other.kill('SIGTERM');
      }
      process.exit(code);
    }
  });
}
