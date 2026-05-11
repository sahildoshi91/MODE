#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  HEALTH_PATH,
  START_COMMAND,
  candidateBaseUrls,
  configuredBaseUrl,
  requestHealth,
} = require('./backend_health_check');

const ROOT_DIR = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(ROOT_DIR, 'backend');
const DEFAULT_TIMEOUT_MS = 1800;
const ROUTE_CONTRACT_TESTS = [
  'tests/test_trainer_route_surface_contract.py',
  'tests/test_chat_sessions_api.py',
];

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--timeout-ms') {
      args.timeoutMs = Number.parseInt(argv[index + 1] || '', 10);
      index += 1;
    } else if (value === '--base-url') {
      args.baseUrl = argv[index + 1] || null;
      index += 1;
    }
  }
  return args;
}

function venvTool(name, fallback) {
  const binDir = process.platform === 'win32'
    ? path.join(BACKEND_DIR, 'venv', 'Scripts')
    : path.join(BACKEND_DIR, 'venv', 'bin');
  const executable = process.platform === 'win32' && !name.endsWith('.exe')
    ? `${name}.exe`
    : name;
  const candidate = path.join(binDir, executable);
  return fs.existsSync(candidate) ? candidate : fallback;
}

function runCommand(label, command, args, options = {}) {
  console.log(`\n${label}`);
  const result = spawnSync(command, args, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    ...options,
  });
  if (result.error) {
    console.error(`${label} failed to start: ${result.error.message}`);
    return 1;
  }
  if (result.signal) {
    console.error(`${label} stopped by signal ${result.signal}`);
    return 1;
  }
  return result.status || 0;
}

async function probeBackendCandidates(args, timeoutMs) {
  const candidates = candidateBaseUrls(args, ROOT_DIR);
  console.log('\nBackend reachability');
  console.log(`Configured API base: ${configuredBaseUrl(args, ROOT_DIR) || 'n/a'}`);
  console.log(`Probe path: ${HEALTH_PATH}`);

  const results = [];
  for (const baseUrl of candidates) {
    // Keep probes sequential so the first reachable backend is deterministic.
    // eslint-disable-next-line no-await-in-loop
    const result = await requestHealth(baseUrl, timeoutMs);
    results.push(result);
    const status = result.ok ? 'OK' : 'FAIL';
    const detail = result.ok ? `${result.status} ${result.body}` : (result.error || `HTTP ${result.status}`);
    console.log(`- ${status} ${result.url} (${result.durationMs}ms) ${detail}`);
  }

  return results.find((result) => result.ok) || null;
}

function printNoBackendInstructions() {
  console.error('\nCodex prompt check failed: no reachable MODE backend found.');
  console.error('Start it with:');
  console.error('  npm run backend:dev');
  console.error('or:');
  console.error(`  ${START_COMMAND}`);
  console.error('Then tap Retry in the app and rerun:');
  console.error('  npm run codex:check');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const timeoutMs = Number.isFinite(args.timeoutMs) && args.timeoutMs > 0
    ? args.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  const pytest = venvTool('pytest', 'pytest');
  const python = venvTool('python', 'python3');

  console.log('MODE Codex prompt check');

  const routeTestStatus = runCommand(
    'Backend static route tests',
    pytest,
    ['-q', ...ROUTE_CONTRACT_TESTS],
    { cwd: BACKEND_DIR },
  );
  if (routeTestStatus !== 0) {
    return routeTestStatus;
  }

  const reachableBackend = await probeBackendCandidates(args, timeoutMs);
  if (!reachableBackend) {
    printNoBackendInstructions();
    return 1;
  }

  console.log(`Reachable backend: ${reachableBackend.baseUrl}`);
  const preflightStatus = runCommand(
    'Runtime route surface preflight',
    python,
    [
      'scripts/preflight_runtime_route_surface.py',
      '--base-url',
      reachableBackend.baseUrl,
    ],
    { cwd: BACKEND_DIR },
  );
  if (preflightStatus !== 0) {
    return preflightStatus;
  }

  console.log('\nCodex prompt check: PASSED');
  return 0;
}

main().then((status) => {
  process.exit(status);
}).catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
