import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'node:fs'

const OVERRIDES_PATH = path.resolve(__dirname, '../data/prediction_speaker_overrides.json')

/**
 * Dev-only plugin: exposes a local API for reading/writing speaker overrides.
 * Only active during `vite dev` — not included in production builds.
 *
 * GET  /api/speaker-overrides  → returns current overrides object
 * POST /api/speaker-overrides  → { prediction_id, speaker } — saves an override
 */
function speakerOverridesPlugin(): Plugin {
  return {
    name: 'speaker-overrides',
    configureServer(server) {
      server.middlewares.use('/api/speaker-overrides', (req: any, res: any) => {
        if (req.method === 'GET') {
          const data = fs.existsSync(OVERRIDES_PATH)
            ? fs.readFileSync(OVERRIDES_PATH, 'utf-8')
            : '{}'
          res.setHeader('Content-Type', 'application/json')
          res.end(data)
          return
        }

        if (req.method === 'POST') {
          let body = ''
          req.on('data', (chunk: Buffer) => { body += chunk.toString() })
          req.on('end', () => {
            try {
              const { prediction_id, speaker } = JSON.parse(body) as {
                prediction_id: string
                speaker: string
              }
              const existing: Record<string, string> = fs.existsSync(OVERRIDES_PATH)
                ? JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf-8'))
                : {}
              existing[prediction_id] = speaker
              fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(existing, null, 2))
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true }))
            } catch (err) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: String(err) }))
            }
          })
          return
        }

        res.statusCode = 405
        res.end()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), speakerOverridesPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
