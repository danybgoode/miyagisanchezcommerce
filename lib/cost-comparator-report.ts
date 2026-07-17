/**
 * lib/cost-comparator-report.ts
 *
 * Comparador de costos (epic 08 · cost-comparator-homepage, Sprint 2 · US-2.1) — the
 * PURE report-markdown generator. Next-free/`server-only`-free, same discipline as
 * `lib/cost-comparator.ts` (this file's header explains why: the Playwright `api`
 * runner imports these directly, no framework in the require graph), so a unit spec
 * can hand it a fixed `StackedCost` pair + a fixed sources list and assert the EXACT
 * resulting markdown string byte-for-byte — no `Date.now()`, no randomness, nothing
 * the caller didn't pass in.
 *
 * Consumed by `ComparadorTool`'s "Exportar reporte" button, which builds this
 * markdown from the live on-screen stacks then pipes it through
 * `lib/smalldocs.ts` (client-only: compress + base64url into the `#md=` hash) to
 * open it on smalldocs.org. This file never touches compression or the URL — it
 * only ever returns a markdown string, which is what makes it unit-testable at all.
 *
 * Format decisions (verified against github.com/espressoplease/smalldocs,
 * 2026-07-17 — README.md + chart-gallery.md + CLI.md):
 *   - YAML front matter with a `styles.chart.accent` key set to Miyagi's brand
 *     green (`#1d6f42`, `--color-accent` in app/globals.css) — the documented
 *     `styles:` front-matter shape (CLI.md → "SmallDocs — Styles Schema").
 *   - A ```chart fenced block with a `"type":"bar"` payload — the exact JSON shape
 *     documented in chart-gallery.md's "Bar Charts" section (labels + values +
 *     format:"currency").
 *   - Story order: current spend → Miyagi equivalent → estimated saving → chart →
 *     suggested next step → sources (epic README + sprint-2.md acceptance).
 */

import type { StackedCost } from './cost-comparator'
import { formatMxn } from './cost-comparator'

/** Miyagi's brand accent green (`--color-accent`, app/globals.css) — used as the
 * smalldocs chart accent so the exported report's bar chart matches the brand. */
const REPORT_CHART_ACCENT = '#1d6f42'

export interface ComparatorReportSource {
  label: string
  source: string
  verifiedAt: string
}

export interface ComparatorReportInput {
  /** Human label for the competitor side, e.g. "Shopify (Plan Basic)". */
  platformLabel: string
  volumeMonthly: number
  aovMxn: number
  competitorStack: StackedCost
  miyagiStack: StackedCost
  /** The comparator dataset's overall verified date (`dataset.generatedAt`, ISO). */
  datasetVerifiedAt: string
  /** Every sourced figure that fed the two stacks above, deduped by figure —
   * caller-supplied (see `lib/cost-comparator-dataset.ts`'s `lineSourceFigureKey` +
   * `dataset.figures`) so this file stays a pure function of plain data. */
  sources: ComparatorReportSource[]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function lineList(stack: StackedCost): string {
  return stack.lines.map((l) => `- ${l.label}: ${formatMxn(l.monthlyMxn)}/mes`).join('\n')
}

function sourcesList(sources: ComparatorReportSource[]): string {
  if (sources.length === 0) {
    return '_Sin cifras de terceros en esta comparación — todo es cálculo derivado._'
  }
  return sources.map((s) => `- **${s.label}** — ${s.source} (verificado: ${s.verifiedAt})`).join('\n')
}

/** Deterministic: same input → byte-identical output, always. No wall-clock read. */
export function buildComparatorReportMarkdown(input: ComparatorReportInput): string {
  const { platformLabel, volumeMonthly, aovMxn, competitorStack, miyagiStack, datasetVerifiedAt, sources } = input

  const savingMonthlyMxn = round2(competitorStack.monthlyTotalMxn - miyagiStack.monthlyTotalMxn)
  const savingAnnualMxn = round2(competitorStack.annualTotalMxn - miyagiStack.annualTotalMxn)

  const chart = {
    type: 'bar',
    title: 'Costo mensual: hoy vs. Miyagi Sánchez',
    labels: [platformLabel, 'Miyagi Sánchez'],
    values: [competitorStack.monthlyTotalMxn, miyagiStack.monthlyTotalMxn],
    format: 'currency',
  }

  return `---
title: "Comparador de costos: ${platformLabel} vs. Miyagi Sánchez"
styles:
  chart:
    accent: "${REPORT_CHART_ACCENT}"
---

# Comparador de costos: ${platformLabel} vs. Miyagi Sánchez

Comparación generada en miyagisanchez.com/comparador — ${volumeMonthly} ventas/mes a un ticket promedio de ${formatMxn(aovMxn)}. Datos verificados: ${datasetVerifiedAt}.

## Lo que pagas hoy (${platformLabel})

${lineList(competitorStack)}

**Total mensual:** ${formatMxn(competitorStack.monthlyTotalMxn)} · **Total anual:** ${formatMxn(competitorStack.annualTotalMxn)}

## Equivalente en Miyagi Sánchez (0% comisión)

${lineList(miyagiStack)}

**Total mensual:** ${formatMxn(miyagiStack.monthlyTotalMxn)} · **Total anual:** ${formatMxn(miyagiStack.annualTotalMxn)}

## Ahorro estimado

**${formatMxn(savingMonthlyMxn)}/mes** — **${formatMxn(savingAnnualMxn)}/año**

\`\`\`chart
${JSON.stringify(chart)}
\`\`\`

## Siguiente paso sugerido

Migrar de ${platformLabel} a Miyagi Sánchez no cuesta comisión y tus apps premium ya vienen incluidas. Visita miyagisanchez.com/vende para empezar, o pídele a tu agente de IA que revise miyagisanchez.com/agent para automatizar la configuración de tu tienda.

## Fuentes

${sourcesList(sources)}

---

_Generado con el [Comparador de costos — Miyagi Sánchez](https://miyagisanchez.com/comparador). Las tarifas cambian: confírmalas antes de decidir._
`
}
