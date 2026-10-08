export type ClaimLinkCsvRow = { shopName: string; email: string; previewUrl: string | null; claimUrl: string }

function cell(value: string): string {
  // Shop names and contact emails may come from imports. Keep spreadsheet
  // programs from evaluating an imported value as a formula.
  const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

export function claimLinksCsv(rows: readonly ClaimLinkCsvRow[]): string {
  const header = ['Name', 'Email', 'Link1', 'Link2'].map(cell).join(',')
  return '\uFEFF' + [header, ...rows.map((row) =>
    [row.shopName, row.email, row.previewUrl ?? '', row.claimUrl].map(cell).join(','),
  )].join('\r\n') + '\r\n'
}
