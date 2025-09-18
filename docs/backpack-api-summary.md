# Backpack API 使用总结 (V1.0)

## 🎉 V1.0 版本特性

- ✅ **完整的API集成**: 涵盖所有必要的交易和查询接口
- ✅ **智能错误处理**: 优雅处理各种API错误和异常情况
- ✅ **高效的数据管理**: 实时同步订单和持仓状态
- ✅ **安全的认证机制**: ED25519签名确保API访问安全

## API 基本信息

- **API 地址**: `https://api.backpack.exchange/`
- **WebSocket 地址**: `wss://ws.backpack.exchange/`
- **认证方式**: ED25519 密钥对签名认证

## 认证机制

### 必需的请求头
- `X-API-Key`: Base64 编码的 ED25519 公钥
- `X-Signature`: Base64 编码的请求签名
- `X-Timestamp`: Unix 时间戳（毫秒）
- `X-Window`: 请求有效时间窗口（默认 5000ms，最大 60000ms）

### 签名生成步骤
1. 将请求体或查询参数按字母顺序排序并转换为查询字符串格式
2. 添加时间戳和窗口参数：`&timestamp=<timestamp>&window=<window>`
3. 在字符串前添加指令类型前缀，如：`instruction=orderExecute&...`
4. 使用 ED25519 私钥对整个字符串进行签名
5. 将签名进行 Base64 编码

### 指令类型 (Instruction Types)
- `accountQuery` - 账户查询
- `balanceQuery` - 余额查询
- `orderExecute` - 执行订单
- `orderQuery` - 查询订单
- `orderQueryAll` - 查询所有订单
- `orderCancel` - 取消订单
- `orderCancelAll` - 取消所有订单
- `fillHistoryQueryAll` - 查询成交历史
- `orderHistoryQueryAll` - 查询订单历史

## 主要 API 端点

### 1. 账户信息
- **端点**: `GET /api/v1/account`
- **指令**: `accountQuery`
- **描述**: 获取账户信息和余额
- **认证**: 需要签名

### 2. 市场数据

#### 获取代币价格（Ticker）
- **端点**: `GET /api/v1/ticker`
- **参数**: 
  - `symbol` (必需): 交易对符号，如 "BTC_USDT"
  - `interval` (可选): 时间间隔
- **描述**: 获取指定交易对的24小时统计数据
- **认证**: 不需要签名

#### 获取订单簿深度
- **端点**: `GET /api/v1/depth`
- **参数**: 
  - `symbol` (必需): 交易对符号
- **描述**: 获取指定交易对的订单簿深度（买1卖1等）
- **认证**: 不需要签名

### 3. 订单管理

#### 执行订单（下单）
- **端点**: `POST /api/v1/orders`
- **指令**: `orderExecute`
- **描述**: 批量提交订单到撮合引擎
- **认证**: 需要签名
- **请求体**: 订单数组，每个订单包含：
  - `symbol`: 交易对
  - `side`: "Bid" (买入) 或 "Ask" (卖出)
  - `orderType`: "Limit" (限价) 或 "Market" (市价)
  - `price`: 价格（限价单必需）
  - `quantity`: 数量
  - `reduceOnly`: 仅减仓标志（期货合约平仓时使用）
  - `postOnly`: 仅挂单标志（只做 maker，不做 taker）

#### 查询订单
- **端点**: `GET /api/v1/order`
- **指令**: `orderQuery`
- **参数**: 
  - `orderId`: 订单ID
  - `symbol`: 交易对
- **认证**: 需要签名

#### 查询所有订单
- **端点**: `GET /api/v1/orders`
- **指令**: `orderQueryAll`
- **参数**: 
  - `symbol` (可选): 交易对过滤
- **认证**: 需要签名

#### 取消订单
- **端点**: `DELETE /api/v1/order`
- **指令**: `orderCancel`
- **参数**: 
  - `orderId`: 订单ID
  - `symbol`: 交易对
- **认证**: 需要签名

### 4. 持仓查询

#### 查询持仓信息
- **端点**: `GET /api/v1/position`
- **指令**: `accountQuery`
- **参数**: 
  - `symbol` (可选): 交易对过滤
- **描述**: 获取当前持仓信息，包括数量、入场价格、未实现盈亏等
- **认证**: 需要签名
- **响应字段**: 
  - `netQuantity`: 净持仓数量
  - `entryPrice`: 入场价格
  - `markPrice`: 标记价格
  - `positionValue`: 持仓价值
  - `unrealizedPnl`: 未实现盈亏
  - `side`: 持仓方向 ("Long" 或 "Short")

## 响应格式

### 成功响应
- HTTP 状态码: 200
- Content-Type: `application/json; charset=utf-8`

### 错误响应
- HTTP 状态码: 400, 401, 500, 503
- 错误格式: 
```json
{
  "code": "ERROR_CODE",
  "message": "错误描述"
}
```

## 常见交易对格式
- 现货: `BTC_USDT`, `ETH_USDT`, `SOL_USDT`
- 合约: `BTC_USDC_PERP`, `ETH_USDC_PERP`, `SOL_USDC_PERP`

## 注意事项

1. **时间同步**: 确保本地时间与服务器时间同步，时间偏差过大会导致签名验证失败
2. **签名有效期**: 默认签名有效期为 5 秒，最长 60 秒
3. **批量订单**: 支持批量提交订单，每个订单需要单独的指令前缀
4. **错误处理**: 所有错误响应都是 JSON 格式，包含错误代码和描述
5. **限流**: API 可能有请求频率限制，需要合理控制请求频率

## 剥头皮机器人 API 使用经验

### 订单状态监控
- 使用 `executedQuantity` 字段判断订单是否成交
- 订单状态 `Filled` 表示完全成交，`PartiallyFilled` 表示部分成交
- 定期查询 `/api/v1/orders` 监控所有活跃订单状态

### 持仓管理
- 使用 `/api/v1/position` 获取实时持仓信息，而非本地计算
- `positionValue` 字段表示持仓的市值
- 当 `positionValue > 0` 时表示有持仓，`= 0` 时表示无持仓

### 百分比止盈策略
- **净盈利比例**: `PROFIT_TARGET` 表示除手续费外的净盈利比例
- **智能计算**: 总盈利比例 = 净盈利比例 + 手续费比例 (开仓+平仓)
- **示例**: 净盈利0.01% + 手续费0.02% = 总涨幅0.03%
- **止盈订单**: 必须设置 `reduceOnly: true` 参数
- **订单方向**: 止盈订单的 `side` 应与持仓方向相反
- **单一订单**: 确保同时只有一个活跃的止盈订单
- **挂单模式**: 止盈订单也使用 `postOnly: true` 确保只做 maker

### 持仓价值限制
- `MAX_POSITION_VALUE` 基于持仓价值而非 pending 订单数量
- 计算公式：`positionOrderCount = Math.ceil(positionValue / orderAmount)`
- 当达到限制时停止下新单，直到有订单平仓

### 统计显示优化
- **显示频率**: 每分钟显示一次，避免频繁刷屏
- **信息简化**: 显示总盈亏（未实现+已实现）而非分别显示

### 取消订单正确用法
- **API规范**: 使用 `DELETE /api/v1/order` 取消单个订单
- **请求体格式**: 必须在请求体中包含 `orderId` 和 `symbol`
- **参数要求**: `orderId` 或 `clientId` 必须指定一个（不能同时指定）
- **错误处理**: 优雅处理 "Order not found" 等API错误
- **示例代码**:
```javascript
const cancelPayload = { 
    orderId: orderId, 
    symbol: symbol 
};
await this.signedRequest('DELETE', '/api/v1/order', 'orderCancel', {}, cancelPayload);
```
- **视觉优化**: 使用边框设计和颜色指示盈亏状态
- **颜色系统**: 🟢盈利 / 🔴亏损 / ⚪平衡
- **时间格式**: 运行时间显示为 HH:MM 格式

### 智能价格调整
- **PostOnlyTaker错误处理**: 检测 "Order would immediately match and take" 错误
- **实时市场数据**: 通过 `/api/v1/depth` 获取最新买1卖1价格
- **动态价格调整**: 根据市场情况自动调整订单价格
- **安全间距计算**: 确保调整后价格不会立即成交
- **智能重试机制**: 价格调整不计入重试次数，快速重新挂单

### 错误处理
- 404 错误通常表示没有持仓，属于正常情况
- 网络错误需要重试机制
- 签名错误检查时间同步和密钥格式

## 开发建议

1. 使用专门的 ED25519 签名库进行签名操作
2. 实现请求重试机制处理网络错误
3. 缓存市场数据减少 API 调用
4. 实现完整的错误处理和日志记录
5. 测试环境先验证签名和请求格式的正确性
6. **机器人开发**：
   - 基于实际持仓而非本地状态做决策
   - 实现优雅的订单管理和错误恢复
   - 使用 UTC+8 时区记录日志便于调试
   - 所有配置参数从环境变量读取
