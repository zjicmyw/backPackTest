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
        
        // 除手续费外的净盈利比例 (如 0.0001 = 0.01%)
        profitTarget: parseFloat(process.env.PROFIT_TARGET) || 0.0001,
        
        // 订单间等待时间 (秒)
        orderWaitTime: parseInt(process.env.ORDER_WAIT_TIME) || 60,
        
        // 单币种持仓最大金额 (USDC)
        maxPositionValue: parseFloat(process.env.MAX_POSITION_VALUE) || 40000,
        
        // 交易方向: 'buy' 或 'sell'
        tradeDirection: process.env.TRADE_DIRECTION || 'buy',
        
        
        // 手续费配置
        fees: {
            maker: parseFloat(process.env.MAKER_FEE) || 0.0001,  // 挂单手续费 0.01%
            taker: parseFloat(process.env.TAKER_FEE) || 0.00026, // 市价手续费 0.026%
        },
        
        // 仅挂单模式（PostOnly）- 只做 maker，不做 taker
        postOnly: process.env.POST_ONLY !== 'false',
        
        // 最小价格差异要求（确保有足够价差来盈利）
        minPriceDifference: parseFloat(process.env.MIN_PRICE_DIFFERENCE) || 0.00015,
        
        // 时间段配置 (UTC+8)
        enableTimeSlot: process.env.ENABLE_TIME_SLOT !== 'false',
        timeSlotStart: process.env.TIME_SLOT_START || '09:00',
        timeSlotEnd: process.env.TIME_SLOT_END || '17:00',
        
        // 持续时间倍数配置
        durationMultiplier0to1: parseFloat(process.env.DURATION_MULTIPLIER_0_TO_1) || 3,
        durationMultiplier1to3: parseFloat(process.env.DURATION_MULTIPLIER_1_TO_3) || 2,
        durationMultiplier3to5: parseFloat(process.env.DURATION_MULTIPLIER_3_TO_5) || 1.5,
        
        // 价格区间限制（可选）
        // 当价格超出此区间时，停止增加仓位，但允许关闭或减少仓位
        minOrderPrice: process.env.MIN_ORDER_PRICE ? parseFloat(process.env.MIN_ORDER_PRICE) : null,
        maxOrderPrice: process.env.MAX_ORDER_PRICE ? parseFloat(process.env.MAX_ORDER_PRICE) : null
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
