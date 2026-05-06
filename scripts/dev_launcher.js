#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const {
  DEFAULT_PORT,
  HEALTH_PATH,
  candidateBaseUrls,
  lanBaseUrls,
  requestHealth,
} = require('./backend_health_check');

const ROOT_DIR = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(ROOT_DIR, 'backend');
const ENV_PATH = path.join(ROOT_DIR, '.env');
const API_BASE_URL_KEY = 'EXPO_PUBLIC_API_BASE_URL';
const DEFAULT_EXPO_PORT = '8081';
const DEFAULT_HEALTH_TIMEOUT_MS = 1800;
const DEFAULT_BACKEND_START_TIMEOUT_MS = 30000;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--expo-port') {
      args.expoPort = argv[index + 1] || null;
      index += 1;
    } else if (value === '--health-timeout-ms') {
      args.healthTimeoutMs = Number.parseInt(argv[index + 1] || '', 10);
      index += 1;
    } else if (value === '--backend-start-timeout-ms') {
      args.backendStartTimeoutMs = Number.parseInt(argv[index + 1] || '', 10);
      index += 1;
    }
  }
  return args;
}

function setDotEnvValue(contents, key, value) {
  const text = String(contents || '');
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const replacement = `${key}=${value}`;
  let replaced = false;

  const lines = text.split(/\r?\n/).map((line) => {
    const trimmedStart = line.trimStart();
    if (!trimmedStart || trimmedStart.startsWith('#')) {
      return line;
    }

    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*)=/);
    if (match?.[2] !== key) {
      return line;
    }

    replaced = true;
    return `${match[1]}${replacement}`;
  });

  if (replaced) {
    return lines.join(newline);
  }

  if (!text) {
    return `${replacement}${newline}`;
  }

  const suffix = text.endsWith('\n') ? '' : newline;
  return `${text}${suffix}${replacement}${newline}`;
}

function updateDotEnvValue(filePath, key, value) {
  const currentContents = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const nextContents = setDotEnvValue(currentContents, key, value);
  if (nextContents === currentContents) {
    return { changed: false, filePath, value };
  }

  fs.writeFileSync(filePath, nextContents);
  return { changed: true, filePath, value };
}

function selectLocalApiBaseUrl({ port = DEFAULT_PORT, urls = lanBaseUrls(port) } = {}) {
  const [lanUrl] = urls;
  return {
    apiBaseUrl: lanUrl || `http://127.0.0.1:${port}`,
    hasLanUrl: Boolean(lanUrl),
    lanUrls: [...urls],
  };
}

function backendPythonCommand() {
  const executable = process.platform === 'win32' ? 'python.exe' : 'python';
  const venvPath = process.platform === 'win32'
    ? path.join(BACKEND_DIR, 'venv', 'Scripts', executable)
    : path.join(BACKEND_DIR, 'venv', 'bin', executable);
  return fs.existsSync(venvPath) ? venvPath : 'python3';
}

function npxCommand() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function probeBackendCandidates({ timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS, log = false } = {}) {
  const candidates = candidateBaseUrls({}, ROOT_DIR);
  const results = [];

  if (log) {
    console.log(`Probe path: ${HEALTH_PATH}`);
  }

  for (const baseUrl of candidates) {
    // Keep probes sequential so the first reachable backend is deterministic.
    // eslint-disable-next-line no-await-in-loop
    const result = await requestHealth(baseUrl, timeoutMs);
    results.push(result);

    if (log) {
      const status = result.ok ? 'OK' : 'FAIL';
      const detail = result.ok ? `${result.status} ${result.body}` : (result.error || `HTTP ${result.status}`);
      console.log(`- ${status} ${result.url} (${result.durationMs}ms) ${detail}`);
    }
  }

  return {
    results,
    reachableBackend: results.find((result) => result.ok) || null,
  };
}

async function waitForReachableBackend({ timeoutMs, healthTimeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  process.stdout.write('Waiting for backend health');

  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const { reachableBackend } = await probeBackendCandidates({ timeoutMs: healthTimeoutMs });
    if (reachableBackend) {
      process.stdout.write('\n');
      return reachableBackend;
    }

    process.stdout.write('.');
    // eslint-disable-next-line no-await-in-loop
    await delay(750);
  }

  process.stdout.write('\n');
  return null;
}

function spawnTracked(children, command, args, options) {
  const child = spawn(command, args, options);
  children.add(child);
  child.once('exit', () => {
    children.delete(child);
  });
  return child;
}

function stopChildren(children) {
  for (const child of children) {
    if (!child.killed && child.exitCode === null) {
      child.kill('SIGTERM');
    }
  }
}

function exitCodeFromSignal(signal) {
  if (signal === 'SIGINT') {
    return 130;
  }
  if (signal === 'SIGTERM') {
    return 143;
  }
  return 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const expoPort = args.expoPort || process.env.EXPO_PORT || DEFAULT_EXPO_PORT;
  const healthTimeoutMs = Number.isFinite(args.healthTimeoutMs) && args.healthTimeoutMs > 0
    ? args.healthTimeoutMs
    : DEFAULT_HEALTH_TIMEOUT_MS;
  const backendStartTimeoutMs = Number.isFinite(args.backendStartTimeoutMs) && args.backendStartTimeoutMs > 0
    ? args.backendStartTimeoutMs
    : DEFAULT_BACKEND_START_TIMEOUT_MS;
  const children = new Set();
  let shuttingDown = false;

  const shutdown = (code = 0) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    stopChildren(children);
    process.exit(code);
  };

  process.on('SIGINT', () => shutdown(130));
  process.on('SIGTERM', () => shutdown(143));
  process.on('exit', () => stopChildren(children));

  console.log('MODE dev launcher');

  const selectedApiBase = selectLocalApiBaseUrl();
  process.env[API_BASE_URL_KEY] = selectedApiBase.apiBaseUrl;
  const envUpdate = updateDotEnvValue(ENV_PATH, API_BASE_URL_KEY, selectedApiBase.apiBaseUrl);
  const envAction = envUpdate.changed ? 'updated' : 'already set';
  console.log(`${API_BASE_URL_KEY} ${envAction}: ${selectedApiBase.apiBaseUrl}`);
  if (!selectedApiBase.hasLanUrl) {
    console.warn(`No LAN IP detected; using simulator-safe loopback ${selectedApiBase.apiBaseUrl}.`);
  }

  console.log('\nBackend reachability');
  let { reachableBackend } = await probeBackendCandidates({ timeoutMs: healthTimeoutMs, log: true });

  if (!reachableBackend) {
    console.log('\nNo reachable backend found. Starting FastAPI backend...');
    const backendChild = spawnTracked(
      children,
      backendPythonCommand(),
      ['main.py'],
      {
        cwd: BACKEND_DIR,
        stdio: 'inherit',
        env: {
          ...process.env,
          [API_BASE_URL_KEY]: selectedApiBase.apiBaseUrl,
        },
      },
    );
    backendChild.once('error', (error) => {
      console.error(`Backend failed to start: ${error?.message || String(error)}`);
      shutdown(1);
    });
    backendChild.once('exit', (code, signal) => {
      if (!shuttingDown) {
        console.error(`Backend stopped unexpectedly (${signal || code}).`);
        shutdown(code || exitCodeFromSignal(signal));
      }
    });

    reachableBackend = await waitForReachableBackend({
      timeoutMs: backendStartTimeoutMs,
      healthTimeoutMs,
    });
  }

  if (!reachableBackend) {
    console.error(`Backend did not become reachable within ${backendStartTimeoutMs}ms.`);
    shutdown(1);
    return;
  }

  console.log(`Reachable backend: ${reachableBackend.baseUrl}`);
  console.log(`\nStarting Expo on port ${expoPort} with cache clear...`);
  const expoChild = spawnTracked(
    children,
    npxCommand(),
    ['expo', 'start', '-c', '--port', String(expoPort)],
    {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      env: {
        ...process.env,
        [API_BASE_URL_KEY]: selectedApiBase.apiBaseUrl,
      },
    },
  );

  expoChild.once('error', (error) => {
    console.error(`Expo failed to start: ${error?.message || String(error)}`);
    shutdown(1);
  });
  expoChild.once('exit', (code, signal) => {
    if (!shuttingDown) {
      shutdown(code || exitCodeFromSignal(signal));
    }
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  API_BASE_URL_KEY,
  DEFAULT_EXPO_PORT,
  parseArgs,
  selectLocalApiBaseUrl,
  setDotEnvValue,
  updateDotEnvValue,
};
