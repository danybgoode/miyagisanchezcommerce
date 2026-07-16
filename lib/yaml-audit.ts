import { readFile } from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'

export type YamlOffense = {
  filePath: string
  message: string
}

// The deploy-critical canonical files — NOT a directory scan. `cloudbuild.yaml` is checked because a
// malformed one breaks the Cloud Build deploy pipeline (the raw-color guard's own precedent for
// treating a specific high-stakes file differently from a broad sweep). `.worktrees/**/cloudbuild.yaml`
// are worktree copies of the same file, not canonical — deliberately excluded so a stale/in-progress
// worktree can never fail this repo's own gate.
export const canonicalYamlFiles = ['cloudbuild.yaml']

/**
 * Does each canonical YAML file parse as well-formed YAML? A pure structural check — not style, not
 * GitHub-Actions semantics (that's actionlint's job, wired as its own advisory workflow). This exists
 * because a malformed `cloudbuild.yaml` fails silently until the next deploy attempt; nothing in
 * `tsc`/`next build`/Playwright would ever catch it.
 */
export async function findYamlParseOffenders(repoRoot: string, files: string[] = canonicalYamlFiles): Promise<YamlOffense[]> {
  return findYamlParseOffendersInFiles(
    await Promise.all(files.map(async (filePath) => ({
      filePath,
      content: await readFile(path.join(repoRoot, filePath), 'utf8'),
    }))),
  )
}

export function findYamlParseOffendersInFiles(files: { filePath: string; content: string }[]): YamlOffense[] {
  const offenders: YamlOffense[] = []

  for (const file of files) {
    try {
      yaml.load(file.content)
    } catch (err) {
      offenders.push({
        filePath: file.filePath,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return offenders
}

export function formatYamlOffense(offense: YamlOffense) {
  return `${offense.filePath}: ${offense.message}`
}
