/**
 * Commit message rules — Conventional Commits (see docs/commit-convention.md).
 *
 * Scope list is advisory (level 1 = warning, not error) so a new architectural
 * area isn't blocked before its scope is added here. Keep this list in sync
 * with the layer directories under src/.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      1,
      'always',
      [
        'datasource',
        'browse',
        'query',
        'connection',
        'secrets',
        'tui',
        'llm',
        'schema',
        'app',
        'store',
        'deps',
        'repo',
      ],
    ],
    'body-max-line-length': [1, 'always', 100],
  },
};
