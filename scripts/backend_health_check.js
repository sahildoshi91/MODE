#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');

const DEFAULT_PORT = '8000';
const HEALTH_PATH = '/healthz';
const START_COMMAND = 'cd backend && ./venv/bin/python main.py';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--base-url') {
      args.baseUrl = argv[index + 1] || null;
      index += 1;
    } else if (value === '--timeout-ms') {
      args.timeoutMs = Number.parseInt(argv[index + 1] || '', 10);
      index += 1;
    }
  }
  return args;
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '') || null;
}

function parseDotEnvValue(filePath, key) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const name = trimmed.slice(0, separatorIndex).trim();
    if (name !== key) {
      continue;
    }
    return trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return null;
}

function configuredBaseUrl(args) {
  return normalizeBaseUrl(
    args.baseUrl
    || process.env.EXPO_PUBLIC_API_BASE_URL
    || parseDotEnvValue(path.join(process.cwd(), '.env'), 'EXPO_PUBLIC_API_BASE_URL'),
  );
}

function portFromBaseUrl(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    return parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  } catch (_error) {
    return DEFAULT_PORT;
  }
}

function lanBaseUrls(port) {
  const interfaces = os.networkInterfaces();
  const urls = [];
  Object.values(interfaces).forEach((addresses) => {
    (addresses || []).forEach((address) => {
      if (address?.family !== 'IPv4' || address.internal) {
        return;
      }
      if (/^(10\.|172\.(1[6-9]|2\d|3[0-1])\.|192\.168\.)/.test(address.address)) {
        urls.push(`http://${address.address}:${port}`);
      }
    });
  });
  return urls;
}

function candidateBaseUrls(args) {
  const configured = configuredBaseUrl(args);
  const port = portFromBaseUrl(configured || `http://127.0.0.1:${DEFAULT_PORT}`);
  const candidates = [
    configured,
    ...lanBaseUrls(port),
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ];
  return candidates.filter((candidate, index) => (
    candidate && candidates.indexOf(candidate) === index
  ));
}

function requestHealth(baseUrl, timeoutMs) {
  return new Promise((resolve) => {
    const url = new URL(`${baseUrl}${HEALTH_PATH}`);
    const client = url.protocol === 'https:' ? https : http;
    const startedAt = Date.now();
    const request = client.request(url, { method: 'GET', timeout: timeoutMs }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          baseUrl,
          url: url.toString(),
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          body: Buffer.concat(chunks).toString('utf8').slice(0, 120),
          durationMs: Date.now() - startedAt,
        });
      });
    });
    request.on('timeout', () => {
      request.destroy(new Error(`timed out after ${timeoutMs}ms`));
    });
    request.on('error', (error) => {
      resolve({
        baseUrl,
        url: url.toString(),
        ok: false,
        status: null,
        error: error?.message || String(error),
        durationMs: Date.now() - startedAt,
      });
    });
    request.end();
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const timeoutMs = Number.isFinite(args.timeoutMs) && args.timeoutMs > 0 ? args.timeoutMs : 1800;
  const candidates = candidateBaseUrls(args);
  console.log('MODE backend health check');
  console.log(`Configured API base: ${configuredBaseUrl(args) || 'n/a'}`);
  console.log(`Probe path: ${HEALTH_PATH}`);

  const results = [];
  for (const baseUrl of candidates) {
    // Keep probes sequential so the output matches the attempted order.
    // eslint-disable-next-line no-await-in-loop
    const result = await requestHealth(baseUrl, timeoutMs);
    results.push(result);
    const status = result.ok ? 'OK' : 'FAIL';
    const detail = result.ok ? `${result.status} ${result.body}` : (result.error || `HTTP ${result.status}`);
    console.log(`- ${status} ${result.url} (${result.durationMs}ms) ${detail}`);
  }

  const reachable = results.filter((result) => result.ok);
  if (reachable.length > 0) {
    console.log(`Reachable backend: ${reachable[0].baseUrl}`);
    process.exit(0);
  }

  console.error('\nNo reachable MODE backend found.');
  console.error('Start it with:');
  console.error(`  ${START_COMMAND}`);
  console.error('Then tap Retry in the app or run:');
  console.error('  npm run backend:check');
  process.exit(1);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
