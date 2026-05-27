#!/bin/bash
# ============================================
# MirrorNovel 保活脚本
# 每分钟检测三个服务是否存活，挂了自动重启
# 用法: 添加到 crontab: * * * * * /root/keepalive.sh
# ============================================

BASE_DIR="/root/fanqiexiaoshuo_$(ls -d /root/fanqiexiaoshuo_* 2>/dev/null | sort -r | head -1 | sed 's/.*fanqiexiaoshuo_//')"
LOG_FILE="/var/log/mirrornovel-keepalive.log"
DATE=$(date '+%Y-%m-%d %H:%M:%S')

# 如果目录不存在，回退到最新部署目录
[ -d "$BASE_DIR" ] || BASE_DIR=$(ls -d /root/fanqiexiaoshuo_* 2>/dev/null | sort -r | head -1)
[ -z "$BASE_DIR" ] && { echo "$DATE ERROR: 未找到项目目录" >> "$LOG_FILE"; exit 1; }

# 健康检查函数
check_and_restart() {
  local name=$1
  local port=$2
  local work_dir=$3
  local start_cmd=$4

  # 检查 HTTP 是否正常响应
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 8 "http://localhost:${port}/" 2>/dev/null || echo "000")

  if [ "$http_code" = "000" ] || [ "$http_code" = "" ]; then
    # 检查 PM2 进程是否存在
    local pm2_ok
    pm2_ok=$(pm2 pid "$name" 2>/dev/null)

    if [ -z "$pm2_ok" ] || [ "$pm2_ok" = "0" ]; then
      echo "$DATE ⚠️  $name (端口 $port) 无响应，正在重启..." >> "$LOG_FILE"
      cd "$work_dir" || { echo "$DATE ERROR: 目录不存在 $work_dir" >> "$LOG_FILE"; return; }
      pm2 delete "$name" 2>/dev/null
      eval "$start_cmd"
      pm2 save
      echo "$DATE ✅  $name 已重启" >> "$LOG_FILE"
    else
      # 进程存在但 HTTP 无响应，kill 后重启
      echo "$DATE ⚠️  $name (端口 $port) 进程存在但无响应，强制重启..." >> "$LOG_FILE"
      pm2 delete "$name" 2>/dev/null
      sleep 2
      cd "$work_dir" || return
      eval "$start_cmd"
      pm2 save
      echo "$DATE ✅  $name 已强制重启" >> "$LOG_FILE"
    fi
  fi
}

# 1. 后端 API (端口 3001)
check_and_restart "xiaoshuo-server" "3001" "${BASE_DIR}/server" \
  "pm2 start index.js --name xiaoshuo-server"

# 2. 前端页面 (端口 5173)
check_and_restart "xiaoshuo-client" "5173" "${BASE_DIR}/client" \
  "pm2 start node_modules/.bin/vite --name xiaoshuo-client -- --port 5173 --host 0.0.0.0"

# 3. 管理后台 (端口 5174)
check_and_restart "xiaoshuo-admin" "5174" "${BASE_DIR}/admin" \
  "pm2 start node_modules/.bin/vite --name xiaoshuo-admin -- --port 5174 --host 0.0.0.0"

# 4. 检查 MongoDB 容器是否运行
mongo_health=$(docker inspect --format='{{.State.Health.Status}}' jtbs-mongo 2>/dev/null || echo "dead")
if [ "$mongo_health" != "healthy" ] && [ "$mongo_health" != "running" ]; then
  echo "$DATE ⚠️  MongoDB 容器异常, 状态: $mongo_health, 重启中..." >> "$LOG_FILE"
  docker restart jtbs-mongo 2>/dev/null || {
    echo "$DATE ❌  MongoDB 重启失败, 尝试重建..." >> "$LOG_FILE"
    docker run -d --name jtbs-mongo --restart always \
      -p 127.0.0.1:27017:27017 \
      -v jt-bs_20260514223011_mongo-data:/data/db \
      -v /root/jt-bs_20260514223011/mongo-init.js:/docker-entrypoint-initdb.d/mongo-init.js:ro \
      mongo:7 2>/dev/null && echo "$DATE ✅ MongoDB 容器已重建" >> "$LOG_FILE"
  }
fi

# 5. 检查磁盘空间（不足时报警）
disk_usage=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')
if [ "$disk_usage" -gt 85 ]; then
  echo "$DATE ⚠️  磁盘使用率 ${disk_usage}%，请及时清理" >> "$LOG_FILE"
fi

# 6. 检查内存使用
mem_usage=$(free | grep Mem | awk '{printf "%.0f", $3/$2 * 100}')
if [ "$mem_usage" -gt 90 ]; then
  echo "$DATE ⚠️  内存使用率 ${mem_usage}%，建议增加内存" >> "$LOG_FILE"
fi

# 7. 清理超过7天的日志
find "$LOG_FILE" -mtime +7 -delete 2>/dev/null

echo "$DATE ✅ 健康检查完成 (server:$(pm2 pid xiaoshuo-server) client:$(pm2 pid xiaoshuo-client) admin:$(pm2 pid xiaoshuo-admin))" >> "$LOG_FILE"
