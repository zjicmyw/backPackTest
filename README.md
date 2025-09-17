# Backpack Exchange API 自动化交易脚本

这是一个使用 JavaScript 实现的 Backpack Exchange API 自动化交易脚本，支持查询账户余额、订单管理、价格查询和合约交易等功能。

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

## 文件结构

```
backpackTest/
├── docs/                       # 文档文件夹
│   ├── backpack-api-summary.md    # API 使用总结文档
│   ├── effective-prompts-summary.md # 有效提示词总结
│   └── openapi.json               # Backpack API 规范文档
├── logs/                       # 日志文件夹
│   ├── trades_YYYY-MM-DD.csv     # 交易日志 CSV 文件
│   └── debug_YYYY-MM-DD.log      # 调试日志文件
├── backpack-client.js          # Backpack API 客户端类
├── scalping-bot.js             # 剥头皮交易机器人
├── start-bot.js                # 机器人启动脚本
├── test-bot.js                 # 机器人测试脚本
├── bot-config.js               # 机器人配置文件
├── package.json                # Node.js 项目配置
├── README.md                   # 使用说明文档
├── env.example                 # 环境变量配置示例
└── bot.env.example             # 机器人环境变量示例
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 运行功能测试和演示

```bash
npm test
# 或者
npm start
```

**无需 API 密钥**：脚本会自动检测是否有 API 密钥配置：
- 如果没有配置密钥，只运行公开 API 测试（价格查询、订单簿等）
- 如果配置了密钥，运行完整功能测试（包括下单、取消订单等）

### 3. 配置 API 密钥（可选）

要使用完整的交易功能，需要配置 API 密钥：

**方法1：使用 .env 文件（推荐）**
```bash
# 复制环境变量示例文件
copy env.example .env

# 编辑 .env 文件，填入您的 API 密钥
BACKPACK_API_KEY=your_base64_encoded_public_key
BACKPACK_PRIVATE_KEY=your_base64_encoded_private_key
```

**方法2：设置环境变量**
```bash
# Windows
set BACKPACK_API_KEY=your_base64_encoded_public_key
set BACKPACK_PRIVATE_KEY=your_base64_encoded_private_key

# Linux/Mac
export BACKPACK_API_KEY=your_base64_encoded_public_key
export BACKPACK_PRIVATE_KEY=your_base64_encoded_private_key
```

## 🤖 剥头皮交易机器人

### 机器人功能

剥头皮交易机器人实现了以下核心功能：

1. **自动下单**: 以略高于/低于市场价格的价格下限价单
2. **订单监控**: 实时监控订单状态和完成情况，使用 `executedQuantity` 精确检测成交
3. **百分比止盈**: 基于净盈利比例的智能止盈计算，自动考虑手续费成本
4. **智能仓位管理**: 通过 API 获取实时持仓信息，而非本地计算
5. **订单数量控制**: 基于持仓价值限制最大成交订单数，而非 pending 订单数
6. **优化统计显示**: 每分钟显示一次简洁美观的持仓统计，包含颜色指示的总盈亏
7. **风险管理**: 
   - 同时只允许一个活跃开仓订单和一个止盈订单
   - 订单超时30秒自动取消和更新
   - 基于实际持仓价值的风险控制
   - 所有订单默认使用 `postOnly` 确保挂单交易

### 快速启动机器人

#### 1. 配置环境变量

```bash
# 复制机器人环境变量示例文件
copy bot.env.example .env

# 编辑 .env 文件，填入您的 API 密钥和配置
BACKPACK_API_KEY=your_base64_encoded_public_key
BACKPACK_PRIVATE_KEY=your_base64_encoded_private_key
SYMBOL=BTC_USDC_PERP
ORDER_AMOUNT=100
PROFIT_TARGET=0.0001
```

#### 2. 测试机器人功能

```bash
# 测试机器人基础功能（不进行真实交易）
node test-bot.js
```

#### 3. 启动机器人

```bash
# 使用默认配置启动
npm run bot

# 或直接运行
node start-bot.js

# 查看帮助信息
npm run bot:help
```

#### 4. 自定义配置启动

```bash
# 使用命令行参数自定义配置
node start-bot.js --symbol ETH_USDC_PERP --order-amount 50 --profit-target 0.005

# 使用环境变量
SYMBOL=SOL_USDC_PERP ORDER_AMOUNT=200 node start-bot.js
```

### 机器人配置参数

| 参数 | 环境变量 | 默认值 | 说明 |
|------|----------|--------|------|
| 交易对 | `SYMBOL` | `BTC_USDC_PERP` | 合约交易对 |
| 每单金额 | `ORDER_AMOUNT` | `100` | 每个订单金额 (USDC) |
| 净盈利比例 | `PROFIT_TARGET` | `0.0001` | 除手续费外的净盈利比例 (0.01%) |
| 最大持仓金额 | `MAX_POSITION_VALUE` | `40000` | 单币种持仓最大金额 (USDC) |
| 交易方向 | `TRADE_DIRECTION` | `buy` | `buy` 或 `sell` |
| 订单等待时间 | `ORDER_WAIT_TIME` | `450` | 订单间等待时间 (秒) |
| 挂单费率 | `MAKER_FEE` | `0.0001` | 挂单手续费率 (0.01%) |
| 吃单费率 | `TAKER_FEE` | `0.00026` | 市价单手续费率 (0.026%) |
| 日志级别 | `LOG_LEVEL` | `INFO` | `DEBUG/INFO/WARN/ERROR` |

### 日志记录

机器人提供完整的日志记录功能：

- **CSV 交易日志**: `logs/trades_YYYY-MM-DD.csv` - 包含所有交易详情
- **调试日志**: `logs/debug_YYYY-MM-DD.log` - 详细的运行日志（UTC+8时区）
- **控制台输出**: 实时状态更新和统计信息
- **实时持仓统计**: 通过 API 获取准确的账户持仓信息

### 安全功能

- **智能持仓限制**: 基于持仓金额的风险控制
- **超时处理**: 订单超过30秒无持仓自动取消和更新
- **实时仓位监控**: 通过 API 持续检查准确的持仓状态
- **订单去重**: 同时只允许一个活跃开仓订单和一个止盈订单
- **错误恢复**: 优雅处理 API 错误和断开连接
- **优雅关闭**: 支持 Ctrl+C 安全关闭

### 风险提示

⚠️ **重要提醒**:
- 这是自动化交易程序，请谨慎使用
- 建议先在测试环境充分测试
- 合理设置订单金额和风险参数
- 实时监控机器人运行状态
- 确保网络连接稳定

### 🔧 核心功能和修复

#### 订单监控和成交检测
- 使用 `executedQuantity > 0` 和 `status` 字段精确检测订单成交
- 支持 `Filled`（完全成交）和 `PartiallyFilled`（部分成交）状态
- 实时监控所有活跃订单状态变化

#### 智能持仓管理
- **实时 API 查询**: 通过 `/api/v1/position` 获取准确的持仓信息
- **持仓价值计算**: 基于 `positionValue` 字段而非本地计算
- **方向识别**: 正确处理 `Long`/`Short` 持仓方向

#### 百分比止盈策略
- **净盈利比例**: `PROFIT_TARGET` 表示除手续费外的净盈利比例
- **自动计算**: 总盈利 = 净盈利比例 + 手续费比例 (开仓+平仓)
- **示例**: `PROFIT_TARGET=0.0001` (0.01%) + 手续费0.02% = 总涨幅0.03%
- **reduceOnly 标志**: 止盈订单使用 `reduceOnly: true` 确保只平仓
- **单一止盈**: 同时只维护一个活跃的止盈订单

#### 持仓金额控制
- **基于持仓价值**: 直接限制单币种持仓的总金额
- **动态限制**: 持仓达到限制时停止下新单，平仓后恢复
- **风险控制**: 防止单币种持仓过大，分散风险

#### 优化统计显示
- **定时显示**: 每分钟显示一次，避免频繁刷屏
- **简洁信息**: 显示总盈亏（未实现+已实现）而非分别显示
- **视觉优化**: 使用边框和颜色指示，🟢盈利/🔴亏损/⚪平衡
- **时间格式**: 运行时间显示为 HH:MM 格式

#### 时区和配置管理
- **UTC+8 时区**: 所有日志时间使用中国标准时间
- **环境变量配置**: 所有参数从 `.env` 文件读取，避免硬编码
- **配置验证**: 启动时验证必需的配置项

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

### 合约交易示例

```javascript
// 合约做多
await client.placeOrder(
    'BTC_USDC_PERP',  // 合约交易对
    'Bid',            // 做多
    'Limit',          // 限价单
    '0.001',          // 数量
    '45000.00'        // 价格
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

## 注意事项

### 安全提醒
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

📧 如有问题，请联系开发者或查看 [Backpack API 官方文档](https://docs.backpack.exchange/)