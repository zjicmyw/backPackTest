#!/usr/bin/env node

/**
 * 剥头皮交易机器人启动脚本
 * 
 * 使用方法:
 * node start-bot.js [配置选项]
 * 
 * 环境变量:
 * - BACKPACK_API_KEY: Backpack API 公钥
 * - BACKPACK_PRIVATE_KEY: Backpack API 私钥
 * - SYMBOL: 交易对 (默认: BTC_USDC_PERP)
 * - ORDER_AMOUNT: 每单金额 (默认: 100)
 * - PROFIT_TARGET: 止盈目标 (默认: 0.01)
 * - MAX_ACTIVE_ORDERS: 最大活跃订单数 (默认: 40)
 * - TRADE_DIRECTION: 交易方向 (默认: buy)
 * - LOG_LEVEL: 日志级别 (默认: INFO)
 */

const ScalpingBot = require('./scalping-bot');
const config = require('./bot-config');

// 解析命令行参数
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {};
    
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i].replace('--', '');
        const value = args[i + 1];
        
        if (value !== undefined) {
            // 尝试转换数字
            if (!isNaN(value) && value !== '') {
                options[key] = parseFloat(value);
            } else {
                options[key] = value;
            }
        }
    }
    
    return options;
}

// 验证配置
function validateConfig(config) {
    const errors = [];
    
    if (!config.api.apiKey) {
        errors.push('缺少 BACKPACK_API_KEY 环境变量');
    }
    
    if (!config.api.privateKey) {
        errors.push('缺少 BACKPACK_PRIVATE_KEY 环境变量');
    }
    
    if (config.trading.orderAmount <= 0) {
        errors.push('订单金额必须大于 0');
    }
    
    if (config.trading.profitTarget <= 0) {
        errors.push('止盈目标必须大于 0');
    }
    
    if (config.trading.maxActiveOrders <= 0) {
        errors.push('最大活跃订单数必须大于 0');
    }
    
    if (!['buy', 'sell'].includes(config.trading.tradeDirection)) {
        errors.push('交易方向必须是 "buy" 或 "sell"');
    }
    
    if (errors.length > 0) {
        console.error('❌ 配置验证失败:');
        errors.forEach(error => console.error(`   - ${error}`));
        process.exit(1);
    }
}

// 显示启动信息
function showStartupInfo(config) {
    console.log('🤖 Backpack 剥头皮交易机器人');
    console.log('================================');
    console.log(`交易对: ${config.trading.symbol}`);
    console.log(`每单金额: ${config.trading.orderAmount} USDC`);
    console.log(`止盈目标: ${config.trading.profitTarget} USDC`);
    console.log(`最大订单数: ${config.trading.maxActiveOrders}`);
    console.log(`交易方向: ${config.trading.tradeDirection}`);
    console.log(`价格偏移: ${(config.trading.priceOffset * 100).toFixed(3)}%`);
    console.log(`订单等待: ${config.trading.orderWaitTime} 秒`);
    console.log(`日志级别: ${config.trading.logLevel || 'INFO'}`);
    console.log('================================\n');
}

// 主函数
async function main() {
    try {
        // 解析命令行参数
        const cliOptions = parseArgs();
        
        // 合并配置
        const finalConfig = {
            ...config.trading,
            ...cliOptions,
            apiKey: config.api.apiKey,
            privateKey: config.api.privateKey,
            logLevel: config.logging.level,
            enableCsvLog: config.logging.enableCsvLog,
            enableFileLog: config.logging.enableFileLog,
            fees: config.trading.fees, // 确保手续费配置被传递
        };
        
        // 验证配置
        validateConfig({ api: config.api, trading: finalConfig });
        
        // 显示启动信息
        showStartupInfo({ trading: finalConfig });
        
        // 创建并启动机器人
        const bot = new ScalpingBot(finalConfig);
        
        // 优雅关闭处理
        let isShuttingDown = false;
        
        const shutdown = async (signal) => {
            if (isShuttingDown) return;
            isShuttingDown = true;
            
            console.log(`\n📴 收到 ${signal} 信号，正在安全关闭机器人...`);
            
            try {
                bot.stop();
                console.log('✅ 机器人已安全关闭');
                process.exit(0);
            } catch (error) {
                console.error('❌ 关闭过程中发生错误:', error.message);
                process.exit(1);
            }
        };
        
        // 注册信号处理器
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGUSR1', () => shutdown('SIGUSR1'));
        process.on('SIGUSR2', () => shutdown('SIGUSR2'));
        
        // 处理未捕获的异常
        process.on('uncaughtException', (error) => {
            console.error('❌ 未捕获的异常:', error);
            shutdown('uncaughtException');
        });
        
        process.on('unhandledRejection', (reason, promise) => {
            console.error('❌ 未处理的 Promise 拒绝:', reason);
            shutdown('unhandledRejection');
        });
        
        // 启动机器人
        console.log('🚀 正在启动机器人...\n');
        await bot.start();
        
    } catch (error) {
        console.error('❌ 启动失败:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// 显示帮助信息
function showHelp() {
    console.log(`
🤖 Backpack 剥头皮交易机器人

使用方法:
  node start-bot.js [选项]

选项:
  --symbol <symbol>              交易对 (默认: BTC_USDC_PERP)
  --order-amount <amount>        每单金额 USDC (默认: 100)
  --profit-target <target>       止盈目标 USDC (默认: 0.01)
  --max-active-orders <count>    最大活跃订单数 (默认: 40)
  --trade-direction <direction>  交易方向 buy/sell (默认: buy)
  --order-wait-time <seconds>    订单间等待时间秒 (默认: 450)
  --log-level <level>           日志级别 DEBUG/INFO/WARN/ERROR (默认: INFO)
  --help                        显示此帮助信息

环境变量:
  BACKPACK_API_KEY               Backpack API 公钥 (必需)
  BACKPACK_PRIVATE_KEY           Backpack API 私钥 (必需)
  SYMBOL                         交易对
  ORDER_AMOUNT                   每单金额
  PROFIT_TARGET                  止盈目标
  MAX_ACTIVE_ORDERS              最大活跃订单数
  TRADE_DIRECTION                交易方向
  ORDER_WAIT_TIME                订单间等待时间
  LOG_LEVEL                      日志级别

示例:
  # 使用默认配置
  node start-bot.js
  
  # 自定义配置
  node start-bot.js --symbol ETH_USDC_PERP --order-amount 50 --profit-target 0.005
  
  # 使用环境变量
  SYMBOL=SOL_USDC_PERP ORDER_AMOUNT=200 node start-bot.js
`);
}

// 检查是否请求帮助
if (process.argv.includes('--help') || process.argv.includes('-h')) {
    showHelp();
    process.exit(0);
}

// 启动主程序
main().catch(error => {
    console.error('❌ 程序执行失败:', error);
    process.exit(1);
});
