// @ts-check
import js from '@eslint/js';
import astro from 'eslint-plugin-astro';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      '.astro/',
      '.wrangler/',
      'node_modules/',
      'data/geo/raw/',
      'test-results/',
      '.design-sync/',
      '.ds-sync/',
      'ds-bundle/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...astro.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // Business logic must receive `now`; see src/shared/dates.ts.
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Pass `now` explicitly instead of calling new Date() (CLAUDE.md › Datas).',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Pass `now` explicitly instead of calling Date.now() (CLAUDE.md › Datas).',
        },
      ],
    },
  },
  {
    // End-to-end tests run against the real server clock.
    files: ['tests/e2e/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // Non-null assertions are fine in tests and in tight geometry loops with checked bounds.
    files: ['tests/**', 'src/server/services/geo-service.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
