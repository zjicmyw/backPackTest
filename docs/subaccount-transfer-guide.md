# 子账户转账功能使用指南

## 概述

本指南介绍如何使用 Backpack API 进行子账户之间的转账操作。

## 功能说明

Backpack API 支持通过提现（Withdrawal）API 进行账户间转账。当转账到另一个账户的存款地址时，系统会自动识别为内部转账（`isInternal: true`）。

## API 方法

### 1. requestWithdrawal - 请求转账

执行转账操作。

```javascript
const result = await client.requestWithdrawal({
    address: '目标地址',
    blockchain: 'Solana', // 或 'Ethereum'
    quantity: '10',
    symbol: 'USDC',
    twoFactorToken: '2FA令牌（可选）',
    autoBorrow: false, // 可选
    autoLendRedeem: false // 可选
});

console.log('是否为内部转账:', result.isInternal);
console.log('转账状态:', result.status);
```

### 2. getDepositAddress - 获取存款地址

获取账户的存款地址，用于子账户转账。

```javascript
const addressInfo = await client.getDepositAddress('Solana');
console.log('存款地址:', addressInfo.address);
```

### 3. getWithdrawals - 查询转账历史

查询转账历史记录。

```javascript
const withdrawals = await client.getWithdrawals({
    symbol: 'USDC',
    from: Date.now() - 86400000, // 最近24小时
    to: Date.now()
});

withdrawals.forEach(w => {
    console.log(`转账ID: ${w.id}, 内部转账: ${w.isInternal}, 状态: ${w.status}`);
});
```

### 4. transferToSubaccount - 子账户转账便捷方法

便捷方法，自动获取目标账户地址并执行转账。

```javascript
// 需要两个客户端实例
const sourceClient = new BackpackClient(sourceApiKey, sourcePrivateKey);
const targetClient = new BackpackClient(targetApiKey, targetPrivateKey);

const result = await sourceClient.transferToSubaccount({
    targetClient: targetClient,
    quantity: '10',
    symbol: 'USDC',
    blockchain: 'Solana' // 可选，默认 'Solana'
});

if (result.isInternal) {
    console.log('✅ 子账户转账成功');
}
```

## 测试脚本使用

### 配置账户

在 `.env` 文件中配置多个账户：

```env
ACCOUNT_1_API_KEY=your_api_key_1
ACCOUNT_1_PRIVATE_KEY=your_private_key_1
ACCOUNT_1_NAME=主账户

ACCOUNT_2_API_KEY=your_api_key_2
ACCOUNT_2_PRIVATE_KEY=your_private_key_2
ACCOUNT_2_NAME=子账户1
```

### 运行测试

```bash
node test-subaccount-transfer.js [源账户编号] [目标账户编号] [转账金额] [资产符号] [区块链]
```

示例：

```bash
# 从账户1转账10 USDC到账户2（使用Solana网络）
node test-subaccount-transfer.js 1 2 10 USDC Solana

# 从账户1转账1 USDC到账户2（使用默认Solana网络）
node test-subaccount-transfer.js 1 2 1 USDC
```

### 测试脚本功能

1. **账户余额查询** - 检查源账户和目标账户的余额
2. **存款地址获取** - 自动获取目标账户的存款地址
3. **转账执行** - 执行转账并检查结果
4. **转账验证** - 检查 `isInternal` 字段确认是否为内部转账
5. **余额变化检查** - 等待后检查目标账户余额是否增加
6. **转账历史查询** - 查询最近的转账记录

## 注意事项

### 1. 2FA 验证

如果目标地址未在地址簿中配置为免2FA地址，转账时需要提供 `twoFactorToken`。

配置免2FA地址：
https://backpack.exchange/settings/withdrawal-addresses?twoFactorWithdrawalAddress=true

### 2. 余额要求

确保源账户有足够的可用余额进行转账。

### 3. 转账状态

转账可能的状态：
- `Pending` - 处理中
- `Completed` - 已完成
- `Failed` - 失败
- `Cancelled` - 已取消

### 4. 内部转账识别

转账成功后，检查返回结果中的 `isInternal` 字段：
- `true` - 确认为内部转账（子账户转账）
- `false` - 外部转账
- `undefined` - API未返回此字段（需要进一步验证）

### 5. 区块链选择

支持的区块链类型：
- `Solana` - Solana网络（推荐，通常手续费较低）
- `Ethereum` - 以太坊网络
- 其他支持的区块链类型

### 6. 转账延迟

内部转账通常比外部转账更快，但可能需要几秒钟到几分钟的处理时间。

## 错误处理

常见错误及解决方案：

### 余额不足
```
错误: 余额不足: 可用余额 X USDC, 需要 Y USDC
解决: 确保源账户有足够的可用余额
```

### 无法获取存款地址
```
错误: 无法获取目标账户存款地址
解决: 检查目标账户配置和网络连接
```

### 2FA 验证失败
```
错误: Two factor authentication required
解决: 提供有效的 twoFactorToken 或在地址簿中配置免2FA地址
```

### 地址无效
```
错误: Invalid address
解决: 确保使用正确的存款地址格式
```

## 示例代码

### 完整示例

```javascript
const BackpackClient = require('./backpack-client');

async function transferBetweenSubaccounts() {
    // 创建客户端
    const sourceClient = new BackpackClient(
        process.env.ACCOUNT_1_API_KEY,
        process.env.ACCOUNT_1_PRIVATE_KEY
    );
    
    const targetClient = new BackpackClient(
        process.env.ACCOUNT_2_API_KEY,
        process.env.ACCOUNT_2_PRIVATE_KEY
    );

    try {
        // 1. 检查余额
        const sourceBalances = await sourceClient.getBalances();
        const usdcBalance = sourceBalances.find(b => b.token === 'USDC');
        console.log('源账户USDC余额:', usdcBalance);

        // 2. 获取目标账户地址
        const targetAddress = await targetClient.getDepositAddress('Solana');
        console.log('目标账户地址:', targetAddress.address);

        // 3. 执行转账
        const result = await sourceClient.requestWithdrawal({
            address: targetAddress.address,
            blockchain: 'Solana',
            quantity: '10',
            symbol: 'USDC'
        });

        console.log('转账结果:', result);
        console.log('是否为内部转账:', result.isInternal);

        // 4. 等待并检查余额
        await new Promise(resolve => setTimeout(resolve, 5000));
        const targetBalances = await targetClient.getBalances();
        const targetUsdc = targetBalances.find(b => b.token === 'USDC');
        console.log('目标账户USDC余额:', targetUsdc);

    } catch (error) {
        console.error('转账失败:', error.message);
    }
}

transferBetweenSubaccounts();
```

## 测试建议

1. **小额测试** - 首次使用时，使用小额资金进行测试
2. **检查余额** - 转账前后都检查余额变化
3. **验证状态** - 检查转账状态和 `isInternal` 字段
4. **查看历史** - 查询转账历史确认转账记录
5. **错误处理** - 妥善处理各种错误情况

## 相关文档

- [Backpack API 文档](https://docs.backpack.exchange/)
- [OpenAPI 规范](./openapi.json)
- [API 使用总结](./backpack-api-summary.md)
