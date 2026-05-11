#!/usr/bin/env node

const assert = require('assert/strict');

const {
  API_BASE_URL_KEY,
  selectLocalApiBaseUrl,
  setDotEnvValue,
} = require('./dev_launcher');

const nextUrl = 'http://192.168.1.44:8000';

assert.equal(
  setDotEnvValue('', API_BASE_URL_KEY, nextUrl),
  `${API_BASE_URL_KEY}=${nextUrl}\n`,
);

assert.equal(
  setDotEnvValue('FOO=bar', API_BASE_URL_KEY, nextUrl),
  `FOO=bar\n${API_BASE_URL_KEY}=${nextUrl}\n`,
);

assert.equal(
  setDotEnvValue(`FOO=bar\n${API_BASE_URL_KEY}=http://192.168.1.10:8000\n`, API_BASE_URL_KEY, nextUrl),
  `FOO=bar\n${API_BASE_URL_KEY}=${nextUrl}\n`,
);

assert.equal(
  setDotEnvValue(`# ${API_BASE_URL_KEY}=http://192.168.1.10:8000\n`, API_BASE_URL_KEY, nextUrl),
  `# ${API_BASE_URL_KEY}=http://192.168.1.10:8000\n${API_BASE_URL_KEY}=${nextUrl}\n`,
);

assert.deepEqual(
  selectLocalApiBaseUrl({ port: '8000', urls: ['http://10.0.0.5:8000'] }),
  {
    apiBaseUrl: 'http://10.0.0.5:8000',
    hasLanUrl: true,
    lanUrls: ['http://10.0.0.5:8000'],
  },
);

assert.deepEqual(
  selectLocalApiBaseUrl({ port: '8000', urls: [] }),
  {
    apiBaseUrl: 'http://127.0.0.1:8000',
    hasLanUrl: false,
    lanUrls: [],
  },
);

console.log('dev_launcher env helper tests: PASSED');
