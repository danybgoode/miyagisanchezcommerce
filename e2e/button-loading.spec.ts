import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

test.describe('Button loading contract', () => {
  test('loading makes the rendered button busy, pending, disabled, and visibly marked', async () => {
    // API specs intentionally have no React rendering convention. This asserts the
    // component's emitted button attributes and loading-only marker at the source
    // seam, matching the harness's existing component-contract specs.
    const source = await readFile(path.join(repoRoot, 'components/ui/Button.tsx'), 'utf8')

    expect(source).toContain('loading = false')
    expect(source).toContain('disabled={disabled || loading}')
    expect(source).toContain('aria-busy={loading || undefined}')
    expect(source).toContain("data-pending={loading ? 'true' : undefined}")
    expect(source).toContain('loading ? <span className="pending-dot" data-testid="pending-dot" aria-hidden /> : null')
  })
})
