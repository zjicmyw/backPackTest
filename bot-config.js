/**
 * 剥头皮交易机器人配置文件
 * 
 * 可以通过环境变量或直接修改此文件来配置机器人参数
 */

module.exports = {
    // ================ API 配置 ================
    api: {
        // API 密钥（从环境变量读取）
        apiKey: process.env.BACKPACK_API_KEY,
        privateKey: process.env.BACKPACK_PRIVATE_KEY,
    },
    
    // ================ 交易配置 ================
    trading: {
        // 交易对
        symbol: process.env.SYMBOL || 'BTC_USDC_PERP',
        
        // 每个订单金额 (USDC)
        orderAmount: parseFloat(process.env.ORDER_AMOUNT) || 100,
        
        // 止盈目标 (USDC)
        profitTarget: parseFloat(process.env.PROFIT_TARGET) || 0.001,
        
        // 订单间等待时间 (秒)
        orderWaitTime: parseInt(process.env.ORDER_WAIT_TIME) || 60,
        
        // 最大成交订单数（基于持仓价值）
        maxActiveOrders: parseInt(process.env.MAX_ACTIVE_ORDERS) || 40,
        
        // 交易方向: 'buy' 或 'sell'
        tradeDirection: process.env.TRADE_DIRECTION || 'buy',
        
        
        // 手续费配置
        fees: {
            maker: parseFloat(process.env.MAKER_FEE) || 0.0001,  // 挂单手续费 0.01%
            taker: parseFloat(process.env.TAKER_FEE) || 0.00026, // 市价手续费 0.026%
        }
    },
    
    // ================ 日志配置 ================
    logging: {
        // 日志级别: DEBUG, INFO, WARN, ERROR
        level: process.env.LOG_LEVEL || 'INFO',
        
        // 启用CSV交易日志
        enableCsvLog: process.env.ENABLE_CSV_LOG !== 'false',
        
        // 启用文件日志
        enableFileLog: process.env.ENABLE_FILE_LOG !== 'false'
    }
};
