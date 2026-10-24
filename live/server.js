const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = Number(process.env.PORT) || 3100
const HOST = process.env.HOST || '127.0.0.1'
const DATA_FILE = process.env.DATA_FILE || '/var/www/obarco-live/data.json'
const API_KEY = process.env.OBARCO_API_KEY || ''

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'X-API-Key, Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  // POST /api/position — receive data from boat
  if (req.method === 'POST' && req.url === '/api/position') {
    if (req.headers['x-api-key'] !== API_KEY) {
      res.writeHead(401); res.end('Unauthorized'); return
    }
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      try {
        JSON.parse(body) // validate JSON
        fs.writeFileSync(DATA_FILE, body)
        res.writeHead(200); res.end('OK')
      } catch (e) {
        res.writeHead(400); res.end('Invalid JSON')
      }
    })
    return
  }

  // GET /api/position — serve latest data
  if (req.method === 'GET' && req.url === '/api/position') {
    try {
      const data = fs.readFileSync(DATA_FILE, 'utf8')
      res.setHeader('Content-Type', 'application/json')
      res.writeHead(200); res.end(data)
    } catch (e) {
      res.writeHead(404); res.end('{}')
    }
    return
  }

  res.writeHead(404); res.end('Not found')
})

server.listen(PORT, HOST, () => {
  console.log(`obarco-live listening on ${HOST}:${PORT}`)
})
