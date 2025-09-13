# Backpack API 使用总结

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

## 开发建议

1. 使用专门的 ED25519 签名库进行签名操作
2. 实现请求重试机制处理网络错误
3. 缓存市场数据减少 API 调用
4. 实现完整的错误处理和日志记录
5. 测试环境先验证签名和请求格式的正确性
