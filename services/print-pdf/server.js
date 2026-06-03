/**
 * Printed-edition PDF renderer — standalone Cloud Run service (US-5b).
 *
 * Loads the (secret-gated) /admin/print/[id]/print route in headless Chromium and
 * returns a print-ready PDF honoring the page's @page size + bleed (preferCSSPageSize)
 * and the retro backgrounds (printBackground). Deliberately separate from the Medusa
 * commerce backend so Chromium can never affect orders.
 *
 * Auth: POST /pdf with header `x-internal-secret` === PRINT_PDF_SECRET, body { url }.
 */

const express = require('express')
const puppeteer = require('puppeteer-core')

const PORT = process.env.PORT || 8080
const SECRET = process.env.PRINT_PDF_SECRET || ''
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium'
const NAV_TIMEOUT = Number(process.env.NAV_TIMEOUT_MS || 90000)

const app = express()
app.use(express.json({ limit: '1mb' }))

app.get('/health', (_req, res) => res.json({ ok: true }))

app.post('/pdf', async (req, res) => {
  if (!SECRET || req.get('x-internal-secret') !== SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const url = req.body && typeof req.body.url === 'string' ? req.body.url : null
  if (!url) return res.status(400).json({ error: 'url required' })

  let browser
  try {
    browser = await puppeteer.launch({
      executablePath: CHROMIUM_PATH,
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    })
    const page = await browser.newPage()
    await page.goto(url, { waitUntil: 'networkidle0', timeout: NAV_TIMEOUT })
    // Let web fonts settle so text is crisp (vector) in the PDF.
    try { await page.evaluate(() => (document.fonts ? document.fonts.ready : null)) } catch { /* non-fatal */ }
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
    res.set('Content-Type', 'application/pdf').send(Buffer.from(pdf))
  } catch (e) {
    console.error('[print-pdf] render failed:', e)
    res.status(500).json({ error: String((e && e.message) || e) })
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
})

app.listen(PORT, () => console.log(`[print-pdf] listening on :${PORT} (chromium=${CHROMIUM_PATH})`))
