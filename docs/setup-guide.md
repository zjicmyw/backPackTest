# Backpack 剥头皮交易机器人 V1.0 快速开始指南

## 🎉 V1.0 版本特性

- ✅ **智能交易系统**: 自动下单、智能平仓、连续交易
- ✅ **风险控制机制**: 持仓限制、价格控制、订单管理
- ✅ **智能订单管理**: 动态阈值、API驱动、错误处理
- ✅ **高级功能**: 百分比止盈、智能重试、详细日志

## 📋 前置要求

在开始使用 Backpack 剥头皮交易机器人之前，您需要确保新电脑满足以下要求：

### 系统要求
- **操作系统**: Windows 10/11, macOS 10.15+, 或 Ubuntu 18.04+
- **内存**: 至少 4GB RAM
- **存储**: 至少 1GB 可用空间
- **网络**: 稳定的互联网连接

### 必需软件
- **Node.js**: 版本 14.0.0 或更高
- **Git**: 用于代码管理（可选）
- **文本编辑器**: VS Code, Sublime Text 等（推荐）

---

## 🚀 快速开始

### 步骤 1: 安装 Node.js

#### Windows
1. 访问 [Node.js 官网](https://nodejs.org/)
2. 下载 LTS 版本（推荐）
3. 运行安装程序，按默认设置安装
4. 打开命令提示符，验证安装：
```bash
node --version
npm --version
```

#### macOS
```bash
# 使用 Homebrew（推荐）
brew install node

# 或者从官网下载安装包
```

#### Linux (Ubuntu/Debian)
```bash
# 使用包管理器
sudo apt update
sudo apt install nodejs npm

# 验证安装
node --version
npm --version
```

### 步骤 2: 获取项目代码

#### 方法 1: 直接下载（推荐）
1. 将项目文件夹复制到新电脑
2. 或者下载项目压缩包并解压

#### 方法 2: 使用 Git（如果有代码仓库）
```bash
git clone <your-repository-url>
cd backPackTest
```

### 步骤 3: 安装项目依赖

在项目根目录打开终端：

```bash
# 进入项目目录
cd backPackTest

# 安装依赖包
npm install
```

**预期输出**:
```
npm WARN deprecated ...
added 45 packages from 89 contributors and audited 45 packages in 3.2s
```

### 步骤 4: 配置环境变量

#### 创建配置文件
```bash
# Windows
copy bot.env.example .env

# macOS/Linux
cp bot.env.example .env
```

#### 编辑配置文件
使用文本编辑器打开 `.env` 文件，填入您的配置：

```env
# ================ API 配置 (必需) ================
BACKPACK_API_KEY=your_base64_encoded_public_key_here
BACKPACK_PRIVATE_KEY=your_base64_encoded_private_key_here

# ================ 交易配置 ================
SYMBOL=BTC_USDC_PERP
ORDER_AMOUNT=100
PROFIT_TARGET=0.0001
MAX_POSITION_VALUE=40000
TRADE_DIRECTION=buy
ORDER_WAIT_TIME=450

# ================ 手续费配置 ================
MAKER_FEE=0.0001
TAKER_FEE=0.00026
POST_ONLY=true

# ================ 日志配置 ================
LOG_LEVEL=INFO
ENABLE_CSV_LOG=true
ENABLE_FILE_LOG=true
```

### 步骤 5: 获取 Backpack API 密钥

1. **登录 Backpack Exchange**
   - 访问 [Backpack Exchange](https://backpack.exchange/)
   - 登录您的账户

2. **创建 API 密钥**
   - 进入账户设置 → API 管理
   - 点击"创建新的 API 密钥"
   - 设置适当的权限（交易、查询等）
   - **重要**: 保存好私钥，它只会显示一次

3. **配置密钥格式**
   - 确保密钥是 Base64 编码格式
   - 公钥示例: `eyJ0eXAiOiJKV1QiLCJhbGciOiJFZERTQSJ9...`
   - 私钥示例: `eyJ0eXAiOiJKV1QiLCJhbGciOiJFZERTQSJ9...`

---

## 🧪 测试安装

### 验证环境
```bash
# 检查 Node.js 版本
node --version  # 应该显示 v14.0.0 或更高

# 检查项目依赖
npm list --depth=0
```

### 测试基本功能
```bash
# 查看帮助信息
npm run bot:help

# 或者
node start-bot.js --help
```

**预期输出**:
```
🤖 Backpack 剥头皮交易机器人

使用方法:
  node start-bot.js [选项]

选项:
  --symbol <symbol>              交易对 (默认: BTC_USDC_PERP)
  --order-amount <amount>        每单金额 USDC (默认: 100)
  --profit-target <target>       净盈利比例 如0.0001=0.01% (默认: 0.0001)
  ...
```

### 测试 API 连接
```bash
# 启动机器人（测试模式）
node start-bot.js --order-amount 1 --log-level DEBUG
```

如果配置正确，您应该看到：
```
🤖 Backpack 剥头皮交易机器人
================================
交易对: BTC_USDC_PERP
每单金额: 1 USDC
净盈利比例: 0.0100% (除手续费)
...
🚀 剥头皮交易机器人启动
```

---

## 📁 项目结构说明

```
backPackTest/
├── docs/                       # 📚 文档目录
│   ├── setup-guide.md            # 本安装指南
│   ├── backpack-api-summary.md   # API 使用总结
│   ├── effective-prompts-summary.md # 开发历程
│   └── update-history.md         # 更新记录
├── logs/                       # 📝 日志目录 (自动创建)
│   ├── debug_YYYY-MM-DD.log      # 调试日志
│   └── trades_YYYY-MM-DD.csv     # 交易记录
├── backpack-client.js          # 🔌 API 客户端
├── scalping-bot.js             # 🤖 核心机器人逻辑
├── start-bot.js                # 🚀 启动脚本
├── bot-config.js               # ⚙️ 配置管理
├── package.json                # 📦 项目配置
├── bot.env.example             # 📋 环境变量示例
├── .env                        # 🔐 您的实际配置 (需要创建)
└── README.md                   # 📖 项目说明
```

---

## 🔧 常见问题解决

### Q1: Node.js 版本过低
**错误**: `Error: Node.js version 12.x.x is not supported`

**解决方案**:
```bash
# 更新 Node.js 到最新 LTS 版本
# Windows: 重新下载安装包
# macOS: brew upgrade node
# Linux: 使用 NodeSource 仓库
```

### Q2: npm install 失败
**错误**: `npm ERR! network timeout`

**解决方案**:
```bash
# 使用淘宝镜像
npm config set registry https://registry.npmmirror.com

# 重新安装
npm install
```

### Q3: API 密钥格式错误
**错误**: `Error: Invalid API key format`

**解决方案**:
- 确保密钥是完整的 Base64 编码字符串
- 检查密钥中是否包含换行符或空格
- 重新从 Backpack 复制密钥

### Q4: 权限错误 (Linux/macOS)
**错误**: `EACCES: permission denied`

**解决方案**:
```bash
# 修复 npm 权限
sudo chown -R $(whoami) ~/.npm
sudo chown -R $(whoami) /usr/local/lib/node_modules
```

### Q5: 端口被占用
**错误**: `Error: listen EADDRINUSE`

**解决方案**:
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Linux/macOS
lsof -ti:3000 | xargs kill -9
```

---

## 🚀 启动机器人

### 基础启动
```bash
# 使用默认配置
npm start

# 或者
node start-bot.js
```

### 自定义配置启动
```bash
# 指定交易对和金额
node start-bot.js --symbol ETH_USDC_PERP --order-amount 50

# 调试模式
node start-bot.js --log-level DEBUG

# 完整配置示例
node start-bot.js \
  --symbol BTC_USDC_PERP \
  --order-amount 100 \
  --profit-target 0.0001 \
  --max-position-value 40000 \
  --trade-direction buy
```

### 后台运行 (Linux/macOS)
```bash
# 使用 nohup
nohup node start-bot.js > bot.log 2>&1 &

# 使用 screen
screen -S trading-bot
node start-bot.js
# Ctrl+A, D 分离会话

# 重新连接
screen -r trading-bot
```

### Windows 后台运行
```bash
# 使用 pm2 (需要先安装)
npm install -g pm2
pm2 start start-bot.js --name "trading-bot"
pm2 list
pm2 stop trading-bot
```

---

## 📊 监控和日志

### 日志文件位置
- **调试日志**: `logs/debug_YYYY-MM-DD.log`
- **交易记录**: `logs/trades_YYYY-MM-DD.csv`

### 实时监控
```bash
# Linux/macOS
tail -f logs/debug_$(date +%Y-%m-%d).log

# Windows PowerShell
Get-Content -Path "logs\debug_$(Get-Date -Format 'yyyy-MM-dd').log" -Wait
```

### 统计显示
机器人每分钟显示一次统计信息：
```
┌───────────────────────────────────────────────┐
│              💰 持仓统计信息                    │
├───────────────────────────────────────────────┤
│ 🕒 运行时间: 03:55                          │
├───────────────────────────────────────────────┤
│ 📈 BTC_USDC_PERP      │
│ 💼 持仓: 0.0015       LONG    │
│ 💰 价值: 67.50        USDC           │
│ 📊 入仓: 45000.0      现价: 45150.0      │
│ 🟢 盈亏: +2.2500      USDC           │
└───────────────────────────────────────────────┘
```

---

## 🔒 安全建议

### API 密钥安全
- ✅ 将 `.env` 文件添加到 `.gitignore`
- ✅ 定期轮换 API 密钥
- ✅ 设置最小必要权限
- ❌ 不要在公共场所展示配置文件

### 交易安全
- ✅ 从小金额开始测试
- ✅ 设置合理的持仓限制
- ✅ 定期检查交易记录
- ✅ 保持网络连接稳定

### 系统安全
- ✅ 保持 Node.js 和依赖包更新
- ✅ 使用防火墙保护系统
- ✅ 定期备份配置和日志

---

## 📞 获取帮助

### 文档资源
- **项目文档**: `docs/` 目录下的所有文件
- **API 文档**: [Backpack API 官方文档](https://docs.backpack.exchange/)
- **Node.js 文档**: [Node.js 官方文档](https://nodejs.org/docs/)

### 问题排查
1. **检查日志**: 查看 `logs/debug_*.log` 文件
2. **验证配置**: 确认 `.env` 文件配置正确
3. **测试网络**: 确保能访问 `api.backpack.exchange`
4. **检查余额**: 确保账户有足够的资金

### 联系支持
- 📧 查看项目 README.md 中的联系方式
- 💬 提交 GitHub Issue（如果有代码仓库）
- 📖 参考 Backpack 官方支持文档

---

## 🎯 下一步

恭喜！您已经成功在新电脑上搭建了 Backpack 剥头皮交易机器人。

**建议的下一步操作**:

1. **小额测试**: 使用最小金额测试机器人功能
2. **监控运行**: 观察几小时的运行情况
3. **调整参数**: 根据市场情况优化配置
4. **备份配置**: 保存好配置文件和 API 密钥
5. **学习进阶**: 阅读 `docs/` 目录下的其他文档

**记住**: 自动化交易有风险，请谨慎操作，从小金额开始！

---

*最后更新: 2024年9月*
