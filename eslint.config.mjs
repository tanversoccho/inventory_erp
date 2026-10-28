import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      '.venv/**',
      'data/**',
      '**/__pycache__/**',
      'static/scanner.min.js',
      'static/pair-qr.js',
    ],
  },
  {
    files: ['static/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.browser,
        Html5Qrcode: 'readonly',
      },
    },
  },
];
