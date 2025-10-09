/**
 * 速刷合约交易机器人配置文件
 * 
 * 专门用于快速增加交易量的配置
 */

module.exports = {
    // ================ API 配置 ================
    api: {
        // API 密钥（从环境变量读取）
        apiKey: process.env.BACKPACK_API_KEY,
        privateKey: process.env.BACKPACK_PRIVATE_KEY,
    },
    
    // ================ 速刷交易配置 ================
    volumeTrading: {
        // 交易对
        symbol: process.env.VOLUME_SYMBOL || 'BTC_USDC_PERP',
        
        // 每个订单金额 (USDC)
        orderAmount: parseFloat(process.env.VOLUME_ORDER_AMOUNT) || 100,
        
        // 限价挂单方向: 'buy' 或 'sell'
        limitOrderSide: process.env.VOLUME_LIMIT_SIDE || 'buy',
        
        // 完整交易次数上限
        maxTrades: parseInt(process.env.VOLUME_MAX_TRADES) || 1000,
        
        // 手续费配置
        fees: {
            maker: parseFloat(process.env.MAKER_FEE) || 0.0001,  // 挂单手续费 0.01%
            taker: parseFloat(process.env.TAKER_FEE) || 0.00026, // 市价手续费 0.026%
        },
        
        // 限价刷量模式配置
        limitVolumeMode: {
            // 是否启用限价刷量模式
            enabled: process.env.VOLUME_LIMIT_MODE === 'true',
            
            // 价格检查间隔（毫秒）
            priceCheckInterval: parseInt(process.env.VOLUME_PRICE_CHECK_INTERVAL) || 5000,
            
            // 订单超时时间（秒）
            orderTimeout: parseInt(process.env.VOLUME_ORDER_TIMEOUT) || 30,
            
            // 最大价格调整次数
            maxPriceAdjustments: parseInt(process.env.VOLUME_MAX_ADJUSTMENTS) || 100,
            
            // 订单数量配置
            orderQuantity: parseFloat(process.env.VOLUME_ORDER_QUANTITY) || 0.001,
            
            // 最大持仓金额限制（USDC）
            maxPositionValue: parseFloat(process.env.VOLUME_MAX_POSITION_VALUE) || 1000
        }
    },
    
    // ================ 波动风控配置 ================
    volatilityControl: {
        // 波动风控1：1分钟价格变化监控
        volatility1: {
            // 监控时间窗口（分钟）
            timeWindow: 1,
            // 价格变化阈值（百分比，如 0.02 = 2%）
            priceChangeThreshold: parseFloat(process.env.VOLUME_VOLATILITY_1_THRESHOLD) || 0.02,
            // 暂停后等待时间（分钟）
            pauseDuration: 5
        },
        
        // 波动风控2：5分钟价格变化监控
        volatility2: {
            // 监控时间窗口（分钟）
            timeWindow: 5,
            // 价格变化阈值（百分比，如 0.05 = 5%）
            priceChangeThreshold: parseFloat(process.env.VOLUME_VOLATILITY_2_THRESHOLD) || 0.05,
            // 暂停后等待时间（分钟）
            pauseDuration: 15
        }
    },
    
    // ================ WebSocket 配置 ================
    websocket: {
        // WebSocket API 地址
        url: 'wss://ws.backpack.exchange',
        
        // 重连配置
        reconnectInterval: 5000, // 5秒
        maxReconnectAttempts: 10,
        
        // 心跳配置
        pingInterval: 30000, // 30秒
        pongTimeout: 5000    // 5秒
    },
    
    // ================ 日志配置 ================
    logging: {
        // 日志级别: DEBUG, INFO, WARN, ERROR
        level: process.env.LOG_LEVEL || 'INFO',
        
        // 启用CSV交易日志
        enableCsvLog: process.env.ENABLE_CSV_LOG !== 'false',
        
        // 启用文件日志
        enableFileLog: process.env.ENABLE_FILE_LOG !== 'false'
    },
    
    // ================ 测试模式配置 ================
    testMode: {
        // 是否启用测试模式
        enabled: process.env.VOLUME_TEST_MODE === 'true',
        
        // 测试模式下遇到错误立即停止
        stopOnError: process.env.VOLUME_TEST_MODE === 'true'
    }
};
