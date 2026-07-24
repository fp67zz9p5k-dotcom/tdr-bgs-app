import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

const root = join(process.cwd(), 'dist')
const port = Number(process.argv[2] ?? 5173)
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
}

createServer((request, response) => {
  const requestPath = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
  const safePath = normalize(requestPath).replace(/^(\.\.[/\\])+/, '')
  let filePath = join(root, safePath === '/' ? 'index.html' : safePath)
  if (!filePath.startsWith(root) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(root, 'index.html')
  }
  response.setHeader('Content-Type', mimeTypes[extname(filePath)] ?? 'application/octet-stream')
  response.setHeader('Cache-Control', 'no-cache')
  createReadStream(filePath).pipe(response)
}).listen(port, '0.0.0.0', () => {
  console.log(`TDR BGS図鑑: http://0.0.0.0:${port}/`)
})
