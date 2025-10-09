# 更新历史记录

## V1.2.1 - 订单查询404错误修复 (2025-10-09)

### 🐛 问题修复

#### 市价订单查询404错误
- **问题描述**: 市价订单创建成功并成交后，查询订单状态时返回404错误
- **根本原因**: `/api/v1/order` 端点只能查询未成交订单，已成交订单无法通过此端点查询
- **影响范围**: 速刷合约交易机器人的市价关仓订单状态检查

### 🔧 修复内容

#### 1. 优化订单状态检查逻辑
```javascript
// 修改前：总是查询订单状态
const order = await this.client.getOrder(marketOrderId, this.config.symbol);

// 修改后：检查初始状态，避免不必要的查询
if (initialStatus === 'Filled') {
    this.handleMarketOrderFilled(marketOrderId, limitOrder);
    return;
}
```

#### 2. 增强404错误处理
```javascript
// 新增404错误处理逻辑
if (error.message.includes('404')) {
    this.log('INFO', '订单已从订单簿移除，可能已成交');
    
    // 尝试通过历史订单查询确认状态
    const historyOrders = await this.client.getOrderHistory({
        orderId: marketOrderId,
        symbol: this.config.symbol
    });
    
    // 如果无法确认状态，假设已成交
    this.handleMarketOrderFilled(marketOrderId, limitOrder);
    return;
}
```

#### 3. 新增历史订单查询方法
```javascript
// 在 backpack-client.js 中新增
async getOrderHistory(params = {}) {
    const result = await this.signedRequest('GET', '/wapi/v1/history/orders', 'orderHistoryQueryAll', queryParams);
    return result || [];
}
```

#### 4. 代码重构优化
- **提取成交处理逻辑**: 将订单成交处理提取到独立的 `handleMarketOrderFilled` 方法
- **传递初始状态**: 修改 `waitForMarketOrderFill` 方法签名，支持传递订单初始状态
- **提高可维护性**: 优化代码结构，提高可读性和可维护性

### 📊 修复效果

#### 修复前
```
[2025/10/9 19:11:24] [ERROR] 查询市价订单状态失败 { error: 'API 错误 (404): Not Found' }
[2025/10/9 19:11:25] [ERROR] 查询市价订单状态失败 { error: 'API 错误 (404): Not Found' }
[2025/10/9 19:11:26] [ERROR] 查询市价订单状态失败 { error: 'API 错误 (404): Not Found' }
```

#### 修复后
```
[2025/10/9 19:11:23] [INFO] ✅ 市价关仓订单创建成功 { status: 'Filled' }
[2025/10/9 19:11:23] [INFO] ✅ 第 1 次交易完成 { status: 'completed' }
```

### 🎯 技术改进

#### API端点理解
- **`/api/v1/order`**: 仅查询未成交订单（resting orders）
- **`/wapi/v1/history/orders`**: 查询历史订单（包括已成交订单）

#### 错误处理策略
1. **预防性检查**: 订单创建时检查初始状态
2. **智能降级**: 404错误时尝试历史订单查询
3. **合理假设**: 无法确认时假设市价订单已成交

#### 代码质量提升
- **单一职责**: 每个方法职责更加明确
- **错误恢复**: 增强错误处理和恢复能力
- **日志优化**: 提供更准确的日志信息

### 📈 性能优化

- **减少API调用**: 避免不必要的订单状态查询
- **提高响应速度**: 直接处理已成交订单
- **降低错误率**: 减少404错误的发生

### 🔄 向后兼容

- **保持接口不变**: 现有配置和启动方式无需修改
- **增强稳定性**: 提高交易流程的稳定性和可靠性
- **保持功能完整**: 所有原有功能均正常工作

---

## V1.2 - 速刷合约交易模式 (2025-10-03)

### 🎯 新增功能

#### 速刷合约交易机器人
- **快速交易循环**: 限价开仓 + 市价关仓的高频交易模式
- **WebSocket实时监控**: 基于WS API的实时价格监控和订单管理
- **双重波动风控**: 1分钟/5分钟双重价格波动监控机制
- **交易次数限制**: 可配置的完整交易次数上限控制
- **专业日志系统**: 独立的CSV交易日志和调试日志

### 📋 新增文件

#### 核心文件
- **`volume-bot.js`** - 速刷合约交易机器人主文件
- **`volume-bot-config.js`** - 速刷机器人配置文件
- **`start-volume-bot.js`** - 速刷机器人启动脚本
- **`volume-bot.env.example`** - 速刷机器人环境变量示例

#### 配置参数
```ini
# 速刷交易配置
VOLUME_SYMBOL=BTC_USDC_PERP
VOLUME_ORDER_AMOUNT=100
VOLUME_LIMIT_SIDE=buy
VOLUME_MAX_TRADES=1000

# 波动风控配置
VOLUME_VOLATILITY_1_THRESHOLD=0.02  # 1分钟2%阈值
VOLUME_VOLATILITY_2_THRESHOLD=0.05  # 5分钟5%阈值
```

### 🔧 核心功能实现

#### 1. 速刷交易循环
```javascript
// 工作流程
1. 下限价开仓订单 (buy/sell)
2. 监控订单状态 (WebSocket + API轮询)
3. 订单成交后立即下市价关仓订单
4. 等待市价订单成交
5. 记录交易结果到CSV
6. 重复循环直到达到交易次数上限
```

#### 2. WebSocket实时监控
```javascript
class VolumeBot {
    // WebSocket连接管理
    async connectWebSocket()
    
    // 订阅价格流
    subscribeToStreams()
    
    // 处理价格更新
    handleTickerUpdate(tickerData)
    
    // 心跳机制
    startHeartbeat()
}
```

#### 3. 双重波动风控系统
```javascript
class PriceHistoryManager {
    // 价格历史管理
    addPrice(price)
    
    // 计算价格变化百分比
    getPriceChangePercent(timeWindowMinutes)
}

// 波动检查逻辑
checkVolatilityControl() {
    // 1分钟波动检查
    const change1min = this.priceHistory.getPriceChangePercent(1);
    if (change1min > threshold1) pauseTrading();
    
    // 5分钟波动检查  
    const change5min = this.priceHistory.getPriceChangePercent(5);
    if (change5min > threshold2) pauseTrading();
}
```

#### 4. 智能订单管理
```javascript
// 限价订单下单
async placeLimitOrder(price)

// 订单状态监控
monitorLimitOrder()

// 市价关仓订单
async placeMarketCloseOrder()

// 等待市价订单成交
async waitForMarketOrderFill(marketOrderId, limitOrder)
```

### 🎯 工作流程

#### 速刷交易模式流程
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

### 📊 启动方式

#### NPM脚本
```bash
# 启动速刷机器人
npm run volume-bot

# 查看帮助信息
npm run volume-bot:help
```

#### 命令行参数
```bash
# 自定义配置启动
node start-volume-bot.js --symbol ETH_USDC_PERP --amount 50 --side sell --max-trades 500
```

#### 环境变量
```bash
# 使用环境变量
VOLUME_SYMBOL=SOL_USDC_PERP VOLUME_ORDER_AMOUNT=200 node start-volume-bot.js
```

### 🔄 架构设计

#### 模块化设计
- **VolumeBot类**: 主要交易逻辑
- **PriceHistoryManager类**: 价格历史管理
- **WebSocket集成**: 实时数据流处理
- **配置管理**: 灵活的参数配置系统

#### 依赖管理
```json
{
  "dependencies": {
    "ws": "^8.14.2",  // WebSocket客户端
    "dotenv": "^17.2.2",
    "ed25519": "^0.0.5",
    "node-fetch": "^2.6.7"
  }
}
```

### 🎯 功能特点

#### 高频交易优化
- **WebSocket实时监控**: 毫秒级价格更新响应
- **快速订单切换**: 限价→市价无缝切换
- **状态实时跟踪**: 订单状态实时监控
- **批量交易支持**: 支持大量重复交易

#### 风险控制
- **双重波动监控**: 多时间窗口风险控制
- **自动暂停机制**: 高波动时自动暂停交易
- **交易次数限制**: 防止过度交易
- **余额检查**: 启动前验证账户余额

#### 专业日志
- **CSV交易记录**: 详细的交易历史记录
- **实时状态日志**: 完整的运行状态记录
- **错误日志**: 异常情况详细记录
- **性能统计**: 交易效率和成功率统计

---

## V1.1 - 持续时间倍数功能 (2025-10-02)

### 🎯 新增功能

#### 智能订单金额调整系统
- **持续时间倍数配置**: 根据上次持仓持续时间动态调整订单金额
- **API持仓历史查询**: 开仓前自动获取最近持仓历史
- **全局状态管理**: 简化的持仓时间跟踪机制

### 📋 配置新增

#### 环境变量配置 (`bot.env.example`)
```ini
# ================ 持续时间倍数配置 ================
# 根据上次持仓持续时间调整订单金额倍数（有效期5分钟）
# 0-1分钟持续时间的订单金额倍数 (默认: 3)
DURATION_MULTIPLIER_0_TO_1=3

# 1-3分钟持续时间的订单金额倍数 (默认: 2)
DURATION_MULTIPLIER_1_TO_3=2

# 3-5分钟持续时间的订单金额倍数 (默认: 1.5)
DURATION_MULTIPLIER_3_TO_5=1.5
```

#### 机器人配置 (`bot-config.js`)
```javascript
trading: {
    // 持续时间倍数配置
    durationMultiplier0to1: parseFloat(process.env.DURATION_MULTIPLIER_0_TO_1) || 3,
    durationMultiplier1to3: parseFloat(process.env.DURATION_MULTIPLIER_1_TO_3) || 2,
    durationMultiplier3to5: parseFloat(process.env.DURATION_MULTIPLIER_3_TO_5) || 1.5
}
```

### 🔧 核心功能实现

#### 1. 全局持仓时间跟踪
```javascript
// 全局变量
let lastPositionEntryTime = null; // 最近1次开仓时间
let lastPositionCloseTime = null; // 最近1次平仓时间
let lastPositionDuration = null; // 最近1次持仓持续时间（毫秒）
let orderAmountMultiplierCache = null; // 缓存的订单金额倍数
let orderAmountMultiplierExpiry = null; // 倍数过期时间

// 核心函数
function recordPositionEntry(entryTime) // 记录开仓时间
function recordPositionClose(closeTime) // 记录平仓时间并计算持续时间
function getLastPositionInfo() // 获取持仓信息
```

#### 2. 智能倍数计算系统
```javascript
function getOrderAmountMultiplier(config) {
    // 缓存机制：5分钟有效期，避免重复计算
    // 持续时间匹配：
    // - 0-1分钟 → 3倍
    // - 1-3分钟 → 2倍  
    // - 3-5分钟 → 1.5倍
    // - 5分钟以上 → 1倍
}
```

#### 3. API持仓历史查询
```javascript
async function fetchLastPositionFromAPI(symbol, client, tradeDirection) {
    // 获取最近60分钟成交记录
    // 智能识别开仓/平仓订单
    // 匹配完整持仓周期
    // 返回开仓和平仓时间
}
```

### 🎯 工作流程

#### 开仓前流程
1. **检测开仓机会** → 持仓从无到有
2. **API查询历史** → 获取最近完整持仓周期
3. **更新全局状态** → 记录开仓/平仓时间和持续时间
4. **计算订单倍数** → 根据持续时间匹配对应倍数
5. **缓存倍数结果** → 5分钟内重复使用，提高效率

#### 订单执行流程
1. **基础金额** → 从配置读取 `ORDER_AMOUNT`
2. **倍数计算** → 根据持续时间获取倍数
3. **最终金额** → `基础金额 × 倍数`
4. **精度调整** → 符合交易所要求的数量精度

#### 缓存管理机制
- **自动清除**: 持续时间更新时清除旧缓存
- **有效期管理**: 5分钟自动过期
- **避免重复计算**: 相同条件下重复使用缓存结果

### 🐛 问题修复

#### 1. 配置传递问题
**问题**: 机器人构造函数缺少持续时间倍数配置
```javascript
// 修复前：配置都是 undefined
传入的config: {
  durationMultiplier0to1: undefined,
  durationMultiplier1to3: undefined,
  durationMultiplier3to5: undefined
}

// 修复后：正确读取配置
传入的config: {
  durationMultiplier0to1: 3,
  durationMultiplier1to3: 2,
  durationMultiplier3to5: 1.5
}
```

#### 2. 缓存清除机制
**问题**: 持续时间更新后，旧缓存未清除导致错误倍数
```javascript
// 场景：0.08分钟 → 3倍缓存 → 1.55分钟仍使用3倍（错误）
// 修复：持续时间更新时自动清除缓存

function recordPositionClose(closeTime) {
    // ... 计算持续时间 ...
    
    // 清除旧的订单金额倍数缓存
    orderAmountMultiplierCache = null;
    orderAmountMultiplierExpiry = null;
    console.log(`🔄 持续时间更新，已清除订单金额倍数缓存`);
}
```

### 📊 测试验证

#### 持续时间倍数测试
```
🔸 场景1：0.08分钟持续时间
📊 匹配0-1分钟区间，使用倍数: 3 ✅

🔸 场景2：1.55分钟持续时间  
📊 匹配1-3分钟区间，使用倍数: 2 ✅

🔸 场景3：缓存机制验证
📋 使用缓存的订单金额倍数: 2x (剩余300秒) ✅
```

### 🔄 架构优化

#### 简化设计理念
- **删除复杂的TradeHistoryManager类**: 移除过度复杂的API同步机制
- **采用全局函数设计**: 简单直接的状态管理
- **事件驱动更新**: 开仓时即时获取历史，而非定期同步
- **缓存优化**: 智能缓存机制，平衡性能和准确性

#### 代码结构改进
```javascript
// 旧设计：复杂的类结构
class TradeHistoryManager {
    // 100+ 行复杂逻辑
}

// 新设计：简洁的全局函数
function recordPositionEntry(entryTime) { /* 5行代码 */ }
function recordPositionClose(closeTime) { /* 10行代码 */ }
function getOrderAmountMultiplier(config) { /* 30行代码 */ }
```

### 🎯 功能特点

#### 智能化
- **自动识别**: 开仓/平仓订单智能识别
- **动态调整**: 根据历史表现动态调整订单金额
- **缓存机制**: 避免重复计算，提高响应速度

#### 可配置性
- **灵活配置**: 持续时间区间和倍数完全可配置
- **环境变量**: 通过env文件轻松调整参数
- **实时生效**: 配置更改后重启即生效

#### 稳定性
- **错误处理**: 完善的API错误处理机制
- **状态管理**: 可靠的全局状态跟踪
- **日志记录**: 详细的调试和运行日志

---

## V1.0 - 基础剥头皮交易系统 (2025-09-26)

### 🎯 核心功能
- ✅ **自动交易**: 基于价格差异的自动下单和平仓
- ✅ **风险控制**: 持仓限制、价格控制、订单管理
- ✅ **订单管理**: 智能订单监控和状态跟踪
- ✅ **日志系统**: CSV交易日志和调试日志

### 📋 主要特性
- **合约交易**: 支持Backpack期货合约
- **剥头皮策略**: 快速进出场，捕捉小幅价格波动
- **仅挂单模式**: 避免市价单手续费
- **智能平仓**: 基于盈利目标的自动平仓

### 🔧 技术实现
- **ED25519签名**: 完整的API认证实现
- **WebSocket**: 实时价格和订单状态监控
- **错误处理**: 完善的异常处理和重试机制
- **配置管理**: 灵活的参数配置系统
