#!/usr/bin/env node

/**
 * 限价刷交易量机器人启动脚本
 * 
 * 支持限价刷量模式，通过纯限价交易大量刷交易量
 */

require('dotenv').config();
const LimitVolumeBot = require('./limit-volume-bot.js');
const volumeBotConfig = require('./volume-bot-config.js');

/**
 * 显示帮助信息
 */
function showHelp() {
    console.log(`
🚀 限价刷交易量机器人启动脚本

用法: node start-limit-volume-bot.js [选项]

选项:
  --help, -h              显示此帮助信息
  --test-mode             启用测试模式
  --symbol <SYMBOL>        交易对 (默认: BTC_USDC_PERP)
  --order-quantity <QTY>   订单数量 (默认: 0.001)
  --price-interval <MS>    价格检查间隔毫秒 (默认: 1000)
  --order-timeout <SEC>    订单超时秒数 (默认: 30)
  --max-adjustments <NUM>  最大价格调整次数 (默认: 100)

环境变量:
  VOLUME_LIMIT_MODE        启用限价刷量模式 (true/false)
  VOLUME_SYMBOL            交易对
  VOLUME_ORDER_QUANTITY    订单数量
  VOLUME_PRICE_CHECK_INTERVAL 价格检查间隔(ms)
  VOLUME_ORDER_TIMEOUT     订单超时时间(s)
  VOLUME_MAX_ADJUSTMENTS   最大调整次数
  VOLUME_TEST_MODE         测试模式 (true/false)

示例:
  # 基本启动
  node start-limit-volume-bot.js

  # 自定义参数
  node start-limit-volume-bot.js --symbol ETH_USDC_PERP --order-quantity 0.01

  # 测试模式
  node start-limit-volume-bot.js --test-mode

  # 使用环境变量
  VOLUME_LIMIT_MODE=true VOLUME_ORDER_QUANTITY=0.002 node start-limit-volume-bot.js
`);
}

/**
 * 解析命令行参数
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        testMode: false,
        symbol: null,
        orderQuantity: null,
        priceInterval: null,
        orderTimeout: null,
        maxAdjustments: null
    };
    
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--help':
            case '-h':
                showHelp();
                process.exit(0);
                break;
            case '--test-mode':
                config.testMode = true;
                break;
            case '--symbol':
                config.symbol = args[++i];
                break;
            case '--order-quantity':
                config.orderQuantity = parseFloat(args[++i]);
                break;
            case '--price-interval':
                config.priceInterval = parseInt(args[++i]);
                break;
            case '--order-timeout':
                config.orderTimeout = parseInt(args[++i]);
                break;
            case '--max-adjustments':
                config.maxAdjustments = parseInt(args[++i]);
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
 * 验证配置
 */
function validateConfig(config) {
    const errors = [];
    
    // 检查API密钥
    if (!config.api?.apiKey || !config.api?.privateKey) {
        errors.push('缺少API密钥配置 (BACKPACK_API_KEY, BACKPACK_PRIVATE_KEY)');
    }
    
    // 检查限价刷量模式配置
    if (!config.volumeTrading?.limitVolumeMode?.enabled) {
        errors.push('限价刷量模式未启用，请设置 VOLUME_LIMIT_MODE=true');
    }
    
    // 检查订单数量
    const orderQuantity = config.volumeTrading?.limitVolumeMode?.orderQuantity;
    if (!orderQuantity || orderQuantity <= 0) {
        errors.push('订单数量必须大于0');
    }
    
    // 检查价格检查间隔
    const priceInterval = config.volumeTrading?.limitVolumeMode?.priceCheckInterval;
    if (!priceInterval || priceInterval < 100) {
        errors.push('价格检查间隔不能小于100毫秒');
    }
    
    // 检查订单超时时间
    const orderTimeout = config.volumeTrading?.limitVolumeMode?.orderTimeout;
    if (!orderTimeout || orderTimeout < 5) {
        errors.push('订单超时时间不能小于5秒');
    }
    
    return errors;
}

/**
 * 合并配置
 */
function mergeConfig(baseConfig, cmdArgs) {
    const merged = JSON.parse(JSON.stringify(baseConfig));
    
    // 应用命令行参数
    if (cmdArgs.testMode) {
        merged.testMode.enabled = true;
        merged.testMode.stopOnError = true;
    }
    
    if (cmdArgs.symbol) {
        merged.volumeTrading.symbol = cmdArgs.symbol;
    }
    
    if (cmdArgs.orderQuantity) {
        merged.volumeTrading.limitVolumeMode.orderQuantity = cmdArgs.orderQuantity;
    }
    
    if (cmdArgs.priceInterval) {
        merged.volumeTrading.limitVolumeMode.priceCheckInterval = cmdArgs.priceInterval;
    }
    
    if (cmdArgs.orderTimeout) {
        merged.volumeTrading.limitVolumeMode.orderTimeout = cmdArgs.orderTimeout;
    }
    
    if (cmdArgs.maxAdjustments) {
        merged.volumeTrading.limitVolumeMode.maxPriceAdjustments = cmdArgs.maxAdjustments;
    }
    
    return merged;
}

/**
 * 显示启动信息
 */
function showStartupInfo(config) {
    console.log(`
🚀 限价刷交易量机器人启动信息
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 基本配置:
  交易对: ${config.volumeTrading.symbol}
  订单数量: ${config.volumeTrading.limitVolumeMode.orderQuantity}
  价格检查间隔: ${config.volumeTrading.limitVolumeMode.priceCheckInterval}ms
  订单超时时间: ${config.volumeTrading.limitVolumeMode.orderTimeout}s
  最大调整次数: ${config.volumeTrading.limitVolumeMode.maxPriceAdjustments}

🛡️ 风控配置:
  1分钟波动阈值: ${(config.volatilityControl.volatility1.priceChangeThreshold * 100).toFixed(2)}%
  5分钟波动阈值: ${(config.volatilityControl.volatility2.priceChangeThreshold * 100).toFixed(2)}%

📝 日志配置:
  日志级别: ${config.logging.level}
  CSV日志: ${config.logging.enableCsvLog ? '启用' : '禁用'}
  文件日志: ${config.logging.enableFileLog ? '启用' : '禁用'}

🧪 测试模式: ${config.testMode.enabled ? '启用' : '禁用'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

/**
 * 主函数
 */
async function main() {
    try {
        console.log('🔍 解析命令行参数...');
        const cmdArgs = parseArgs();
        
        console.log('📋 加载配置...');
        const baseConfig = volumeBotConfig;
        
        console.log('🔧 合并配置...');
        const finalConfig = mergeConfig(baseConfig, cmdArgs);
        
        console.log('✅ 验证配置...');
        const errors = validateConfig(finalConfig);
        if (errors.length > 0) {
            console.error('❌ 配置验证失败:');
            errors.forEach(error => console.error(`  - ${error}`));
            process.exit(1);
        }
        
        console.log('📊 显示启动信息...');
        showStartupInfo(finalConfig);
        
        console.log('🚀 启动限价刷交易量机器人...');
        const bot = new LimitVolumeBot(finalConfig);
        
        // 启动机器人
        await bot.start();
        
    } catch (error) {
        console.error('❌ 启动失败:', error.message);
        console.error('详细错误:', error);
        process.exit(1);
    }
}

// 运行主函数
if (require.main === module) {
    main().catch(error => {
        console.error('❌ 未处理的错误:', error);
        process.exit(1);
    });
}

module.exports = { main, parseArgs, validateConfig, mergeConfig };
