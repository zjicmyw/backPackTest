# 更新历史记录

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
