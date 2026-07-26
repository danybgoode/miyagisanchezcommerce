#!/usr/bin/env node
// lint-changed.mjs — lint the files THIS branch touched, not the whole tree.
//
// ── Why this exists, and why it is not a weaker gate ──────────────────────────────────────────
// Our Definition of Done has said "type-check + lint + build clean" for months while CI never ran
// lint. Wiring the full-tree `npm run lint` into CI was the obvious fix and it does not work: a clean
// checkout reports **238 problems, 124 of them errors**, and NONE are auto-fixable (measured
// 2026-07-26). The breakdown is what decides the design:
//
//     41  @typescript-eslint/no-explicit-any
//     34  react-hooks/set-state-in-effect
//     18  react/no-unescaped-entities
//     11  react-hooks/refs
//      7  @next/next/no-html-link-for-pages
//      4  react-hooks/immutability
//      4  @typescript-eslint/no-this-alias
//      3  react-hooks/purity
//      2  @typescript-eslint/no-require-imports
//
// Fifty-two of those are React Hooks *correctness* rules firing on live commerce surfaces, and
// removing an `any` correctly means knowing each call site's real type. Fixing 124 of them in a
// config sprint would be a large, behaviour-changing diff through checkout and seller code — the
// kind of change our own build contract says to stop on rather than guess through.
//
// The alternative — downgrading the rules to warnings so a full-tree gate goes green — is worse than
// no gate: it looks enforcing while enforcing nothing, and it silently blesses the debt forever.
//
// So the gate is INCREMENTAL, which is this repo's established pattern rather than a new idea:
// `scripts/doc-format.mjs` hard-gates only the macro-sections actually swept to canonical shape
// (`ENFORCED_SWEPT_PATHS`) and keeps the rest visible-but-advisory. Same shape here — **any file you
// touch must be clean**, existing debt stays visible via the full-tree `npm run lint`, and the
// enforced set grows as the tree gets swept instead of by decree.
//
// Usage:
//   node scripts/lint-changed.mjs                # vs origin/main (CI + local default)
//   node scripts/lint-changed.mjs --base <ref>   # vs another base
//   node scripts/lint-changed.mjs --all          # the full tree (same as `npm run lint`)

import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const ALL = argv.includes('--all');
const baseIdx = argv.indexOf('--base');
const BASE = baseIdx !== -1 ? argv[baseIdx + 1] : process.env.LINT_BASE_REF || 'origin/main';

// Only file types ESLint is configured for here. A changed .json/.md/.sql must not be handed to it —
// eslint exits non-zero on an unmatched pattern, which would fail the gate for an unrelated edit.
const LINTABLE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return r.status === 0 ? (r.stdout || '').trim() : null;
}

/**
 * Files changed vs the merge-base with `base`.
 *
 * Uses the three-dot merge-base (`diff base...HEAD`) so a branch is judged on ITS OWN changes — a
 * two-dot diff would drag in everything that landed on main since the branch was cut and fail the
 * PR for other people's debt.
 *
 * Deleted files are excluded (`--diff-filter=d`): linting a path that no longer exists is an error
 * about nothing.
 */
export function changedFiles(base, run = git) {
  const mergeBase = run(['merge-base', base, 'HEAD']) || base;
  const out = run(['diff', '--name-only', '--diff-filter=d', `${mergeBase}...HEAD`]);
  if (out === null) return null; // git failed — the caller decides, we do not silently pass
  return out.split('\n').map((f) => f.trim()).filter(Boolean).filter((f) => LINTABLE.test(f));
}

function main() {
  if (ALL) {
    const r = spawnSync('npx', ['eslint', '.'], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }

  const files = changedFiles(BASE);

  // A git failure must NOT read as "nothing changed, all clean" — that is the silent-pass shape this
  // repo has been bitten by before (a script that exits green having run nothing is worse than no
  // script). Fail loudly and say why.
  if (files === null) {
    process.stderr.write(
      `lint-changed: could not diff against "${BASE}" — is it fetched?\n` +
        `  In CI, ensure the checkout has enough history (fetch-depth: 0) and that the base ref exists.\n`
    );
    process.exit(1);
  }

  if (files.length === 0) {
    process.stdout.write(`lint-changed: no lintable files changed vs ${BASE} — nothing to check.\n`);
    return;
  }

  process.stdout.write(`lint-changed: ${files.length} changed file(s) vs ${BASE}\n`);
  const r = spawnSync('npx', ['eslint', '--max-warnings', '0', ...files], { stdio: 'inherit' });
  if (r.status !== 0) {
    process.stderr.write(
      `\nlint-changed: the files this branch touched must be lint-clean.\n` +
        `  Existing tree-wide debt is NOT your problem — see \`npm run lint\` for the full picture.\n` +
        `  If a fix would change runtime behaviour, say so in the PR rather than forcing it.\n`
    );
  }
  process.exit(r.status ?? 1);
}

const isMain = process.argv[1] && process.argv[1].endsWith('lint-changed.mjs');
if (isMain) main();
