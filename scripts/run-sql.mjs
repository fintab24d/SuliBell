import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnv(rootDir) {
  const envPath = resolve(rootDir, '.env')
  if (!existsSync(envPath)) return
  const raw = readFileSync(envPath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (!(key in process.env)) {
      process.env[key] = val
    }
  }
}

function getProjectRef() {
  if (process.env.SUPABASE_PROJECT_REF?.trim()) {
    return process.env.SUPABASE_PROJECT_REF.trim()
  }
  const url = process.env.VITE_SUPABASE_URL?.trim() || ''
  const m = url.match(/^https?:\/\/([a-z0-9-]+)\.supabase\.co/i)
  return m ? m[1] : ''
}

async function main() {
  const rootDir = process.cwd()
  loadEnv(rootDir)

  const files = process.argv.slice(2).filter(Boolean)
  if (files.length === 0) {
    console.error('Használat: npm.cmd run sql -- supabase/update28.sql [további.sql ...]')
    process.exit(1)
  }

  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim() || ''
  if (!token) {
    console.error(
      'Hiányzik a SUPABASE_ACCESS_TOKEN a .env fájlból!\n' +
      'Hozz létre egy tokent itt: https://supabase.com/dashboard/account/tokens\n' +
      'majd add hozzá a .env fájlhoz: SUPABASE_ACCESS_TOKEN=sbp_...'
    )
    process.exit(1)
  }

  const projectRef = getProjectRef()
  if (!projectRef) {
    console.error('Nem található Supabase projekt azonosító (VITE_SUPABASE_URL vagy SUPABASE_PROJECT_REF a .env fájlban).')
    process.exit(1)
  }

  const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`

  for (const rel of files) {
    const abs = resolve(rootDir, rel)
    if (!existsSync(abs)) {
      console.error(`A fájl nem található: ${rel}`)
      process.exit(1)
    }
    const sql = readFileSync(abs, 'utf8')
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    })

    const bodyText = await res.text()
    if (!res.ok) {
      console.error(`Hiba a(z) ${rel} futtatásakor (HTTP ${res.status}):\n${bodyText}`)
      process.exit(1)
    }

    let extra = ''
    try {
      const parsed = JSON.parse(bodyText)
      if (Array.isArray(parsed) && parsed.length > 0) {
        extra = ` (${parsed.length} sor)`
      }
    } catch { /* ignore */ }

    console.log(`✓ Lefutott: ${rel}${extra}`)
  }
}

main().catch(err => {
  console.error('Váratlan hiba:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
