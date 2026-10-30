import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // builder-old/ and temp/ are stale, untracked local leftovers.
  { ignores: ['dist/**', 'coverage/**', 'builder-old/**', 'temp/**'] },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    // Config files are plain JS — no type information.
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
