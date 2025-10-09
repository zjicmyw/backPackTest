#!/usr/bin/env node

/**
 * 速刷合约交易机器人启动脚本
 * 
 * 使用方法：
 * node start-volume-bot.js
 * 
 * 或使用环境变量：
 * VOLUME_SYMBOL=ETH_USDC_PERP VOLUME_ORDER_AMOUNT=50 node start-volume-bot.js
 */

require('dotenv').config();
const VolumeBot = require('./volume-bot.js');
const volumeBotConfig = require('./volume-bot-config.js');

/**
 * 显示帮助信息
 */
function showHelp() {
    console.log(`
🚀 Backpack 速刷合约交易机器人 V1.0

用法: node start-volume-bot.js [选项]

选项:
  --help, -h              显示帮助信息
  --symbol <SYMBOL>       交易对 (默认: BTC_USDC_PERP)
  --amount <AMOUNT>       每单金额 USDC (默认: 100)
  --side <SIDE>           限价挂单方向 buy/sell (默认: buy)
  --max-trades <COUNT>    最大交易次数 (默认: 1000)
  --volatility1 <PCT>     1分钟波动阈值 (默认: 0.02)
  --volatility2 <PCT>     5分钟波动阈值 (默认: 0.05)
  --test-mode             测试模式 (遇到错误立即停止，便于调试)

环境变量:
  BACKPACK_API_KEY        API 公钥 (必需)
  BACKPACK_PRIVATE_KEY    API 私钥 (必需)
  VOLUME_SYMBOL           交易对
  VOLUME_ORDER_AMOUNT     每单金额
  VOLUME_LIMIT_SIDE       挂单方向
  VOLUME_MAX_TRADES       最大交易次数
  VOLUME_VOLATILITY_1_THRESHOLD  1分钟波动阈值
  VOLUME_VOLATILITY_2_THRESHOLD  5分钟波动阈值
  VOLUME_TEST_MODE        测试模式 (true/false)

示例:
  # 使用默认配置
  node start-volume-bot.js

  # 自定义参数
  node start-volume-bot.js --symbol ETH_USDC_PERP --amount 50 --side sell

  # 使用环境变量
  VOLUME_SYMBOL=SOL_USDC_PERP VOLUME_ORDER_AMOUNT=200 node start-volume-bot.js

功能特性:
  ✅ 限价开仓 + 市价关仓快速交易循环
  ✅ WebSocket 实时价格监控
  ✅ 双重波动风控机制 (1分钟/5分钟)
  ✅ 完整交易次数限制
  ✅ 详细CSV交易日志记录
  ✅ 优雅关闭 (Ctrl+C)

风险提示:
  ⚠️  这是自动化交易程序，请谨慎使用
  ⚠️  建议先在测试环境充分测试
  ⚠️  确保账户有足够的USDC余额
  ⚠️  监控网络连接和市场波动
`);
}

/**
 * 解析命令行参数
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const config = {};

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        
        switch (arg) {
            case '--help':
            case '-h':
                showHelp();
                process.exit(0);
                break;
                
            case '--symbol':
                config.symbol = args[++i];
                break;
                
            case '--amount':
                config.orderAmount = parseFloat(args[++i]);
                break;
                
            case '--side':
                config.limitOrderSide = args[++i];
                break;
                
            case '--max-trades':
                config.maxTrades = parseInt(args[++i]);
                break;
                
            case '--volatility1':
                config.volatility1Threshold = parseFloat(args[++i]);
                break;
                
            case '--volatility2':
                config.volatility2Threshold = parseFloat(args[++i]);
                break;
                
            case '--test-mode':
                config.testMode = true;
                break;
                
            default:
                if (arg.startsWith('--')) {
                    console.error(`未知参数: ${arg}`);
                    console.log('使用 --help 查看帮助信息');
                    process.exit(1);
                }
        }
    }
    
    return config;
}

/**
 * 验证配置
 */
function validateConfig(config) {
    const errors = [];
    
    // 检查必需的API密钥
    if (!config.api?.apiKey) {
        errors.push('缺少 BACKPACK_API_KEY 环境变量');
    }
    
    if (!config.api?.privateKey) {
        errors.push('缺少 BACKPACK_PRIVATE_KEY 环境变量');
    }
    
    // 检查交易参数
    if (config.volumeTrading?.orderAmount <= 0) {
        errors.push('订单金额必须大于0');
    }
    
    if (!['buy', 'sell'].includes(config.volumeTrading?.limitOrderSide)) {
        errors.push('限价挂单方向必须是 buy 或 sell');
    }
    
    if (config.volumeTrading?.maxTrades <= 0) {
        errors.push('最大交易次数必须大于0');
    }
    
    // 检查波动阈值
    if (config.volatilityControl?.volatility1?.priceChangeThreshold <= 0 || 
        config.volatilityControl?.volatility1?.priceChangeThreshold >= 1) {
        errors.push('1分钟波动阈值必须在 0-1 之间');
    }
    
    if (config.volatilityControl?.volatility2?.priceChangeThreshold <= 0 || 
        config.volatilityControl?.volatility2?.priceChangeThreshold >= 1) {
        errors.push('5分钟波动阈值必须在 0-1 之间');
    }
    
    return errors;
}

/**
 * 合并配置
 */
function mergeConfig(baseConfig, cmdArgs) {
    const merged = JSON.parse(JSON.stringify(baseConfig)); // 深拷贝
    
    // 应用命令行参数
    if (cmdArgs.symbol) {
        merged.volumeTrading.symbol = cmdArgs.symbol;
    }
    
    if (cmdArgs.orderAmount) {
        merged.volumeTrading.orderAmount = cmdArgs.orderAmount;
    }
    
    if (cmdArgs.limitOrderSide) {
        merged.volumeTrading.limitOrderSide = cmdArgs.limitOrderSide;
    }
    
    if (cmdArgs.maxTrades) {
        merged.volumeTrading.maxTrades = cmdArgs.maxTrades;
    }
    
    if (cmdArgs.volatility1Threshold) {
        merged.volatilityControl.volatility1.priceChangeThreshold = cmdArgs.volatility1Threshold;
    }
    
    if (cmdArgs.volatility2Threshold) {
        merged.volatilityControl.volatility2.priceChangeThreshold = cmdArgs.volatility2Threshold;
    }
    
    if (cmdArgs.testMode) {
        merged.testMode = {
            enabled: true,
            stopOnError: true
        };
    }
    
    return merged;
}

/**
 * 显示启动信息
 */
function showStartupInfo(config) {
    console.log(`
🚀 启动速刷合约交易机器人
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 交易配置:
   交易对: ${config.volumeTrading.symbol}
   每单金额: ${config.volumeTrading.orderAmount} USDC
   挂单方向: ${config.volumeTrading.limitOrderSide}
   最大交易次数: ${config.volumeTrading.maxTrades}

⚡ 波动风控:
   1分钟阈值: ${(config.volatilityControl.volatility1.priceChangeThreshold * 100).toFixed(2)}% (暂停${config.volatilityControl.volatility1.pauseDuration}分钟)
   5分钟阈值: ${(config.volatilityControl.volatility2.priceChangeThreshold * 100).toFixed(2)}% (暂停${config.volatilityControl.volatility2.pauseDuration}分钟)

📝 日志配置:
   日志级别: ${config.logging.level}
   CSV日志: ${config.logging.enableCsvLog ? '启用' : '禁用'}
   文件日志: ${config.logging.enableFileLog ? '启用' : '禁用'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️  风险提示: 这是自动化交易程序，请确保您了解相关风险
💡 按 Ctrl+C 可以安全关闭机器人

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

/**
 * 主函数
 */
async function main() {
    try {
        console.log('🔧 正在初始化速刷交易机器人...');
        
        // 解析命令行参数
        const cmdArgs = parseArgs();
        
        // 合并配置
        const config = mergeConfig(volumeBotConfig, cmdArgs);
        
        // 验证配置
        const configErrors = validateConfig(config);
        if (configErrors.length > 0) {
            console.error('❌ 配置错误:');
            configErrors.forEach(error => console.error(`   - ${error}`));
            console.log('\n使用 --help 查看帮助信息');
            process.exit(1);
        }
        
        // 显示启动信息
        showStartupInfo(config);
        
        // 创建并启动机器人
        const bot = new VolumeBot(config);
        await bot.start();
        
    } catch (error) {
        console.error('❌ 启动失败:', error.message);
        console.error('详细错误:', error);
        process.exit(1);
    }
}

// 启动程序
if (require.main === module) {
    main();
}

module.exports = { main, showHelp };
