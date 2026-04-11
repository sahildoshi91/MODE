const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  ...expoConfig,
  {
    ignores: [
      'backend/**',
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '**/__tests__/**',
    ],
  },
  {
    rules: {
      'import/no-unresolved': 'off',
    },
  },
]);
