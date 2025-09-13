const BackpackClient = require('./backpack-client');
require('dotenv').config();

/**
 * 测试脚本 - 包含公开 API 和需要认证的 API 功能
 */

// 从环境变量读取 API 密钥
const API_KEY = process.env.BACKPACK_API_KEY;
const PRIVATE_KEY = process.env.BACKPACK_PRIVATE_KEY;

// 创建客户端实例
const client = new BackpackClient(API_KEY || 'dummy_key', PRIVATE_KEY || 'dummy_private_key');

/**
 * 测试获取代币价格
 */
async function testGetTicker() {
    console.log('\n=== 测试获取代币价格 ===');
    
    try {
        const ticker = await client.getTicker('BTC_USDC_PERP');
        console.log('✅ BTC_USDC_PERP 价格获取成功:');
        console.log(`   当前价格: $${ticker.lastPrice}`);
        console.log(`   24h 变化: ${ticker.priceChangePercent}%`);
        console.log(`   成交量: ${ticker.volume}`);
        return true;
    } catch (error) {
        console.error('❌ 价格获取失败:', error.message);
        return false;
    }
}

/**
 * 测试获取订单簿深度
 */
async function testGetDepth() {
    console.log('\n=== 测试获取订单簿深度 ===');
    
    try {
        const depth = await client.getDepth('ETH_USDC_PERP');
        console.log('✅ ETH_USDC_PERP 订单簿获取成功:');
        
        if (depth.bids && depth.bids.length > 0) {
            // 买1：出价最高的买单（bids数组最后一个元素）
            const bestBid = depth.bids[depth.bids.length - 1];
            console.log(`   买1: $${bestBid[0]} (数量: ${bestBid[1]})`);
        }
        
        if (depth.asks && depth.asks.length > 0) {
            // 卖1：要价最低的卖单（asks数组第一个元素）
            const bestAsk = depth.asks[0];
            console.log(`   卖1: $${bestAsk[0]} (数量: ${bestAsk[1]})`);
        }
        
        console.log(`   时间戳: ${depth.timestamp}`);
        return true;
    } catch (error) {
        console.error('❌ 订单簿获取失败:', error.message);
        return false;
    }
}

/**
 * 测试获取多个交易对的价格
 */
async function testMultipleTickers() {
    console.log('\n=== 测试获取多个交易对价格 ===');
    
    const symbols = ['BTC_USDC_PERP', 'ETH_USDC_PERP', 'SOL_USDC_PERP'];
    let successCount = 0;
    
    for (const symbol of symbols) {
        try {
            const ticker = await client.getTicker(symbol);
            console.log(`✅ ${symbol}: $${ticker.lastPrice} (${ticker.priceChangePercent}%)`);
            successCount++;
        } catch (error) {
            console.error(`❌ ${symbol} 获取失败:`, error.message);
        }
    }
    
    console.log(`\\n成功获取 ${successCount}/${symbols.length} 个交易对价格`);
    return successCount === symbols.length;
}

/**
 * 测试获取买1卖1价格的便捷方法
 */
async function testBestPrices() {
    console.log('\n=== 测试买1卖1价格获取 ===');
    
    try {
        const bestPrices = await client.getBestPrices('SOL_USDC_PERP');
        console.log('✅ SOL_USDC_PERP 买1卖1价格获取成功:');
        
        if (bestPrices.bestBid) {
            console.log(`   买1: $${bestPrices.bestBid[0]} (数量: ${bestPrices.bestBid[1]})`);
        }
        
        if (bestPrices.bestAsk) {
            console.log(`   卖1: $${bestPrices.bestAsk[0]} (数量: ${bestPrices.bestAsk[1]})`);
        }
        
        if (bestPrices.bestBid && bestPrices.bestAsk) {
            const spread = (bestPrices.bestAsk[0] - bestPrices.bestBid[0]).toFixed(4);
            console.log(`   价差: $${spread}`);
        }
        
        return true;
    } catch (error) {
        console.error('❌ 买1卖1价格获取失败:', error.message);
        return false;
    }
}

/**
 * 测试合约价格获取
 */
async function testFuturesPrices() {
    console.log('\n=== 测试合约价格获取 ===');
    
    const contractSymbols = ['BTC_USDC_PERP', 'ETH_USDC_PERP'];
    let successCount = 0;
    
    for (const symbol of contractSymbols) {
        try {
            const ticker = await client.getTicker(symbol);
            console.log(`✅ ${symbol}: $${ticker.lastPrice}`);
            successCount++;
        } catch (error) {
            console.error(`❌ ${symbol} 获取失败:`, error.message);
        }
    }
    
    return successCount > 0;
}

/**
 * 测试下单功能（需要 API 密钥）
 */
async function testPlaceOrders() {
    console.log('\n=== 测试下单功能 ===');
    
    // 检查是否有 API 密钥
    if (!API_KEY || API_KEY.includes('your_') || !PRIVATE_KEY || PRIVATE_KEY.includes('your_')) {
        console.log('⚠️  跳过下单测试 - 需要配置 API 密钥');
        console.log('   请创建 .env 文件并设置 BACKPACK_API_KEY 和 BACKPACK_PRIVATE_KEY');
        return false;
    }
    
    const symbol = 'BTC_USDC_PERP';
    
    try {
        // 获取当前买1卖1价格
        const bestPrices = await client.getBestPrices(symbol);
        console.log(`📊 ${symbol} 当前市场状况:`);
        console.log(`   买1: $${bestPrices.bestBid[0]} (数量: ${bestPrices.bestBid[1]})`);
        console.log(`   卖1: $${bestPrices.bestAsk[0]} (数量: ${bestPrices.bestAsk[1]})`);
        
        const bestBidPrice = bestPrices.bestBid[0];
        const bestAskPrice = bestPrices.bestAsk[0];
        
        // 计算 10 USDC 对应的数量（限制小数位数）
        const quantityAtBid = (10 / bestBidPrice).toFixed(4);
        const quantityAtAsk = (10 / bestAskPrice).toFixed(4);
        
        // 计算测试用的价格（下浮0.1%的买单，不容易成交）
        const testBuyPrice = (bestBidPrice * 0.999).toFixed(1);
        const testSellPrice = (bestAskPrice * 1.001).toFixed(1);
        
        console.log(`\\n💰 准备下单:`);
        console.log(`   按买1价格 ${bestBidPrice} 买入 10 USDC (约 ${quantityAtBid} BTC)`);
        console.log(`   按卖1价格 ${bestAskPrice} 卖出 10 USDC (约 ${quantityAtAsk} BTC)`);
        console.log(`   测试买单价格 ${testBuyPrice} (下浮0.1%，不易成交)`);
        console.log(`   测试卖单价格 ${testSellPrice} (上浮0.1%，不易成交)`);
        
        // 下单1：按买1价格买入（做多）
        console.log(`\\n📈 下单1: 按买1价格买入`);
        const buyOrder = await client.placeOrder(
            symbol,
            'Bid',           // 买入
            'Limit',          // 限价单
            quantityAtBid,    // 数量
            bestBidPrice      // 价格
        );
        console.log(`✅ 买入订单成功:`, buyOrder);
        
        // 等待一下
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // 下单2：按卖1价格卖出（做空）
        console.log(`\\n📉 下单2: 按卖1价格卖出`);
        const sellOrder = await client.placeOrder(
            symbol,
            'Ask',           // 卖出
            'Limit',          // 限价单
            quantityAtAsk,    // 数量
            bestAskPrice      // 价格
        );
        console.log(`✅ 卖出订单成功:`, sellOrder);
        
        // 查询订单状态
        console.log(`\\n📋 查询订单状态:`);
        const orders = await client.getOrders(symbol);
        console.log(`当前活跃订单数量: ${orders.length}`);
        
        if (orders.length > 0) {
            orders.slice(0, 3).forEach((order, index) => {
                console.log(`  ${index + 1}. ${order.symbol} | ${order.side} | ${order.orderType}`);
                console.log(`     价格: $${order.price} | 数量: ${order.quantity}`);
                console.log(`     状态: ${order.status} | 订单ID: ${order.id || order.orderId}`);
            });
        }
        
        return true;
    } catch (error) {
        console.error('❌ 下单测试失败:', error.message);
        return false;
    }
}

/**
 * 测试取消订单功能
 */
async function testCancelOrders() {
    console.log('\n=== 测试取消订单功能 ===');
    
    if (!API_KEY || API_KEY.includes('your_') || !PRIVATE_KEY || PRIVATE_KEY.includes('your_')) {
        console.log('⚠️  跳过取消订单测试 - 需要配置 API 密钥');
        return false;
    }
    
    try {
        const symbol = 'BTC_USDC_PERP';
        const orders = await client.getOrders(symbol);
        
        if (orders.length === 0) {
            console.log('📝 当前没有活跃订单，跳过取消测试');
            return true;
        }
        
        // 获取当前买1卖1价格作为参考
        const bestPrices = await client.getBestPrices(symbol);
        const currentBid = parseFloat(bestPrices.bestBid[0]);
        const currentAsk = parseFloat(bestPrices.bestAsk[0]);
        
        // 过滤出测试订单（不容易成交的订单或最新创建的订单）
        const testOrders = orders.filter(order => {
            const price = parseFloat(order.price);
            const side = order.side;
            
            // 方法1: 价格偏离市价的订单（不容易成交）
            if (side === 'Bid' && price < currentBid * 0.999) {
                return true; // 买单价格低于买1价格的99.9%
            }
            if (side === 'Ask' && price > currentAsk * 1.001) {
                return true; // 卖单价格高于卖1价格的100.1%
            }
            
            // 方法2: 如果没有偏离价格的订单，选择最新的2个订单用于测试
            return false;
        });
        
        // 如果没有找到偏离价格的订单，使用最新的订单进行测试
        if (testOrders.length === 0 && orders.length > 0) {
            console.log('📝 未找到偏离价格的订单，使用最新的订单进行取消测试');
            testOrders.push(...orders.slice(-2)); // 取最后两个订单
        }
        
        if (testOrders.length === 0) {
            console.log('📝 没有找到测试订单（不容易成交的订单），跳过取消测试');
            console.log('   提示：测试订单应该是价格偏离市价的订单');
            return true;
        }
        
        console.log(`📋 找到 ${testOrders.length} 个测试订单，尝试取消前2个:`);
        
        let cancelledCount = 0;
        for (let i = 0; i < Math.min(2, testOrders.length); i++) {
            const order = testOrders[i];
            const orderId = order.id || order.orderId;
            try {
                console.log(`   取消测试订单 ${i + 1}: ${orderId} (价格: $${order.price})`);
                await client.cancelOrder(orderId, order.symbol);
                console.log(`   ✅ 订单 ${orderId} 取消成功`);
                cancelledCount++;
            } catch (error) {
                console.log(`   ❌ 订单 ${orderId} 取消失败: ${error.message}`);
            }
        }
        
        console.log(`\\n📊 取消结果: ${cancelledCount}/${Math.min(2, testOrders.length)} 个测试订单取消成功`);
        return cancelledCount > 0;
    } catch (error) {
        console.error('❌ 取消订单测试失败:', error.message);
        return false;
    }
}

/**
 * 运行所有测试
 */
async function runTests() {
    console.log('🧪 Backpack API 功能测试');
    console.log('==========================');
    
    // 检查 API 密钥配置
    if (API_KEY && !API_KEY.includes('your_') && PRIVATE_KEY && !PRIVATE_KEY.includes('your_')) {
        console.log('✅ 检测到 API 密钥，将运行完整测试（包括下单功能）');
    } else {
        console.log('⚠️  未检测到 API 密钥，将只运行公开 API 测试');
        console.log('   要测试下单功能，请创建 .env 文件并配置密钥');
    }
    
    const tests = [
        { name: '代币价格获取', func: testGetTicker },
        { name: '订单簿深度获取', func: testGetDepth },
        { name: '多个交易对价格', func: testMultipleTickers },
        { name: '买1卖1价格', func: testBestPrices },
        { name: '合约价格', func: testFuturesPrices },
        { name: '下单功能', func: testPlaceOrders },
        { name: '取消订单', func: testCancelOrders }
    ];
    
    let passedTests = 0;
    
    for (const test of tests) {
        try {
            const result = await test.func();
            if (result) {
                passedTests++;
            }
        } catch (error) {
            console.error(`测试 "${test.name}" 执行失败:`, error.message);
        }
        
        // 添加延迟避免请求过于频繁
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log(`\\n📊 测试结果: ${passedTests}/${tests.length} 通过`);
    
    if (passedTests === tests.length) {
        console.log('✅ 所有公开 API 测试通过！');
        console.log('\\n📝 下一步:');
        console.log('   1. 设置您的 API 密钥环境变量');
        console.log('   2. 运行 npm start 执行完整演示');
    } else {
        console.log('⚠️  部分测试失败，请检查网络连接或 API 状态');
    }
}

/**
 * 程序入口
 */
if (require.main === module) {
    runTests().catch(error => {
        console.error('测试执行失败:', error);
        process.exit(1);
    });
}

module.exports = {
    runTests
};
