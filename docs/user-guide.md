# Backpack 交易机器人完整用户指南

## 📋 概述

本指南将帮助您从零开始搭建和使用 Backpack 交易机器人套件，包含三种专业交易模式：剥头皮交易、速刷合约交易和限价刷量模式。

## 🚀 环境搭建

### 前置要求

#### 系统要求
- **操作系统**: Windows 10/11, macOS 10.15+, 或 Ubuntu 18.04+
- **内存**: 至少 4GB RAM
- **存储**: 至少 1GB 可用空间
- **网络**: 稳定的互联网连接

#### 必需软件
- **Node.js**: 版本 14.0.0 或更高
- **Git**: 用于代码管理（可选）
- **文本编辑器**: VS Code, Sublime Text 等（推荐）

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

# ================ 通用交易配置 ================
SYMBOL=BTC_USDC_PERP
ORDER_AMOUNT=100

# ================ 剥头皮机器人配置 ================
PROFIT_TARGET=0.0001
MAX_POSITION_VALUE=40000
TRADE_DIRECTION=buy
ORDER_WAIT_TIME=450

# ================ 持续时间倍数配置 ================
# V1.1 新增功能：根据上次持仓持续时间调整订单金额倍数（有效期5分钟）
DURATION_MULTIPLIER_0_TO_1=3
DURATION_MULTIPLIER_1_TO_3=2
DURATION_MULTIPLIER_3_TO_5=1.5

# ================ 速刷交易配置 ================
VOLUME_SYMBOL=BTC_USDC_PERP
VOLUME_ORDER_AMOUNT=100
VOLUME_LIMIT_SIDE=buy
VOLUME_MAX_TRADES=1000

# ================ 波动风控配置 ================
VOLUME_VOLATILITY_1_THRESHOLD=0.02
VOLUME_VOLATILITY_2_THRESHOLD=0.05

# ================ 限价刷量模式配置 ================
VOLUME_LIMIT_MODE=false
VOLUME_PRICE_CHECK_INTERVAL=5000
VOLUME_ORDER_TIMEOUT=30
VOLUME_MAX_ADJUSTMENTS=100
VOLUME_ORDER_QUANTITY=0.001
VOLUME_MAX_POSITION_VALUE=1000

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

## 🤖 交易模式详解

### 📈 剥头皮交易模式

专为持续盈利设计的智能剥头皮交易策略。

#### 核心特性
- **智能交易系统**: 自动下单、智能平仓、连续交易
- **风险控制机制**: 持仓限制、价格控制、订单管理
- **智能订单管理**: 动态阈值、API驱动、错误处理
- **高级功能**: 百分比止盈、智能重试、详细日志
- **持续时间倍数系统**: 根据上次持仓持续时间动态调整订单金额
- **智能缓存机制**: 5分钟倍数缓存，提高响应速度

#### 工作流程
1. **自动下单**: 以略高于/低于市场价格的价格下限价单
2. **订单监控**: 实时监控订单状态和完成情况
3. **百分比止盈**: 基于净盈利比例的智能止盈计算
4. **智能仓位管理**: 通过 API 获取实时持仓信息
5. **风险管理**: 同时只允许一个活跃开仓订单和一个止盈订单

#### 启动命令
```bash
# 使用默认配置启动
node start-bot.js

# 自定义配置
node start-bot.js --symbol ETH_USDC_PERP --order-amount 50 --profit-target 0.005

# 使用环境变量
SYMBOL=SOL_USDC_PERP ORDER_AMOUNT=200 node start-bot.js
```

### ⚡ 速刷合约交易模式

专为快速增加交易量设计的高频交易模式。

#### 核心特性
- **快速交易循环**: 限价开仓 + 市价关仓的高频交易模式
- **WebSocket实时监控**: 基于WS API的实时价格监控和订单管理
- **双重波动风控**: 1分钟/5分钟双重价格波动监控机制
- **交易次数限制**: 可配置的完整交易次数上限控制
- **专业日志系统**: 独立的CSV交易日志和调试日志

#### 工作流程
1. **启动连接** → WebSocket连接 + API验证
2. **价格监控** → 实时ticker数据订阅
3. **波动检查** → 双重时间窗口波动监控
4. **限价开仓** → 计算合适价格下限价单
5. **状态监控** → 实时监控订单成交状态
6. **市价关仓** → 成交后立即下市价关仓单
7. **记录统计** → CSV日志记录完整交易
8. **循环重复** → 直到达到交易次数上限

#### 波动风控机制
- **1分钟监控**: 价格变化超过2% → 暂停5分钟
- **5分钟监控**: 价格变化超过5% → 暂停15分钟
- **自动恢复**: 波动降低后自动恢复交易
- **订单取消**: 暂停期间自动取消当前限价订单

#### 启动命令
```bash
# 使用默认配置启动
node start-volume-bot.js

# 自定义配置
node start-volume-bot.js --symbol ETH_USDC_PERP --amount 50 --side sell --max-trades 500

# 使用环境变量
VOLUME_SYMBOL=SOL_USDC_PERP VOLUME_ORDER_AMOUNT=200 node start-volume-bot.js
```

### 🎯 限价刷量模式

专门用于大量刷交易量的自动化交易策略，通过纯限价交易实现高频交易。

#### 核心特性
- **纯限价交易**: 禁止市价单，所有交易只能通过限价单完成
- **低手续费**: 利用限价单的maker手续费优势
- **高频交易**: 通过快速成交实现大量交易量
- **智能持仓管理**: 无持仓时同时维护买1和卖1两个限价单，有持仓时只维护一个平仓限价单
- **实时价格跟踪**: WebSocket监控1档位价格变化，自动调整订单价格
- **严格风险控制**: 持仓方向限制、最大持仓金额限制、订单数量控制

#### 工作流程
1. **初始化阶段**: 验证API连接、连接WebSocket、检查当前持仓状态
2. **无持仓状态**: 同时创建买1和卖1限价订单，实时监控1档位价格变化
3. **有持仓状态**: 取消另一个开仓订单，创建平仓限价订单，实时调整平仓订单价格
4. **状态转换**: 平仓订单成交 → 清除持仓状态 → 重新创建买1卖1订单

#### 风险控制
- **持仓风险**: 最大持仓时间、强制平仓、持仓限制
- **订单风险**: 订单超时、价格保护、数量限制
- **系统风险**: API限制、网络异常、资金安全

#### 启动命令
```bash
# 启用限价刷量模式
VOLUME_LIMIT_MODE=true node start-volume-bot.js

# 或使用专用启动脚本
node start-limit-volume-bot.js

# 自定义参数
VOLUME_LIMIT_MODE=true VOLUME_ORDER_QUANTITY=0.002 node start-volume-bot.js
```

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

## 🚀 后台运行

### Linux/macOS 后台运行
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

## 🎯 下一步

恭喜！您已经成功搭建了 Backpack 交易机器人。

**建议的下一步操作**:

1. **小额测试**: 使用最小金额测试机器人功能
2. **监控运行**: 观察几小时的运行情况
3. **调整参数**: 根据市场情况优化配置
4. **备份配置**: 保存好配置文件和 API 密钥
5. **学习进阶**: 阅读 `docs/` 目录下的其他文档

**记住**: 自动化交易有风险，请谨慎操作，从小金额开始！

---

*最后更新: 2024年10月*
