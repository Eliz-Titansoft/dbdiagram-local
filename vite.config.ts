import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'node:fs'
import path from 'node:path'

// Serves one DBML file from disk at /__dbml while `npm run dev` runs, and tells the page
// to reload it when the file changes. Set DBML_FILE to the file's path. Without it the
// page starts with the sample and the file picker.
function dbmlFile(): Plugin {
  const file = process.env.DBML_FILE ? path.resolve(process.env.DBML_FILE) : null
  return {
    name: 'dbml-file',
    configureServer(server) {
      server.middlewares.use('/__dbml', (_req, res) => {
        if (!file || !fs.existsSync(file)) {
          res.statusCode = 404
          res.end('DBML_FILE is not set or does not exist')
          return
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.setHeader('X-Dbml-File', file)
        res.end(fs.readFileSync(file, 'utf8'))
      })
      if (file) {
        server.watcher.add(file)
        server.watcher.on('change', (changed) => {
          if (path.resolve(changed) === file) server.ws.send({ type: 'custom', event: 'dbml:changed' })
        })
      }
    },
  }
}

// GitHub Pages serves a project site under /<repo>/, so the Pages build sets BASE_PATH.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [vue(), dbmlFile()],
})
