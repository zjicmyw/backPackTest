# Backpack 合约交易机器人套件 V1.2

基于 Backpack Exchange API 的自动化合约交易机器人套件，包含两种专业交易模式。

## 🎉 V1.2 版本特性

### 📈 剥头皮交易模式 (V1.1)
- ✅ **智能交易系统**: 自动下单、智能平仓、连续交易
- ✅ **风险控制机制**: 持仓限制、价格控制、订单管理
- ✅ **智能订单管理**: 动态阈值、API驱动、错误处理
- ✅ **高级功能**: 百分比止盈、智能重试、详细日志
- 🆕 **持续时间倍数系统**: 根据上次持仓持续时间动态调整订单金额
- 🆕 **智能缓存机制**: 5分钟倍数缓存，提高响应速度
- 🆕 **API历史查询**: 开仓前自动获取持仓历史，精准计算倍数

### ⚡ 速刷合约交易模式 (V1.2 新增)
- 🆕 **快速交易循环**: 限价开仓 + 市价关仓的高频交易模式
- 🆕 **WebSocket实时监控**: 基于WS API的实时价格监控和订单管理
- 🆕 **双重波动风控**: 1分钟/5分钟双重价格波动监控机制
- 🆕 **交易次数限制**: 可配置的完整交易次数上限控制
- 🆕 **专业日志系统**: 独立的CSV交易日志和调试日志

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

## 文件结构

```
backpackTest/
├── docs/                       # 文档文件夹
│   ├── setup-guide.md              # 新电脑环境搭建指南
│   ├── backpack-api-summary.md     # API 使用总结文档
│   ├── effective-prompts-summary.md # 有效提示词总结
│   ├── update-history.md           # 更新历史记录
│   └── openapi.json               # Backpack API 规范文档
├── logs/                       # 日志文件夹
│   ├── trades_YYYY-MM-DD.csv     # 交易日志 CSV 文件
│   └── debug_YYYY-MM-DD.log      # 调试日志文件
├── backpack-client.js          # Backpack API 客户端类
├── scalping-bot.js             # 剥头皮交易机器人
├── volume-bot.js               # 速刷合约交易机器人 🆕
├── start-bot.js                # 剥头皮机器人启动脚本
├── start-volume-bot.js         # 速刷机器人启动脚本 🆕
├── bot-config.js               # 剥头皮机器人配置文件
├── volume-bot-config.js        # 速刷机器人配置文件 🆕
├── package.json                # Node.js 项目配置
├── README.md                   # 使用说明文档
├── env.example                 # 环境变量配置示例
├── bot.env.example             # 剥头皮机器人环境变量示例
└── volume-bot.env.example      # 速刷机器人环境变量示例 🆕
```

## 快速开始

> 🆕 **新电脑用户**: 如果您是在新电脑上首次使用，请先查看 [新电脑环境搭建指南](docs/setup-guide.md)

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
8. **智能价格调整**: 自动检测PostOnlyTaker错误，动态调整价格重新挂单
9. **防重复机制**: 防止平仓订单重复创建，确保订单管理的稳定性
10. **智能订单更新**: 只在入场价格变化时才更新平仓订单，提高效率

## 🚀 两种交易模式

### 📈 剥头皮交易模式
专为持续盈利设计的智能剥头皮交易策略

### ⚡ 速刷合约交易模式 🆕
专为快速增加交易量设计的高频交易模式

---

## 快速启动指南

### 📈 剥头皮交易模式

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

# 🆕 V1.1 持续时间倍数配置（可选）
DURATION_MULTIPLIER_0_TO_1=3    # 0-1分钟持续时间使用3倍金额
DURATION_MULTIPLIER_1_TO_3=2    # 1-3分钟持续时间使用2倍金额
DURATION_MULTIPLIER_3_TO_5=1.5  # 3-5分钟持续时间使用1.5倍金额
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

---

### ⚡ 速刷合约交易模式 🆕

#### 1. 配置环境变量

```bash
# 复制速刷机器人环境变量示例文件
copy volume-bot.env.example .env

# 编辑 .env 文件，填入您的 API 密钥和配置
BACKPACK_API_KEY=your_base64_encoded_public_key
BACKPACK_PRIVATE_KEY=your_base64_encoded_private_key
VOLUME_SYMBOL=BTC_USDC_PERP
VOLUME_ORDER_AMOUNT=100
VOLUME_LIMIT_SIDE=buy
VOLUME_MAX_TRADES=1000

# 🆕 波动风控配置
VOLUME_VOLATILITY_1_THRESHOLD=0.02  # 1分钟2%波动阈值
VOLUME_VOLATILITY_2_THRESHOLD=0.05  # 5分钟5%波动阈值
```

#### 2. 启动速刷机器人

```bash
# 使用默认配置启动
npm run volume-bot

# 或直接运行
node start-volume-bot.js

# 查看帮助信息
npm run volume-bot:help
```

#### 3. 自定义配置启动

```bash
# 使用命令行参数自定义配置
node start-volume-bot.js --symbol ETH_USDC_PERP --amount 50 --side sell --max-trades 500

# 使用环境变量
VOLUME_SYMBOL=SOL_USDC_PERP VOLUME_ORDER_AMOUNT=200 node start-volume-bot.js
```

### 速刷机器人配置参数

| 参数 | 环境变量 | 默认值 | 说明 |
|------|----------|--------|------|
| 交易对 | `VOLUME_SYMBOL` | `BTC_USDC_PERP` | 合约交易对 |
| 每单金额 | `VOLUME_ORDER_AMOUNT` | `100` | 每个订单金额 (USDC) |
| 挂单方向 | `VOLUME_LIMIT_SIDE` | `buy` | 限价挂单方向 (`buy`/`sell`) |
| 交易次数上限 | `VOLUME_MAX_TRADES` | `1000` | 完整交易次数上限 |
| **波动风控配置** | | | **🆕 双重波动监控** |
| 1分钟波动阈值 | `VOLUME_VOLATILITY_1_THRESHOLD` | `0.02` | 1分钟价格变化阈值 (2%) |
| 5分钟波动阈值 | `VOLUME_VOLATILITY_2_THRESHOLD` | `0.05` | 5分钟价格变化阈值 (5%) |

### 剥头皮机器人配置参数

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
| **持续时间倍数配置** | | | **🆕 V1.1 新增功能** |
| 0-1分钟倍数 | `DURATION_MULTIPLIER_0_TO_1` | `3` | 持续时间0-1分钟的订单金额倍数 |
| 1-3分钟倍数 | `DURATION_MULTIPLIER_1_TO_3` | `2` | 持续时间1-3分钟的订单金额倍数 |
| 3-5分钟倍数 | `DURATION_MULTIPLIER_3_TO_5` | `1.5` | 持续时间3-5分钟的订单金额倍数 |

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

#### 智能价格调整
- **PostOnlyTaker错误检测**: 自动识别挂单价格过于接近市价的错误
- **ReduceOnly错误处理**: 自动检测平仓订单数量错误并调整为实际持仓数量
- **动态价格调整**: 基于实时市场数据自动调整订单价格
- **智能数量调整**: 根据实际持仓自动调整平仓订单数量
- **智能重试**: 调整后立即重新挂单，不计入重试次数
- **安全间距**: 确保调整后的价格与市价保持安全距离

#### 防重复机制
- **平仓订单保护**: 防止短时间内创建多个重复的平仓订单
- **状态标记**: 使用 `isCreatingCloseOrder` 标记防止并发创建
- **快速重试**: 失败后3秒即可重试，提高响应速度
- **智能跟踪**: 只有成交的平仓订单才从跟踪列表中移除
- **双重检查**: 在多个关键节点添加重复创建检查
- **稳定性保证**: 确保机器人订单管理的稳定性和可靠性

#### 智能订单管理
- **API查询优先**: 创建平仓订单前先查询现有订单
- **自动替换**: 发现现有订单时自动取消并创建新订单
- **避免重复**: 防止创建多个重复的平仓订单
- **等待机制**: 取消订单后等待500ms确保操作完成
- **标志管理**: 正确的并发控制，避免重复创建平仓订单

#### 风险控制机制
- **持仓价格控制**: 有持仓时新订单价格不得高于持仓入场价格
- **成本管理**: 防止在不利价格下增加持仓成本
- **智能判断**: 根据持仓方向智能判断价格合理性
- **风险预警**: 详细记录价格差异和风险控制原因

#### 日志显示优化
- **简洁清晰**: 移除所有对象信息，只显示关键消息
- **易于阅读**: 统一的消息格式，提高可读性
- **性能优化**: 减少JSON序列化开销
- **用户友好**: 符合用户对简洁日志的需求

#### 智能订单更新
- **动态阈值**: 根据ORDER_AMOUNT的20%动态计算更新阈值
- **按需更新**: 只在持仓价值变化超过阈值时才更新平仓订单
- **API查询**: 直接通过API查询平仓订单状态，确保数据准确性
- **效率优化**: 避免不必要的订单撤销和重建操作
- **错误处理**: 优雅处理"Order not found"等API错误

#### 智能持仓金额检查重下单
- **精确判断**: 基于实际持仓金额变化判断订单是否有效成交
- **智能重试**: 持仓金额增加不足时立即重新下单，无等待时间
- **避免漏单**: 防止因订单状态更新延迟导致的交易中断
- **详细日志**: 记录持仓金额变化详情，便于调试和监控

#### API数据源
- **实时查询**: 每次检查都通过API获取最新的订单状态
- **数据准确性**: 不依赖可能出错的全局变量
- **状态同步**: 确保本地状态与API状态一致
- **可靠性提升**: 基于权威的API数据做决策
- **精确管理**: 基于实际持仓价值进行精确的订单管理

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

## 📚 相关文档

### V1.0 版本文档
- 🚀 [快速开始指南](docs/setup-guide.md) - 详细的新用户设置指南
- 📖 [API使用指南](docs/backpack-api-summary.md) - Backpack API 使用说明
- 📝 [更新历史](docs/update-history.md) - 详细的版本更新记录
- 🔧 [开发历程](docs/effective-prompts-summary.md) - 项目开发过程记录

---

📧 如有问题，请联系开发者或查看 [Backpack API 官方文档](https://docs.backpack.exchange/)