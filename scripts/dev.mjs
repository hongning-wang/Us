import {spawn} from 'node:child_process';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:net';
import {hostname} from 'node:os';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const children = [];
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  console.log('\nStopping Us services…');
  for (const child of children) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  }
  // npm starts descendants: terminate each process group, including any stragglers.
  setTimeout(() => {
    for (const child of children) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
    process.exit(code);
  }, 1500);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

function start(name, command, args, capture = false) {
  console.log(`Starting ${name}…`);
  const child = spawn(command, args, {detached: true, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'});
  children.push(child);
  child.on('error', error => { console.error(`${name}: ${error.message}`); stop(1); });
  child.on('exit', (code, signal) => {
    if (!stopping) { console.error(`${name} stopped (${signal || code}).`); stop(1); }
  });
  return child;
}

async function waitFor(check, name) {
  const deadline = Date.now() + 90000;
  while (!stopping && Date.now() < deadline) {
    if (await check()) return;
    await delay(250);
  }
  throw Error(`Could not start ${name}.`);
}

try {
  if (!existsSync('.env')) throw Error('Configure .env using .env.example before running Us.');
  // Refuse duplicate services instead of silently choosing different Vite ports.
  await Promise.all([5173, 5174, 5176].map(port => new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(Error(`Port ${port} is already in use. Stop the existing service, then run make run again.`)));
    server.listen(port, '0.0.0.0', () => server.close(resolve));
  })));
  start('media proxy', 'npm', ['run', 'dev:media']);
  start('browser app', 'npm', ['run', 'dev', '-w', '@us/mobile', '--', '--strictPort']);
  const tunnel = start('media tunnel', existsSync('.tools/cloudflared') ? './.tools/cloudflared' : 'cloudflared', ['tunnel', '--url', 'http://127.0.0.1:5174'], true);
  let tunnelOutput = '';
  let tunnelUrl;
  for (const stream of [tunnel.stdout, tunnel.stderr]) stream.on('data', chunk => {
    process.stdout.write(chunk);
    tunnelOutput = (tunnelOutput + chunk).slice(-16384);
    tunnelUrl ||= tunnelOutput.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/)?.[0];
  });
  await waitFor(() => tunnelUrl, 'media tunnel');
  const env = readFileSync('.env', 'utf8');
  const entry = `PUBLIC_MEDIA_BASE=${tunnelUrl}`;
  const pattern = /^[\t ]*(?:export[\t ]+)?PUBLIC_MEDIA_BASE[\t ]*=.*$/gm;
  writeFileSync('.env', pattern.test(env) ? env.replace(pattern, entry) : env + (env.endsWith('\n') ? '' : '\n') + entry + '\n');
  console.log('Updated PUBLIC_MEDIA_BASE in .env.');
  start('backend', 'npm', ['run', 'dev', '-w', '@us/web', '--', '--host', '0.0.0.0', '--strictPort']);
  await Promise.all([5173, 5174, 5176].map(port => waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}`, {signal: AbortSignal.timeout(1000)});
      await response.body?.cancel();
      return port === 5174 ? response.status === 404 : response.ok;
    } catch { return false; }
  }, `service on port ${port}`)));
  console.log(`\nUs is ready.\nComputer: http://localhost:5176\nPhone backend: http://${hostname()}:5173\nKeep this terminal open and the Mac awake. Ctrl+C stops all services.`);
} catch (error) {
  if (!stopping) { console.error(error.message); stop(1); }
}
