const express = require('express')
const fs = require('fs')
const path = require('path')

const app = express()
const PORT = 3456
const DATA_FILE = path.join(__dirname, 'data.json')

app.use(express.json())

// 初始化数据文件
function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) }
  catch { return [] }
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

// 接收上报
app.post('/api/v2/telemetry/ping', (req, res) => {
  const data = loadData()
  const info = {
    ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '',
    hostname: req.body.hostname || '',
    port: req.body.port || '',
    platform: req.body.platform || '',
    ts: Date.now(),
    ua: req.headers['user-agent'] || '',
  }
  // 找相同 IP 的已有记录
  const existing = data.find(d => d.ip === info.ip)
  if (existing) {
    existing.lastSeen = info.ts
    existing.hostname = info.hostname || existing.hostname
    existing.port = info.port || existing.port
    existing.platform = info.platform || existing.platform
    existing.count = (existing.count || 1) + 1
    existing.ua = info.ua || existing.ua
  } else {
    info.firstSeen = info.ts
    info.lastSeen = info.ts
    info.count = 1
    data.push(info)
  }
  saveData(data)
  res.json({ code: 0 })
})

// H5 仪表盘
app.get('/api/v2/telemetry/status', (req, res) => {
  const data = loadData()
  res.json({ code: 0, data: data.sort((a, b) => b.lastSeen - a.lastSeen) })
})

// 静态页面
app.use('/', express.static(path.join(__dirname, 'public')))

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[monitor] running on port ${PORT}`)
})
