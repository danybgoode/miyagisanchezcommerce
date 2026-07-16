import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import {
  findYamlParseOffenders,
  findYamlParseOffendersInFiles,
  formatYamlOffense,
} from '../lib/yaml-audit'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

test.describe('YAML integrity guard', () => {
  test('the canonical deploy-critical YAML files (cloudbuild.yaml) parse cleanly', async () => {
    const offenders = await findYamlParseOffenders(repoRoot)
    expect(offenders.map(formatYamlOffense)).toEqual([])
  })

  test('negative fixture: malformed YAML goes red', () => {
    const offenders = findYamlParseOffendersInFiles([
      { filePath: 'cloudbuild.yaml', content: 'steps:\n  - name: gcr.io/cloud-builders/docker\n    args: [\n' },
    ])
    expect(offenders).toHaveLength(1)
    expect(offenders[0].filePath).toBe('cloudbuild.yaml')
  })

  test('positive fixture: well-formed YAML stays green', () => {
    const offenders = findYamlParseOffendersInFiles([
      { filePath: 'cloudbuild.yaml', content: 'steps:\n  - name: gcr.io/cloud-builders/docker\n    args: ["build", "."]\n' },
    ])
    expect(offenders).toEqual([])
  })
})
