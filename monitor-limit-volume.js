#!/usr/bin/env node

/**
 * 限价刷量模式监控脚本
 * 
 * 用于监控限价刷量机器人的运行状态和交易统计
 */

require('dotenv').config();
const BackpackClient = require('./backpack-client.js');
const fs = require('fs');
const path = require('path');

/**
 * 显示帮助信息
 */
function showHelp() {
    console.log(`
📊 限价刷量模式监控脚本

用法: node monitor-limit-volume.js [选项]

选项:
  --help, -h              显示此帮助信息
  --symbol <SYMBOL>       交易对 (默认: BTC_USDC_PERP)
  --interval <SEC>         刷新间隔秒数 (默认: 5)
  --show-orders           显示当前订单
  --show-positions         显示当前持仓
  --show-stats             显示交易统计
  --show-all               显示所有信息

示例:
  # 基本监控
  node monitor-limit-volume.js

  # 自定义刷新间隔
  node monitor-limit-volume.js --interval 10

  # 显示所有信息
  node monitor-limit-volume.js --show-all
`);
}

/**
 * 解析命令行参数
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        symbol: 'BTC_USDC_PERP',
        interval: 5,
        showOrders: false,
        showPositions: false,
        showStats: false,
        showAll: false
    };
    
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--help':
            case '-h':
                showHelp();
                process.exit(0);
                break;
            case '--symbol':
                config.symbol = args[++i];
                break;
            case '--interval':
                config.interval = parseInt(args[++i]);
                break;
            case '--show-orders':
                config.showOrders = true;
                break;
            case '--show-positions':
                config.showPositions = true;
                break;
            case '--show-stats':
                config.showStats = true;
                break;
            case '--show-all':
                config.showAll = true;
                break;
            default:
                console.error(`未知参数: ${args[i]}`);
                showHelp();
                process.exit(1);
        }
    }
    
    return config;
}

/**
 * 创建API客户端
 */
function createClient() {
    const apiKey = process.env.BACKPACK_API_KEY;
    const privateKey = process.env.BACKPACK_PRIVATE_KEY;
    
    if (!apiKey || !privateKey) {
        console.error('❌ 缺少API密钥配置 (BACKPACK_API_KEY, BACKPACK_PRIVATE_KEY)');
        process.exit(1);
    }
    
    return new BackpackClient(apiKey, privateKey);
}

/**
 * 获取当前时间戳
 */
function getTimestamp() {
    return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

/**
 * 显示当前订单
 */
async function showOrders(client, symbol) {
    try {
        console.log(`\n📋 当前订单 (${symbol})`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        const orders = await client.getOpenOrders(symbol);
        
        if (!orders || orders.length === 0) {
            console.log('  无活跃订单');
            return;
        }
        
        orders.forEach((order, index) => {
            console.log(`  ${index + 1}. 订单ID: ${order.id}`);
            console.log(`     方向: ${order.side}`);
            console.log(`     类型: ${order.orderType}`);
            console.log(`     价格: ${order.price}`);
            console.log(`     数量: ${order.quantity}`);
            console.log(`     状态: ${order.status}`);
            console.log(`     时间: ${new Date(order.timestamp).toLocaleString('zh-CN')}`);
            console.log('');
        });
        
    } catch (error) {
        console.error('❌ 获取订单失败:', error.message);
    }
}

/**
 * 显示当前持仓
 */
async function showPositions(client, symbol) {
    try {
        console.log(`\n💼 当前持仓 (${symbol})`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        const positions = await client.getPositions(symbol);
        const position = positions.find(p => p.symbol === symbol);
        
        if (!position || parseFloat(position.netQuantity) === 0) {
            console.log('  无持仓');
            return;
        }
        
        const netQuantity = parseFloat(position.netQuantity);
        const side = netQuantity > 0 ? '多头' : '空头';
        
        console.log(`  持仓方向: ${side}`);
        console.log(`  持仓数量: ${Math.abs(netQuantity)}`);
        console.log(`  未实现盈亏: ${position.unrealizedPnl || 'N/A'}`);
        console.log(`  保证金: ${position.margin || 'N/A'}`);
        console.log(`  杠杆: ${position.leverage || 'N/A'}`);
        
    } catch (error) {
        console.error('❌ 获取持仓失败:', error.message);
    }
}

/**
 * 显示交易统计
 */
async function showStats(client, symbol) {
    try {
        console.log(`\n📊 交易统计 (${symbol})`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        // 获取今日交易历史
        const today = new Date().toISOString().split('T')[0];
        const historyOrders = await client.getOrderHistory({
            symbol: symbol,
            from: `${today}T00:00:00.000Z`,
            to: `${today}T23:59:59.999Z`
        });
        
        if (!historyOrders || historyOrders.length === 0) {
            console.log('  今日无交易记录');
            return;
        }
        
        const filledOrders = historyOrders.filter(order => order.status === 'Filled');
        const totalTrades = filledOrders.length;
        const totalVolume = filledOrders.reduce((sum, order) => {
            return sum + (parseFloat(order.price) * parseFloat(order.quantity));
        }, 0);
        
        console.log(`  今日交易次数: ${totalTrades}`);
        console.log(`  今日交易量: ${totalVolume.toFixed(2)} USDC`);
        console.log(`  平均每笔: ${totalTrades > 0 ? (totalVolume / totalTrades).toFixed(2) : 0} USDC`);
        
        // 分析订单类型
        const limitOrders = filledOrders.filter(order => order.orderType === 'Limit');
        const marketOrders = filledOrders.filter(order => order.orderType === 'Market');
        
        console.log(`  限价单: ${limitOrders.length} 笔`);
        console.log(`  市价单: ${marketOrders.length} 笔`);
        
        // 分析买卖方向
        const buyOrders = filledOrders.filter(order => order.side === 'Bid');
        const sellOrders = filledOrders.filter(order => order.side === 'Ask');
        
        console.log(`  买单: ${buyOrders.length} 笔`);
        console.log(`  卖单: ${sellOrders.length} 笔`);
        
    } catch (error) {
        console.error('❌ 获取交易统计失败:', error.message);
    }
}

/**
 * 显示价格信息
 */
async function showPriceInfo(client, symbol) {
    try {
        const bestPrices = await client.getBestPrices(symbol);
        
        if (!bestPrices.bestBid || !bestPrices.bestAsk) {
            console.log('❌ 无法获取价格信息');
            return;
        }
        
        const bidPrice = bestPrices.bestBid[0];
        const askPrice = bestPrices.bestAsk[0];
        const spread = askPrice - bidPrice;
        const spreadPercent = (spread / bidPrice) * 100;
        
        console.log(`\n💰 价格信息 (${symbol})`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`  买1价格: ${bidPrice}`);
        console.log(`  卖1价格: ${askPrice}`);
        console.log(`  价差: ${spread.toFixed(4)} (${spreadPercent.toFixed(4)}%)`);
        console.log(`  更新时间: ${getTimestamp()}`);
        
    } catch (error) {
        console.error('❌ 获取价格信息失败:', error.message);
    }
}

/**
 * 显示系统状态
 */
function showSystemStatus() {
    console.log(`\n🖥️  系统状态`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  当前时间: ${getTimestamp()}`);
    console.log(`  运行时长: ${process.uptime().toFixed(0)} 秒`);
    console.log(`  内存使用: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Node.js版本: ${process.version}`);
}

/**
 * 清屏
 */
function clearScreen() {
    console.clear();
}

/**
 * 主监控循环
 */
async function startMonitoring(config) {
    const client = createClient();
    
    console.log('🚀 启动限价刷量模式监控');
    console.log(`📊 监控交易对: ${config.symbol}`);
    console.log(`⏱️  刷新间隔: ${config.interval} 秒`);
    console.log('💡 按 Ctrl+C 退出监控');
    
    const monitor = async () => {
        try {
            clearScreen();
            
            console.log(`📊 限价刷量模式监控 - ${getTimestamp()}`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            
            // 显示价格信息
            await showPriceInfo(client, config.symbol);
            
            // 根据配置显示不同信息
            if (config.showAll || config.showOrders) {
                await showOrders(client, config.symbol);
            }
            
            if (config.showAll || config.showPositions) {
                await showPositions(client, config.symbol);
            }
            
            if (config.showAll || config.showStats) {
                await showStats(client, config.symbol);
            }
            
            // 显示系统状态
            showSystemStatus();
            
            console.log('\n💡 按 Ctrl+C 退出监控');
            
        } catch (error) {
            console.error('❌ 监控错误:', error.message);
        }
    };
    
    // 立即执行一次
    await monitor();
    
    // 设置定时器
    const intervalId = setInterval(monitor, config.interval * 1000);
    
    // 优雅关闭
    process.on('SIGINT', () => {
        console.log('\n\n👋 监控已停止');
        clearInterval(intervalId);
        process.exit(0);
    });
}

/**
 * 主函数
 */
async function main() {
    try {
        const config = parseArgs();
        
        if (config.showAll) {
            config.showOrders = true;
            config.showPositions = true;
            config.showStats = true;
        }
        
        await startMonitoring(config);
        
    } catch (error) {
        console.error('❌ 启动失败:', error.message);
        process.exit(1);
    }
}

// 启动程序
if (require.main === module) {
    main();
}

module.exports = { main, showHelp };
