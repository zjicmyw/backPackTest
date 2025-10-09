# Backpack 合约交易机器人套件 V1.4

基于 Backpack Exchange API 的自动化合约交易机器人套件，支持多种专业交易模式。

## 🎉 V1.4 版本特性

### 📈 剥头皮交易模式 (V1.1)
- ✅ **智能交易系统**: 自动下单、智能平仓、连续交易
- ✅ **风险控制机制**: 持仓限制、价格控制、订单管理
- ✅ **智能订单管理**: 动态阈值、API驱动、错误处理
- ✅ **高级功能**: 百分比止盈、智能重试、详细日志
- 🆕 **持续时间倍数系统**: 根据上次持仓持续时间动态调整订单金额
- 🆕 **智能缓存机制**: 5分钟倍数缓存，提高响应速度
- 🆕 **API历史查询**: 开仓前自动获取持仓历史，精准计算倍数

### ⚡ 速刷合约交易模式 (V1.2)
- 🆕 **快速交易循环**: 限价开仓 + 市价关仓的高频交易模式
- 🆕 **WebSocket实时监控**: 基于WS API的实时价格监控和订单管理
- 🆕 **双重波动风控**: 1分钟/5分钟双重价格波动监控机制
- 🆕 **交易次数限制**: 可配置的完整交易次数上限控制
- 🆕 **专业日志系统**: 独立的CSV交易日志和调试日志

### 🎯 限价刷量模式 (V1.4 新增)
- 🆕 **纯限价交易**: 禁止市价单，所有交易通过限价单完成
- 🆕 **智能持仓管理**: 无持仓时维护买1卖1订单，有持仓时维护平仓订单
- 🆕 **实时价格跟踪**: WebSocket监控1档位价格变化，自动调整订单价格
- 🆕 **严格风险控制**: 持仓方向限制、最大持仓金额限制、订单数量控制
- 🆕 **高频交易优化**: 5秒价格检查间隔，确保订单始终在最优价格

## 功能特性

- ✅ **账户管理**: 查询账户信息和余额
- ✅ **价格查询**: 获取实时代币价格和24小时统计数据
- ✅ **订单簿**: 查询市场买1卖1价格和订单簿深度
- ✅ **订单管理**: 查询、创建和取消订单
- ✅ **合约交易**: 支持期货合约交易
- ✅ **签名认证**: 完整的 ED25519 签名实现
- ✅ **错误处理**: 完善的错误处理和日志记录
- 🤖 **剥头皮机器人**: 自动化合约剥头皮交易策略
- 📊 **风险管理**: 订单限制、超时处理、仓位监控
- 📝 **日志记录**: CSV交易日志、调试日志、实时监控
- 🎯 **持续时间倍数**: 根据历史持仓时长智能调整订单金额
- ⚡ **智能缓存**: 倍数计算结果缓存5分钟，避免重复计算
- 🔍 **历史查询**: API自动获取最近持仓历史，精准匹配交易周期
- 🚀 **速刷交易**: 限价开仓+市价关仓的快速交易循环模式
- 📡 **WebSocket监控**: 实时价格监控和订单状态跟踪
- 🛡️ **波动风控**: 双重时间窗口的价格波动监控和自动暂停
- 🎯 **限价刷量**: 纯限价交易模式，实时调整到1档位价格

## 文件结构

```
backpackTest/
├── docs/                       # 文档文件夹
│   ├── user-guide.md               # 完整用户指南 🆕
│   ├── development-history.md      # 开发历程和更新历史 🆕
│   ├── backpack-api-summary.md     # API 使用总结文档
│   └── openapi.json               # Backpack API 规范文档
├── logs/                       # 日志文件夹
│   ├── trades_YYYY-MM-DD.csv     # 交易日志 CSV 文件
│   └── debug_YYYY-MM-DD.log      # 调试日志文件
├── backpack-client.js          # Backpack API 客户端类
├── scalping-bot.js             # 剥头皮交易机器人
├── volume-bot.js               # 速刷合约交易机器人
├── limit-volume-bot.js         # 限价刷量交易机器人 🆕
├── start-bot.js                # 剥头皮机器人启动脚本
├── start-volume-bot.js         # 速刷机器人启动脚本
├── start-limit-volume-bot.js   # 限价刷量机器人启动脚本 🆕
├── bot-config.js               # 剥头皮机器人配置文件
├── volume-bot-config.js        # 速刷机器人配置文件
├── package.json                # Node.js 项目配置
├── README.md                   # 使用说明文档
└── bot.env.example             # 统一环境变量示例（支持所有机器人模式）
```

## 快速开始

> 🆕 **新用户**: 如果您是首次使用，请查看 [完整用户指南](docs/user-guide.md)

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
# 复制环境变量示例文件
copy bot.env.example .env

# 编辑 .env 文件，填入您的 API 密钥和配置
BACKPACK_API_KEY=your_base64_encoded_public_key
BACKPACK_PRIVATE_KEY=your_base64_encoded_private_key
```

### 3. 选择交易模式

#### 📈 剥头皮交易模式
```bash
# 使用默认配置启动
node start-bot.js

# 自定义配置
node start-bot.js --symbol ETH_USDC_PERP --order-amount 50
```

#### ⚡ 速刷合约交易模式
```bash
# 使用默认配置启动
node start-volume-bot.js

# 自定义配置
node start-volume-bot.js --symbol ETH_USDC_PERP --amount 50 --side sell
```

#### 🎯 限价刷量模式
```bash
# 启用限价刷量模式
VOLUME_LIMIT_MODE=true node start-volume-bot.js

# 或使用专用启动脚本
node start-limit-volume-bot.js
```

## 配置参数

### 剥头皮机器人配置

| 参数 | 环境变量 | 默认值 | 说明 |
|------|----------|--------|------|
| 交易对 | `SYMBOL` | `BTC_USDC_PERP` | 合约交易对 |
| 每单金额 | `ORDER_AMOUNT` | `100` | 每个订单金额 (USDC) |
| 净盈利比例 | `PROFIT_TARGET` | `0.0001` | 除手续费外的净盈利比例 (0.01%) |
| 最大持仓金额 | `MAX_POSITION_VALUE` | `40000` | 单币种持仓最大金额 (USDC) |
| 交易方向 | `TRADE_DIRECTION` | `buy` | `buy` 或 `sell` |
| 订单等待时间 | `ORDER_WAIT_TIME` | `450` | 订单间等待时间 (秒) |
| **持续时间倍数配置** | | | **V1.1 新增功能** |
| 0-1分钟倍数 | `DURATION_MULTIPLIER_0_TO_1` | `3` | 持续时间0-1分钟的订单金额倍数 |
| 1-3分钟倍数 | `DURATION_MULTIPLIER_1_TO_3` | `2` | 持续时间1-3分钟的订单金额倍数 |
| 3-5分钟倍数 | `DURATION_MULTIPLIER_3_TO_5` | `1.5` | 持续时间3-5分钟的订单金额倍数 |

### 速刷机器人配置

| 参数 | 环境变量 | 默认值 | 说明 |
|------|----------|--------|------|
| 交易对 | `VOLUME_SYMBOL` | `BTC_USDC_PERP` | 合约交易对 |
| 每单金额 | `VOLUME_ORDER_AMOUNT` | `100` | 每个订单金额 (USDC) |
| 挂单方向 | `VOLUME_LIMIT_SIDE` | `buy` | 限价挂单方向 (`buy`/`sell`) |
| 交易次数上限 | `VOLUME_MAX_TRADES` | `1000` | 完整交易次数上限 |
| **波动风控配置** | | | **双重波动监控** |
| 1分钟波动阈值 | `VOLUME_VOLATILITY_1_THRESHOLD` | `0.02` | 1分钟价格变化阈值 (2%) |
| 5分钟波动阈值 | `VOLUME_VOLATILITY_2_THRESHOLD` | `0.05` | 5分钟价格变化阈值 (5%) |

### 限价刷量模式配置

| 参数 | 环境变量 | 默认值 | 说明 |
|------|----------|--------|------|
| 启用模式 | `VOLUME_LIMIT_MODE` | `false` | 是否启用限价刷量模式 |
| 交易对 | `VOLUME_SYMBOL` | `BTC_USDC_PERP` | 交易对符号 |
| 订单数量 | `VOLUME_ORDER_QUANTITY` | `0.001` | 每个订单的数量 |
| 价格检查间隔 | `VOLUME_PRICE_CHECK_INTERVAL` | `5000` | 价格检查间隔(毫秒) |
| 订单超时时间 | `VOLUME_ORDER_TIMEOUT` | `30` | 订单超时时间(秒) |
| 最大调整次数 | `VOLUME_MAX_ADJUSTMENTS` | `100` | 最大价格调整次数 |
| 最大持仓金额 | `VOLUME_MAX_POSITION_VALUE` | `1000` | 最大持仓金额限制(USDC) |

## 使用示例

### 基础用法

```javascript
const BackpackClient = require('./backpack-client');

// 创建客户端
const client = new BackpackClient(apiKey, privateKey);

// 查询 BTC 合约价格
const ticker = await client.getTicker('BTC_USDC_PERP');
console.log(`BTC 合约价格: $${ticker.lastPrice}`);

// 查询账户余额
const balances = await client.getBalances();
console.log('账户余额:', balances);

// 查询买1卖1
const bestPrices = await client.getBestPrices('ETH_USDC_PERP');
console.log(`买1: $${bestPrices.bestBid[0]}, 卖1: $${bestPrices.bestAsk[0]}`);
```

### 下单示例

```javascript
// 限价买单（合约）
await client.placeOrder(
    'SOL_USDC_PERP',    // 合约交易对
    'Bid',              // 做多
    'Limit',            // 限价单
    '1.0',              // 数量
    '100.00'            // 价格
);

// 市价卖单（合约）
await client.placeOrder(
    'SOL_USDC_PERP',    // 合约交易对
    'Ask',              // 做空
    'Market',           // 市价单
    '1.0'               // 数量
);
```

## API 客户端方法

### 市场数据
- `getTicker(symbol, interval?)` - 获取价格信息
- `getDepth(symbol)` - 获取订单簿深度
- `getBestPrices(symbol)` - 获取买1卖1价格

### 账户管理
- `getAccount()` - 获取账户信息
- `getBalances()` - 获取所有余额
- `getBalance(mint)` - 获取特定代币余额

### 订单管理
- `getOrders(symbol?)` - 查询所有订单
- `getOrder(orderId, symbol)` - 查询单个订单
- `placeOrder(symbol, side, orderType, quantity, price?)` - 下单
- `executeOrders(orders)` - 批量下单
- `cancelOrder(orderId, symbol)` - 取消订单

## 支持的交易对

### 主要合约交易对
- `BTC_USDC_PERP` - BTC 永续合约
- `ETH_USDC_PERP` - ETH 永续合约
- `SOL_USDC_PERP` - SOL 永续合约
- `AVAX_USDC_PERP` - AVAX 永续合约
- `MATIC_USDC_PERP` - MATIC 永续合约
- 更多...

## 安全提醒

### 密钥安全
- 🔐 **密钥安全**: 永远不要将 API 密钥提交到版本控制系统
- 🔒 **权限控制**: 为 API 密钥设置适当的权限（只读、交易等）
- 🚫 **生产环境**: 不要在代码中硬编码密钥

### 交易风险
- ⚠️ **测试优先**: 在实盘交易前，先在测试环境充分测试
- 💰 **资金管理**: 合理控制交易金额和风险
- 📊 **监控交易**: 实时监控订单状态和账户变化

### 技术注意
- 🕒 **时间同步**: 确保系统时间准确，签名验证依赖时间戳
- 🌐 **网络稳定**: 确保网络连接稳定，避免订单执行异常
- 📈 **频率限制**: 遵守 API 频率限制，避免被限流

## 错误处理

脚本包含完善的错误处理机制：

```javascript
try {
    const result = await client.placeOrder(symbol, side, type, quantity, price);
    console.log('下单成功:', result);
} catch (error) {
    console.error('下单失败:', error.message);
    // 处理错误逻辑
}
```

## 开发和调试

### 启用调试日志

```javascript
// 在客户端中添加调试信息
const client = new BackpackClient(apiKey, privateKey);
client.debug = true; // 启用调试模式
```

### 测试模式

使用测试脚本验证功能：

```bash
node start-bot.js --help  # 查看机器人帮助信息
```

## 贡献

欢迎提交 Issue 和 Pull Request 来改进这个项目！

## 许可证

MIT License

## 免责声明

本脚本仅供学习和参考使用。使用本脚本进行实际交易时，请自行承担风险。作者不对因使用本脚本造成的任何损失负责。

---

## 📚 相关文档

- 📖 [完整用户指南](docs/user-guide.md) - 详细的使用说明和环境搭建
- 📝 [开发历程和更新历史](docs/development-history.md) - 项目开发过程和版本更新记录
- 🔧 [API使用指南](docs/backpack-api-summary.md) - Backpack API 使用说明

---

📧 如有问题，请联系开发者或查看 [Backpack API 官方文档](https://docs.backpack.exchange/)