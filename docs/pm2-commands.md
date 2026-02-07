# PM2 管理命令文档

## 📋 概述

本文档包含所有使用 PM2 管理 `backpack-balance` 服务的命令。

## 🚀 快速启动

### 方式一：使用简化脚本（推荐）

```bash
# 启动
node start-rebalancer.js start

# 停止
node start-rebalancer.js stop

# 重启
node start-rebalancer.js restart

# 查看日志
node start-rebalancer.js logs

# 查看状态
node start-rebalancer.js status

# 删除进程
node start-rebalancer.js delete
```

### 方式二：使用 npm 脚本

```bash
# 启动
npm run rebalancer:start

# 停止
npm run rebalancer:stop

# 重启
npm run rebalancer:restart

# 查看日志
npm run rebalancer:logs

# 查看状态
npm run rebalancer:status
```

### 方式三：直接使用 PM2 命令

```bash
# 启动
pm2 start ecosystem.config.js --only backpack-balance

# 停止
pm2 stop backpack-balance

# 重启
pm2 restart backpack-balance

# 查看日志
pm2 logs backpack-balance

# 查看状态
pm2 status backpack-balance

# 删除进程
pm2 delete backpack-balance
```

## 📊 常用 PM2 命令

### 进程管理

```bash
# 查看所有进程状态
pm2 status

# 查看详细信息
pm2 show backpack-balance

# 监控面板（实时查看 CPU、内存等）
pm2 monit

# 保存当前进程列表（开机自启需要）
pm2 save

# 设置开机自启
pm2 startup

# 重新加载配置（零停机时间）
pm2 reload backpack-balance

# 清空所有日志
pm2 flush
```

### 日志管理

```bash
# 查看实时日志
pm2 logs backpack-balance

# 查看最近 100 行日志
pm2 logs backpack-balance --lines 100

# 查看错误日志
pm2 logs backpack-balance --err

# 查看输出日志
pm2 logs backpack-balance --out

# 清空日志
pm2 flush backpack-balance
```

### 性能监控

```bash
# 实时监控
pm2 monit

# 查看进程信息
pm2 describe backpack-balance

# 查看资源使用情况
pm2 list
```

## 🔧 配置文件说明

PM2 配置文件：`ecosystem.config.js`

```javascript
{
  name: 'backpack-balance',        // 进程名称
  script: './balance-rebalancer.js', // 启动脚本
  instances: 1,                      // 实例数量
  autorestart: true,                 // 自动重启
  watch: false,                      // 文件监听
  max_memory_restart: '500M',        // 内存限制
  error_file: './logs/backpack-balance-error.log',  // 错误日志
  out_file: './logs/backpack-balance-out.log'       // 输出日志
}
```

## 📝 日志文件位置

- **错误日志**: `logs/backpack-balance-error.log`
- **输出日志**: `logs/backpack-balance-out.log`

## ⚠️ 注意事项

1. **首次使用前**：确保已安装 PM2
   ```bash
   npm install -g pm2
   ```

2. **开机自启**：如需开机自启，执行：
   ```bash
   pm2 save
   pm2 startup
   ```

3. **环境变量**：确保 `.env` 文件已正确配置：
   - `ACCOUNT_1_API_KEY`
   - `ACCOUNT_1_PRIVATE_KEY`
   - `ACCOUNT_2_API_KEY`
   - `ACCOUNT_2_PRIVATE_KEY`

4. **日志轮转**：建议定期清理日志文件，或使用 PM2 的日志轮转功能：
   ```bash
   pm2 install pm2-logrotate
   ```

## 🐛 故障排查

### 进程无法启动

```bash
# 检查 PM2 是否安装
pm2 --version

# 查看详细错误信息
pm2 logs backpack-balance --err --lines 50
```

### 进程意外停止

```bash
# 查看进程状态
pm2 status backpack-balance

# 查看错误日志
pm2 logs backpack-balance --err

# 手动重启
pm2 restart backpack-balance
```

### 内存占用过高

```bash
# 查看内存使用
pm2 monit

# 如果超过限制，PM2 会自动重启（配置中 max_memory_restart: '500M'）
```

## ❓ 常见日志说明

### dotenv 提示信息

若日志中出现类似：

```
[dotenv@17.2.3] injecting env (41) from .env
tip: 🛠️  run anywhere with `dotenvx run -- yourcommand`
tip: ⚙️  write to custom object with { processEnv: myObject }
tip: ⚙️  enable debug logging with { debug: true }
```

**含义：**

- **injecting env (41) from .env**：dotenv 从 `.env` 文件加载了 41 个环境变量到 `process.env`，属于正常行为。
- **tip: ...**：dotenv 17 自带的说明/推广文案，不影响功能。

**如何关闭：** 在代码里使用 `require('dotenv').config({ quiet: true })`，已在本项目的 `balance-rebalancer.js` 中启用，重启后这些提示会消失。

**若出现多次：** 可能是 PM2 重启或多次加载 dotenv，只要进程正常运行即可忽略。

## 📚 更多信息

- [PM2 官方文档](https://pm2.keymetrics.io/docs/usage/quick-start/)
- [PM2 中文文档](https://pm2.fenxianglu.cn/)
