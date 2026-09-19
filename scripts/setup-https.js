import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const hosts = new Set(['localhost', '127.0.0.1', '::1', ...process.argv.slice(2)]);
for (const addresses of Object.values(networkInterfaces())) for (const a of addresses || []) if (a.family === 'IPv4' && !a.internal) hosts.add(a.address);
const check = spawnSync('mkcert', ['-version'], { encoding: 'utf8' });
if (check.error || check.status !== 0) {
  console.error('mkcert is required. On macOS: brew install mkcert\nThen rerun npm run certs -- <LAN-IP>. Official instructions: https://github.com/FiloSottile/mkcert');
  process.exit(1);
}
function run(args) {
  const result = spawnSync('mkcert', args, { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
const install = spawnSync('mkcert', ['-install'], { cwd: root, stdio: 'inherit' });
if (install.error || install.status !== 0) {
  console.warn('\nCould not install the CA into this Mac automatically. The certificate will still be generated.');
  console.warn('You must install/trust the public rootCA.pem manually on the laptop and phone before opening HTTPS.\n');
}
fs.mkdirSync(new URL('../.certs/', import.meta.url), { recursive: true, mode: 0o700 });
run(['-key-file', '.certs/key.pem', '-cert-file', '.certs/cert.pem', ...hosts]);
fs.chmodSync(new URL('../.certs/key.pem', import.meta.url), 0o600);
console.log('Ready: npm start. On iOS, install and fully trust the public rootCA.pem from `mkcert -CAROOT`. Never share rootCA-key.pem.');
