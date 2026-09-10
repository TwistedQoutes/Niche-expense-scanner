import coreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * Flat config. `eslint-config-next` ships ready-made flat config arrays, so no
 * FlatCompat shim is needed.
 */
const config = [
  {
    ignores: ['.next/**', 'node_modules/**', 'public/ocr/**', 'next-env.d.ts', 'prisma/*.db'],
  },
  ...coreWebVitals,
  ...nextTypescript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];

export default config;
