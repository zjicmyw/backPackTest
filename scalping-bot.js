const BackpackClient = require('./backpack-client');
const fs = require('fs');
const path = require('path');

// 全局价格精度配置
let globalPricePrecision = 1; // 默认1位小数

// 全局成交价格记录
let lastTradePrice = null; // 上一次成交价格
let lastTradeSide = null; // 上一次成交方向 ('buy' 或 'sell')

// 全局交易历史记录
let tradeHistory = []; // 存储交易历史记录（保留旧系统兼容性）

// 全局变量：保存最近1次持仓的开仓和平仓时间
let lastPositionEntryTime = null; // 最近1次开仓时间
let lastPositionCloseTime = null; // 最近1次平仓时间
let lastPositionDuration = null; // 最近1次持仓持续时间（毫秒）
let orderAmountMultiplierCache = null; // 缓存的订单金额倍数
let orderAmountMultiplierExpiry = null; // 倍数过期时间

/**
 * 记录开仓时间
 * @param {number} entryTime - 开仓时间戳
 */
function recordPositionEntry(entryTime) {
    lastPositionEntryTime = entryTime;
    console.log(`📝 记录开仓时间: ${new Date(entryTime).toLocaleString()}`);
}

/**
 * 记录平仓时间并计算持续时间
 * @param {number} closeTime - 平仓时间戳
 */
function recordPositionClose(closeTime) {
    lastPositionCloseTime = closeTime;
    
    if (lastPositionEntryTime) {
        lastPositionDuration = closeTime - lastPositionEntryTime;
        console.log(`📝 记录平仓时间: ${new Date(closeTime).toLocaleString()}`);
        console.log(`📊 持仓持续时间: ${(lastPositionDuration / 1000).toFixed(1)}秒 (${(lastPositionDuration / 60000).toFixed(2)}分钟)`);
        
        // 清除旧的订单金额倍数缓存，因为持续时间已更新
        orderAmountMultiplierCache = null;
        orderAmountMultiplierExpiry = null;
        console.log(`🔄 持续时间更新，已清除订单金额倍数缓存`);
    } else {
        console.log(`⚠️ 记录平仓时间但没有对应的开仓时间`);
    }
}

/**
 * 获取最近1次持仓信息
 * @returns {object} 持仓信息
 */
function getLastPositionInfo() {
    return {
        entryTime: lastPositionEntryTime,
        closeTime: lastPositionCloseTime,
        duration: lastPositionDuration
    };
}

/**
 * 根据持续时间获取订单金额倍数（有效期5分钟）
 * @param {object} config - 配置对象
 * @returns {number} 订单金额倍数
 */
function getOrderAmountMultiplier(config) {
    const now = Date.now();
    
    // 检查缓存是否有效（5分钟内）
    if (orderAmountMultiplierCache && orderAmountMultiplierExpiry && now < orderAmountMultiplierExpiry) {
        console.log(`📋 使用缓存的订单金额倍数: ${orderAmountMultiplierCache}x (剩余${Math.round((orderAmountMultiplierExpiry - now) / 1000)}秒)`);
        return orderAmountMultiplierCache;
    }
    
    // 如果没有持续时间数据，使用默认倍数1
    if (!lastPositionDuration) {
        console.log(`📋 没有持续时间数据，使用默认倍数: 1x`);
        return 1;
    }
    
    // 将持续时间转换为分钟
    const durationMinutes = lastPositionDuration / (60 * 1000);
    console.log(`📊 上次持仓持续时间: ${durationMinutes.toFixed(2)}分钟`);
    
    let multiplier = 1;
    
    // 根据配置的持续时间区间确定倍数
    console.log(`📊 配置信息:`, {
        durationMultiplier0to1: config.durationMultiplier0to1,
        durationMultiplier1to3: config.durationMultiplier1to3,
        durationMultiplier3to5: config.durationMultiplier3to5
    });
    
    if (config.durationMultiplier0to1 && durationMinutes >= 0 && durationMinutes < 1) {
        multiplier = config.durationMultiplier0to1;
        console.log(`📊 匹配0-1分钟区间，使用倍数: ${multiplier}`);
    } else if (config.durationMultiplier1to3 && durationMinutes >= 1 && durationMinutes < 3) {
        multiplier = config.durationMultiplier1to3;
        console.log(`📊 匹配1-3分钟区间，使用倍数: ${multiplier}`);
    } else if (config.durationMultiplier3to5 && durationMinutes >= 3 && durationMinutes < 5) {
        multiplier = config.durationMultiplier3to5;
        console.log(`📊 匹配3-5分钟区间，使用倍数: ${multiplier}`);
    } else if (durationMinutes >= 5) {
        multiplier = 1; // 5分钟以上使用默认倍数
        console.log(`📊 超过5分钟，使用默认倍数: ${multiplier}`);
    } else {
        console.log(`📊 没有匹配任何区间，使用默认倍数: ${multiplier}`);
    }
    
    // 缓存倍数，有效期5分钟
    orderAmountMultiplierCache = multiplier;
    orderAmountMultiplierExpiry = now + (5 * 60 * 1000); // 5分钟后过期
    
    console.log(`📋 计算订单金额倍数: ${multiplier}x (有效期5分钟)`);
    return multiplier;
}

/**
 * 通过API获取最近1次完整的持仓历史（开仓到平仓）
 * @param {string} symbol - 交易对符号
 * @param {object} client - API客户端
 * @param {string} tradeDirection - 交易方向 ('buy' 或 'sell')
 * @returns {Promise<object|null>} 持仓历史信息
 */
async function fetchLastPositionFromAPI(symbol, client, tradeDirection = 'buy') {
    try {
        console.log(`🔍 通过API获取 ${symbol} 的最近持仓历史...`);
        
        // 获取最近60分钟的成交记录
        const fromTime = Date.now() - (30 * 60 * 1000);
        const fills = await client.getFillHistory({
            symbol: symbol,
            from: fromTime,
            to: Date.now()
        });
        
        console.log(`📊 API返回成交记录: ${fills.length} 条`);
        
        if (fills.length === 0) {
            console.log(`❌ 没有找到成交记录`);
            return null;
        }
        
        // 打印所有成交记录的详细信息
        console.log(`📋 所有成交记录详情:`);
        fills.forEach((fill, index) => {
            console.log(`  ${index + 1}. 订单ID: ${fill.orderId} | 方向: ${fill.side} | 价格: ${fill.price} | 数量: ${fill.quantity} | 时间: ${fill.timestamp}`);
            console.log(`     订单ID长度: ${fill.orderId.length} | 包含close: ${fill.orderId.includes('close')} | 包含position_: ${fill.orderId.includes('position_')}`);
        });
        
        // 按时间排序（从早到晚）
        const sortedFills = fills.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        
        console.log(`📋 按时间排序后的成交记录:`);
        sortedFills.forEach((fill, index) => {
            console.log(`  ${index + 1}. ${fill.orderId} - ${fill.side} - ${fill.quantity}@${fill.price} - ${fill.timestamp}`);
        });
        
        // 查找最近的完整持仓周期（开仓 -> 平仓）
        let entryFill = null;
        let closeFill = null;
        
        console.log(`🔍 开始分析成交记录，寻找完整持仓周期...`);
        console.log(`📊 交易方向: ${tradeDirection} (${tradeDirection === 'buy' ? '做多，Ask为平仓' : '做空，Bid为平仓'})`);
        
        // 根据交易方向确定平仓和开仓的方向
        const closeSide = tradeDirection === 'buy' ? 'Ask' : 'Bid'; // 平仓方向
        const entrySide = tradeDirection === 'buy' ? 'Bid' : 'Ask'; // 开仓方向
        
        console.log(`📊 预期开仓方向: ${entrySide}, 预期平仓方向: ${closeSide}`);
        
        // 从最新的成交记录开始往前查找
        for (let i = sortedFills.length - 1; i >= 0; i--) {
            const fill = sortedFills[i];
            
            if (!closeFill) {
                // 寻找平仓记录（方向匹配平仓方向）
                const isCorrectDirection = fill.side === closeSide;
                const isLongId = fill.orderId.length > 15;
                const hasCloseKeyword = fill.orderId.includes('close');
                const hasPositionKeyword = fill.orderId.includes('position_');
                
                console.log(`  分析订单 ${fill.orderId} (${fill.side}):`);
                console.log(`    方向匹配平仓: ${isCorrectDirection} (${fill.side} === ${closeSide})`);
                console.log(`    ID长度: ${fill.orderId.length} (>15: ${isLongId})`);
                console.log(`    包含'close': ${hasCloseKeyword}`);
                console.log(`    包含'position_': ${hasPositionKeyword}`);
                
                // 平仓记录的判断：方向正确即可（因为很多平仓订单ID没有特殊标识）
                const isCloseCandidate = isCorrectDirection;
                console.log(`    是否平仓候选: ${isCloseCandidate}`);
                
                if (isCloseCandidate) {
                    closeFill = fill;
                    console.log(`🔍 ✅ 找到平仓记录: ${fill.orderId} - ${fill.side} - ${fill.quantity}@${fill.price} - ${fill.timestamp}`);
                } else {
                    console.log(`    ❌ 不是平仓记录`);
                }
            } else if (!entryFill) {
                // 寻找对应的开仓记录（在平仓之前，方向为开仓方向）
                const isCorrectDirection = fill.side === entrySide;
                const isBeforeClose = new Date(fill.timestamp) < new Date(closeFill.timestamp);
                
                console.log(`  检查开仓候选 ${fill.orderId} (${fill.side}):`);
                console.log(`    方向匹配开仓: ${isCorrectDirection} (${fill.side} === ${entrySide})`);
                console.log(`    时间在平仓前: ${isBeforeClose}`);
                
                if (isCorrectDirection && isBeforeClose) {
                    entryFill = fill;
                    console.log(`🔍 ✅ 找到开仓记录: ${fill.orderId} - ${fill.side} - ${fill.quantity}@${fill.price} - ${fill.timestamp}`);
                    break;
                } else {
                    console.log(`    ❌ 不匹配开仓条件`);
                }
            }
        }
        
        if (entryFill && closeFill) {
            const entryTime = new Date(entryFill.timestamp).getTime();
            const closeTime = new Date(closeFill.timestamp).getTime();
            const duration = closeTime - entryTime;
            
            console.log(`✅ 找到完整持仓历史:`);
            console.log(`   开仓: ${entryFill.orderId} - ${new Date(entryTime).toLocaleString()}`);
            console.log(`   平仓: ${closeFill.orderId} - ${new Date(closeTime).toLocaleString()}`);
            console.log(`   持续时间: ${(duration / 1000).toFixed(1)}秒 (${(duration / 60000).toFixed(2)}分钟)`);
            
            return {
                entryTime,
                closeTime,
                duration,
                entryFill,
                closeFill
            };
        } else {
            console.log(`❌ 没有找到完整的持仓历史`);
            return null;
        }
        
    } catch (error) {
        console.error(`❌ 获取持仓历史失败: ${error.message}`);
        return null;
    }
}

/**
 * 设置全局价格精度
 * @param {number} precision - 价格精度（小数位数）
 */
function setGlobalPricePrecision(precision) {
    globalPricePrecision = precision;
}

/**
 * 全局价格精度函数 - 使用统一的价格精度格式化所有价格
 * @param {number} price - 要格式化的价格
 * @returns {string} 格式化后的价格字符串
 */
function formatPriceWithGlobalPrecision(price) {
    return parseFloat(price).toFixed(globalPricePrecision);
}

/**
 * 记录成交价格和方向
 * @param {number} price - 成交价格
 * @param {string} side - 成交方向 ('buy' 或 'sell')
 */
function recordTradePrice(price, side) {
    lastTradePrice = parseFloat(price);
    lastTradeSide = side;
}

/**
 * 清空成交价格记录
 */
function clearTradePrice() {
    lastTradePrice = null;
    lastTradeSide = null;
}

/**
 * 获取上一次成交价格和方向
 * @returns {object} {price: number|null, side: string|null}
 */
function getLastTradeInfo() {
    return {
        price: lastTradePrice,
        side: lastTradeSide
    };
}

/**
 * 记录交易历史
 * @param {string} symbol - 交易对符号
 * @param {string} entryOrderId - 开仓订单ID
 * @param {string|null} closeOrderId - 平仓订单ID（开仓时为null）
 * @param {number} entryTime - 开仓时间戳
 * @param {number|null} closeTime - 平仓时间戳（开仓时为null）
 * @param {number|null} duration - 持续时间（毫秒，开仓时为null）
 * @param {number|null} profit - 盈利金额（开仓时为null）
 */
function recordTradeHistory(symbol, entryOrderId, closeOrderId, entryTime, closeTime, duration, profit) {
    console.log(`=== 记录交易历史 ===`);
    console.log(`symbol: ${symbol}`);
    console.log(`entryOrderId: ${entryOrderId}`);
    console.log(`closeOrderId: ${closeOrderId}`);
    console.log(`entryTime: ${entryTime}`);
    console.log(`closeTime: ${closeTime}`);
    console.log(`duration: ${duration}ms`);
    console.log(`profit: ${profit}`);
    console.log(`记录前历史总数: ${tradeHistory.length}`);
    
    if (closeOrderId === null) {
        // 开仓记录 - 创建新的不完整记录
        const tradeRecord = {
            symbol,
            entryOrderId,
            closeOrderId: null,
            entryTime,
            closeTime: null,
            duration: null,
            profit: null,
            timestamp: Date.now(),
            isComplete: false
        };
        
        tradeHistory.push(tradeRecord);
        console.log(`✅ 记录开仓交易: ${entryOrderId}`);
    } else {
        // 平仓记录 - 查找并更新对应的开仓记录
        let updated = false;
        for (let i = tradeHistory.length - 1; i >= 0; i--) {
            const trade = tradeHistory[i];
            if (trade.symbol === symbol && 
                trade.entryOrderId === entryOrderId && 
                !trade.isComplete) {
                // 更新为完整交易记录
                trade.closeOrderId = closeOrderId;
                trade.closeTime = closeTime;
                trade.duration = duration;
                trade.profit = profit;
                trade.isComplete = true;
                updated = true;
                console.log(`✅ 更新平仓交易: ${entryOrderId} -> ${closeOrderId}`);
                break;
            }
        }
        
        // 如果没有找到对应的开仓记录，创建新的完整记录
        if (!updated) {
            const tradeRecord = {
                symbol,
                entryOrderId,
                closeOrderId,
                entryTime,
                closeTime,
                duration,
                profit,
                timestamp: Date.now(),
                isComplete: true
            };
            tradeHistory.push(tradeRecord);
            console.log(`✅ 创建完整交易记录: ${entryOrderId} -> ${closeOrderId}`);
        }
    }
    
    console.log(`记录后历史总数: ${tradeHistory.length}`);
    console.log(`=== 记录交易历史完成 ===`);
    
    // 只保留最近100笔交易记录，避免内存占用过多
    if (tradeHistory.length > 100) {
        tradeHistory = tradeHistory.slice(-100);
        console.log(`历史记录超过100条，已清理，当前总数: ${tradeHistory.length}`);
    }
}

/**
 * 获取指定交易对的上一笔完整交易记录（有开仓和平仓的）
 * @param {string} symbol - 交易对符号
 * @returns {object|null} 上一笔完整交易记录
 */
function getLastTradeHistory(symbol) {
    console.log(`=== 查询交易历史开始 ===`);
    console.log(`查询symbol: ${symbol}`);
    console.log(`历史记录总数: ${tradeHistory.length}`);
    
    // 显示所有记录概览
    const symbolRecords = tradeHistory.filter(t => t.symbol === symbol);
    console.log(`${symbol} 相关记录: ${symbolRecords.length} 条`);
    symbolRecords.forEach((t, index) => {
        console.log(`  记录${index + 1}: entryOrderId=${t.entryOrderId}, isComplete=${t.isComplete}, duration=${t.duration}ms`);
    });
    
    // 从最新的记录开始查找，只返回完整的交易记录
    for (let i = tradeHistory.length - 1; i >= 0; i--) {
        const trade = tradeHistory[i];
        if (trade.symbol === symbol && trade.isComplete) {
            console.log(`✅ 找到完整交易记录: entryOrderId=${trade.entryOrderId}, closeOrderId=${trade.closeOrderId}, duration=${trade.duration}ms`);
            console.log(`=== 查询交易历史结束 ===`);
            return trade;
        }
    }
    console.log(`❌ 未找到完整交易记录`);
    console.log(`=== 查询交易历史结束 ===`);
    return null;
}


    /**
     * 根据上一笔交易持续时间计算订单金额倍数
     * @param {string} symbol - 交易对符号
     * @param {number} baseOrderAmount - 基础订单金额
     * @returns {number} 调整后的订单金额
     */
function calculateOrderAmountMultiplier(symbol, baseOrderAmount, config) {
    console.log(`=== 计算订单金额倍数开始 ===`);
    console.log(`symbol: ${symbol}`);
    console.log(`baseOrderAmount: ${baseOrderAmount}`);
    console.log(`传入的config:`, {
        durationMultiplier0to1: config.durationMultiplier0to1,
        durationMultiplier1to3: config.durationMultiplier1to3,
        durationMultiplier3to5: config.durationMultiplier3to5
    });
    
    // 使用新的全局函数获取订单金额倍数
    const multiplier = getOrderAmountMultiplier(config);
    
    const finalAmount = baseOrderAmount * multiplier;
    console.log(`最终订单金额: ${baseOrderAmount} * ${multiplier} = ${finalAmount}`);
    console.log(`=== 计算订单金额倍数结束 ===`);
    
    return finalAmount;
}

/**
 * Backpack 合约剥头皮交易机器人
 * 
 * 功能特性：
 * - 自动下单和平仓
 * - 订单监控和风险管理
 * - 完整的日志记录
 * - 错误处理和恢复
 */

class ScalpingBot {
    constructor(config = {}) {
        // 默认配置
        this.config = {
            // API 配置
            apiKey: process.env.BACKPACK_API_KEY,
            privateKey: process.env.BACKPACK_PRIVATE_KEY,
            
            // 交易配置
            symbol: config.symbol || 'BTC_USDC_PERP',
            orderAmount: config.orderAmount || 100, // 每个订单金额 (USDC)
            profitTarget: config.profitTarget || 0.0001, // 除手续费外的净盈利比例 (如 0.0001 = 0.01%)
            orderWaitTime: config.orderWaitTime || 60, // 订单间等待时间 (秒)
            maxPositionValue: config.maxPositionValue || 40000, // 单币种持仓最大金额 (USDC)
            tradeDirection: config.tradeDirection || 'buy', // 'buy' 或 'sell'
            
            // 手续费配置（从配置文件读取）
            makerFee: config.fees?.maker || 0.0001, // 挂单手续费 0.01%
            takerFee: config.fees?.taker || 0.00026, // 市价手续费 0.026%
            
            // 仅挂单模式
            postOnly: config.postOnly !== undefined ? config.postOnly : true, // 默认启用仅挂单模式
            
            // 价格差异要求（确保有足够价差来盈利）
            minPriceDifference: config.minPriceDifference || 0.00015, // 最小价格差异百分比，默认0.015%
            
            // 时间段配置 (UTC+8)
            enableTimeSlot: config.trading?.enableTimeSlot !== false, // 启用时间段配置
            timeSlotStart: config.trading?.timeSlotStart || '09:00', // 特殊时间段开始时间
            timeSlotEnd: config.trading?.timeSlotEnd || '17:00', // 特殊时间段结束时间
            
            // 持续时间倍数配置
            durationMultiplier0to1: config.trading?.durationMultiplier0to1 || 3, // 0-1分钟倍数
            durationMultiplier1to3: config.trading?.durationMultiplier1to3 || 2, // 1-3分钟倍数
            durationMultiplier3to5: config.trading?.durationMultiplier3to5 || 1.5, // 3-5分钟倍数
            
            // 价格区间限制（可选）
            minOrderPrice: config.trading?.minOrderPrice || config.minOrderPrice || null, // 最小可挂单价格
            maxOrderPrice: config.trading?.maxOrderPrice || config.maxOrderPrice || null, // 最大可挂单价格
            
            // 日志配置
            logLevel: config.logLevel || 'INFO', // DEBUG, INFO, WARN, ERROR
            enableCsvLog: config.enableCsvLog !== false, // 启用CSV日志
            enableFileLog: config.enableFileLog !== false, // 启用文件日志
        };
        
        // 验证配置
        if (!this.config.apiKey || !this.config.privateKey) {
            throw new Error('请配置 BACKPACK_API_KEY 和 BACKPACK_PRIVATE_KEY 环境变量');
        }
        
        // 初始化客户端
        this.client = new BackpackClient(this.config.apiKey, this.config.privateKey);
        
        // 状态管理
        this.isRunning = false;
        this.activeOrders = new Map(); // 活跃订单
        this.closeOrders = new Map(); // 平仓订单
        this.positions = new Map(); // 持仓信息
        this.currentPosition = 0; // 当前持仓数量（正数为多头，负数为空头）
        this.positionEntryPrice = 0; // 持仓入仓价格
        this.lastOrderTime = 0; // 上次下单时间
        this.lastFilledOrderTime = 0; // 最后一个成交订单的时间
        this.orderCreateTimes = new Map(); // 订单创建时间
        this.currentMarketPrice = 0; // 当前市场价格
        this.isProcessingOrder = false; // 防止重复下单的标志
        this.stats = {
            totalOrders: 0,
            successfulOrders: 0,
            failedOrders: 0,
            totalProfit: 0,
            startTime: null,
        };
        
        // 统计显示时间控制
        this.lastStatsTime = 0;
        
        // 防止重复创建平仓订单的标记
        this.isCreatingCloseOrder = false;
        
        // 跟踪上次的持仓价值，用于判断是否需要更新平仓订单
        this.lastPositionValue = 0;
        
        
        // 记录平仓订单创建失败的时间，防止频繁重试
        this.lastCloseOrderFailTime = 0;
        
        // 跟踪上次的持仓金额，用于判断订单是否有效成交
        this.lastPositionValueBeforeOrder = 0;
        
        // 记录每个symbol最后创建平仓单的时间，防止频繁创建
        this.lastCloseOrderCreateTime = new Map(); // symbol -> timestamp
        
        // API查询间隔控制
        this.lastCloseOrdersQueryTime = 0;
        this.lastMarketPriceQueryTime = 0;
        this.minQueryInterval = 1000; // 最小查询间隔1秒
        
        // 缓存机制
        this.cachedCloseOrders = null;
        this.cachedCloseOrdersTime = 0;
        this.cacheValidDuration = 2000; // 缓存有效期2秒
        
        // 市场精度缓存
        this.marketPrecisionCache = new Map();
        this.marketPrecisionCacheTime = 0;
        this.marketPrecisionCacheDuration = 300000; // 5分钟缓存有效期
        
        // 日志文件
        this.logDir = 'logs';
        const now = new Date();
        const utc8Time = new Date(now.getTime() + (8 * 60 * 60 * 1000)); // UTC+8
        const dateStr = utc8Time.toISOString().split('T')[0]; // 获取日期部分 YYYY-MM-DD
        this.csvLogFile = path.join(this.logDir, `trades_${dateStr}.csv`);
        this.debugLogFile = path.join(this.logDir, `debug_${dateStr}.log`);
        
        // 创建日志目录
        this.ensureLogDirectory();
        
        // 初始化CSV日志头
        this.initCsvLog();
        
        this.log('INFO', 'ScalpingBot 初始化完成');
    }
    
    /**
     * 确保日志目录存在
     */
    ensureLogDirectory() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }
    
    /**
     * 初始化CSV日志文件
     */
    initCsvLog() {
        if (this.config.enableCsvLog && !fs.existsSync(this.csvLogFile)) {
            const header = 'timestamp,symbol,side,orderType,price,quantity,orderId,status,profit,notes\n';
            fs.writeFileSync(this.csvLogFile, header);
        }
    }
    
    /**
     * 获取UTC+8时间戳
     */
    getTimestamp() {
        const now = new Date();
        const utc8Time = new Date(now.getTime() + (8 * 60 * 60 * 1000)); // UTC+8
        return utc8Time.toISOString().replace('T', ' ').substring(0, 19);
    }
    
    /**
     * 日志记录
     */
    log(level, message, data = {}) {
        const timestamp = this.getTimestamp();
        let logEntry = `[${timestamp}] [${level}] ${message}`;
        
        // 对于 DEBUG、WARN 和 ERROR 级别，显示详细数据
        if ((level === 'DEBUG' || level === 'WARN' || level === 'ERROR') && Object.keys(data).length > 0) {
            logEntry += `\n  详细信息: ${JSON.stringify(data, null, 2)}`;
        }
        
        // 控制台输出
        if (this.shouldLog(level)) {
            console.log(logEntry);
        }
        
        // 文件日志
        if (this.config.enableFileLog) {
            fs.appendFileSync(this.debugLogFile, logEntry + '\n');
        }
    }
    
    /**
     * 判断是否应该记录日志
     */
    shouldLog(level) {
        const levels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
        return levels[level] >= levels[this.config.logLevel];
    }
    
    /**
     * 记录交易到CSV
     */
    logTrade(tradeData) {
        if (!this.config.enableCsvLog) return;
        
        const csvRow = [
            tradeData.timestamp || this.getTimestamp(),
            tradeData.symbol || '',
            tradeData.side || '',
            tradeData.orderType || '',
            tradeData.price || '',
            tradeData.quantity || '',
            tradeData.orderId || '',
            tradeData.status || '',
            tradeData.profit || '',
            tradeData.notes || ''
        ].join(',') + '\n';
        
        fs.appendFileSync(this.csvLogFile, csvRow);
    }
    
    /**
     * 获取市场精度信息
     * @param {string} symbol - 交易对符号
     * @returns {Promise<Object>} 精度信息 {pricePrecision, quantityPrecision}
     */
    async getMarketPrecision(symbol) {
        try {
            // 检查缓存
            const now = Date.now();
            if (this.marketPrecisionCache.has(symbol) && 
                (now - this.marketPrecisionCacheTime) < this.marketPrecisionCacheDuration) {
                return this.marketPrecisionCache.get(symbol);
            }

            // 获取市场信息
            const marketInfo = await this.client.getMarket(symbol);
            
            if (!marketInfo || !marketInfo.filters) {
                this.log('WARN', '无法获取市场精度信息，使用默认精度', { symbol });
                return { pricePrecision: 1, quantityPrecision: 4 };
            }

            // 解析精度信息
            const pricePrecision = this.calculatePrecisionFromTickSize(marketInfo.filters.price.tickSize);
            const quantityPrecision = this.calculatePrecisionFromStepSize(marketInfo.filters.quantity.stepSize);

            const precisionInfo = {
                pricePrecision,
                quantityPrecision,
                tickSize: marketInfo.filters.price.tickSize,
                stepSize: marketInfo.filters.quantity.stepSize,
                minPrice: marketInfo.filters.price.minPrice,
                minQuantity: marketInfo.filters.quantity.minQuantity
            };

            // 缓存结果
            this.marketPrecisionCache.set(symbol, precisionInfo);
            this.marketPrecisionCacheTime = now;

            this.log('DEBUG', '获取市场精度信息', {
                symbol,
                pricePrecision,
                quantityPrecision,
                tickSize: marketInfo.filters.price.tickSize,
                stepSize: marketInfo.filters.quantity.stepSize
            });

            return precisionInfo;
        } catch (error) {
            this.log('ERROR', '获取市场精度信息失败', { symbol, error: error.message });
            // 返回默认精度
            return { pricePrecision: 1, quantityPrecision: 4 };
        }
    }

    /**
     * 根据tickSize计算价格精度
     * @param {string} tickSize - 价格增量
     * @returns {number} 小数位数
     */
    calculatePrecisionFromTickSize(tickSize) {
        const tick = parseFloat(tickSize);
        if (tick >= 1) return 0;
        if (tick >= 0.1) return 1;
        if (tick >= 0.01) return 2;
        if (tick >= 0.001) return 3;
        if (tick >= 0.0001) return 4;
        if (tick >= 0.00001) return 5;
        if (tick >= 0.000001) return 6;
        if (tick >= 0.0000001) return 7;
        if (tick >= 0.00000001) return 8;
        return 8; // 最大8位小数
    }

    /**
     * 根据stepSize计算数量精度
     * @param {string} stepSize - 数量增量
     * @returns {number} 小数位数
     */
    calculatePrecisionFromStepSize(stepSize) {
        const step = parseFloat(stepSize);
        if (step >= 1) return 0;
        if (step >= 0.1) return 1;
        if (step >= 0.01) return 2;
        if (step >= 0.001) return 3;
        if (step >= 0.0001) return 4;
        if (step >= 0.00001) return 5;
        if (step >= 0.000001) return 6;
        if (step >= 0.0000001) return 7;
        if (step >= 0.00000001) return 8;
        return 8; // 最大8位小数
    }

    /**
     * 检查当前是否在特殊时间段内
     * @returns {object} {isInTimeSlot: boolean, isWeekend: boolean, timeInfo: object}
     */
    isInSpecialTimeSlot() {
        if (!this.config.enableTimeSlot) {
            return { isInTimeSlot: false, isWeekend: false, timeInfo: null };
        }

        // 获取UTC+8时间
        const now = new Date();
        const utc8Time = new Date(now.getTime() + (8 * 60 * 60 * 1000));
        const dayOfWeek = utc8Time.getDay(); // 0=周日, 1=周一, ..., 6=周六
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6; // 周六或周日
        
        // 获取当前时间 (HH:MM格式)
        const currentTime = utc8Time.getHours().toString().padStart(2, '0') + ':' + 
                           utc8Time.getMinutes().toString().padStart(2, '0');
        
        // 解析配置的时间段
        const [startHour, startMin] = this.config.timeSlotStart.split(':').map(Number);
        const [endHour, endMin] = this.config.timeSlotEnd.split(':').map(Number);
        
        const startMinutes = startHour * 60 + startMin;
        const endMinutes = endHour * 60 + endMin;
        const currentMinutes = utc8Time.getHours() * 60 + utc8Time.getMinutes();
        
        // 判断是否在时间段内
        let isInTimeSlot = false;
        if (startMinutes <= endMinutes) {
            // 同一天内的时间段 (如 09:00-17:00)
            isInTimeSlot = currentMinutes >= startMinutes && currentMinutes < endMinutes;
        } else {
            // 跨天的时间段 (如 22:00-06:00)
            isInTimeSlot = currentMinutes >= startMinutes || currentMinutes < endMinutes;
        }
        
        const timeInfo = {
            currentTime,
            timeSlotStart: this.config.timeSlotStart,
            timeSlotEnd: this.config.timeSlotEnd,
            dayOfWeek: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][dayOfWeek],
            isWeekend
        };
        
        return { isInTimeSlot, isWeekend, timeInfo };
    }

    /**
     * 根据时间段和星期几获取动态配置
     * @returns {object} {orderAmountMultiplier: number, priceDifferenceMultiplier: number}
     */
    getDynamicConfig() {
        const { isInTimeSlot, isWeekend, timeInfo } = this.isInSpecialTimeSlot();
        
        if (!this.config.enableTimeSlot) {
            return { orderAmountMultiplier: 1.0, priceDifferenceMultiplier: 1.0 };
        }
        
        let orderAmountMultiplier = 1.0;
        let priceDifferenceMultiplier = 1.0;
        
        if (isWeekend) {
            // 周末特殊处理
            if (isInTimeSlot) {
                // 周末 + 特殊时间段
                orderAmountMultiplier = 1.44;
                priceDifferenceMultiplier = 0.25;
            } else {
                // 周末 + 非特殊时间段
                orderAmountMultiplier = 1.2;
                priceDifferenceMultiplier = 0.5;
            }
        } else {
            // 工作日
            if (isInTimeSlot) {
                // 工作日 + 特殊时间段
                orderAmountMultiplier = 1.2;
                priceDifferenceMultiplier = 0.5;
            } else {
                // 工作日 + 非特殊时间段
                orderAmountMultiplier = 1.0;
                priceDifferenceMultiplier = 1.0;
            }
        }
        
        this.log('DEBUG', '动态配置计算', {
            ...timeInfo,
            isInTimeSlot,
            isWeekend,
            orderAmountMultiplier,
            priceDifferenceMultiplier
        });
        
        return { orderAmountMultiplier, priceDifferenceMultiplier };
    }

    /**
     * 根据市场精度计算订单数量
     * @param {number} price - 订单价格
     * @param {boolean} useBaseAmount - 是否使用基础金额（不进行动态调整）
     * @returns {Promise<string>} 格式化后的数量
     */
    async calculateOrderQuantityWithPrecision(price, useBaseAmount = false) {
        // 获取动态配置
        const { orderAmountMultiplier } = this.getDynamicConfig();
        
        // 根据上一笔交易持续时间调整订单金额
        let tradeHistoryAdjustedAmount;
        if (useBaseAmount) {
            tradeHistoryAdjustedAmount = this.config.orderAmount;
        } else {
            tradeHistoryAdjustedAmount = calculateOrderAmountMultiplier(this.config.symbol, this.config.orderAmount, this.config);
        }
        
        // 综合调整：交易历史调整后的金额 * 时间段倍数
        const adjustedOrderAmount = tradeHistoryAdjustedAmount * orderAmountMultiplier;
        
        const quantity = adjustedOrderAmount / price;
        
        try {
            // 获取市场精度信息
            const precisionInfo = await this.getMarketPrecision(this.config.symbol);
            const quantityPrecision = precisionInfo.quantityPrecision;
            
            // 确保数量不小于最小数量
            const minQuantity = parseFloat(precisionInfo.minQuantity || '0');
            if (quantity < minQuantity) {
                this.log('WARN', '计算数量小于最小数量，使用最小数量', {
                    calculatedQuantity: quantity,
                    minQuantity: minQuantity,
                    symbol: this.config.symbol
                });
                return minQuantity.toString();
            }
            
            // 使用市场精度格式化数量
            const formattedQuantity = quantity.toFixed(quantityPrecision).replace(/\.?0+$/, '');
            
            this.log('DEBUG', '计算订单数量', {
                isNewPosition: !useBaseAmount,
                baseOrderAmount: this.config.orderAmount,
                tradeHistoryAdjustedAmount: tradeHistoryAdjustedAmount,
                timeSlotMultiplier: orderAmountMultiplier,
                finalAdjustedAmount: adjustedOrderAmount,
                price: price,
                symbol: this.config.symbol,
                amountType: useBaseAmount ? '基础金额' : '动态调整金额'
            });
            
            return formattedQuantity;
        } catch (error) {
            this.log('ERROR', '计算订单数量失败，使用默认精度', {
                error: error.message,
                quantity: quantity
            });
            // 回退到默认精度
            return quantity.toFixed(4).replace(/\.?0+$/, '');
        }
    }

    /**
     * 初始化全局价格精度
     * 程序启动时获取一次bid/ask的价格精度，后续所有下单都使用这个精度
     */
    async initializeGlobalPricePrecision() {
        try {
            this.log('INFO', '初始化全局价格精度配置...');
            
            // 获取市场最佳价格
            const bestPrices = await this.client.getBestPrices(this.config.symbol);
            const bid = bestPrices.bestBid[0];
            const ask = bestPrices.bestAsk[0];
            
            // 计算bid和ask的小数位数
            const bidDecimalPlaces = bid.toString().includes('.') ? bid.toString().split('.')[1].length : 0;
            const askDecimalPlaces = ask.toString().includes('.') ? ask.toString().split('.')[1].length : 0;
            
            // 使用两者中的最大值作为全局精度
            const maxPrecision = Math.max(bidDecimalPlaces, askDecimalPlaces);
            
            // 设置全局价格精度
            setGlobalPricePrecision(maxPrecision);
            
            this.log('INFO', '全局价格精度配置完成', {
                symbol: this.config.symbol,
                bid: bid,
                ask: ask,
                bidDecimalPlaces: bidDecimalPlaces,
                askDecimalPlaces: askDecimalPlaces,
                globalPricePrecision: maxPrecision
            });
            
        } catch (error) {
            this.log('ERROR', '初始化全局价格精度失败，使用默认精度', {
                error: error.message,
                defaultPrecision: 1
            });
            // 使用默认精度
            setGlobalPricePrecision(1);
        }
    }

    /**
     * 获取当前市场价格
     */
    async getCurrentPrice() {
        const now = Date.now();
        
        // 检查查询间隔，避免频繁查询
        if (now - this.lastMarketPriceQueryTime < this.minQueryInterval) {
            // this.log('DEBUG', '市场价格查询间隔过短，跳过API查询', {
            //     timeSinceLastQuery: now - this.lastMarketPriceQueryTime,
            //     minInterval: this.minQueryInterval
            // });
            this.log('DEBUG', '市场价格查询间隔过短，跳过API查询');
            // 返回缓存的价格或默认值
            return { bid: this.currentMarketPrice, ask: this.currentMarketPrice, midPrice: this.currentMarketPrice };
        }
        
        try {
            this.lastMarketPriceQueryTime = now;
            const bestPrices = await this.client.getBestPrices(this.config.symbol);
            const bid = parseFloat(bestPrices.bestBid[0]);
            const ask = parseFloat(bestPrices.bestAsk[0]);
            const midPrice = (bid + ask) / 2;
            
            // 更新缓存的价格
            this.currentMarketPrice = midPrice;
            
            this.log('DEBUG', '获取市场价格', { bid, ask, midPrice });
            return { bid, ask, midPrice };
        } catch (error) {
            this.log('ERROR', '获取市场价格失败', {
                error: error.message
            });
            throw error;
        }
    }
    
    /**
     * 计算订单价格 - 限价单，基于市场最佳价格
     */
    calculateOrderPrice(bid, ask, side) {
        if (side === 'buy') {
            // 买单：使用买1价格，保持与bid相同的小数位数
            return formatPriceWithGlobalPrecision(bid);
        } else {
            // 卖单：使用卖1价格，保持与ask相同的小数位数
            return formatPriceWithGlobalPrecision(ask);
        }
    }
    
    /**
     * 计算订单数量
     */
    
    /**
     * 更新持仓 - 只有成交的订单才影响持仓
     */
    updatePosition(side, quantity, price, isClose = false) {
        const qty = parseFloat(quantity);
        const orderPrice = parseFloat(price);
        const oldPosition = this.currentPosition;
        const oldEntryPrice = this.positionEntryPrice;
        
        let positionChange = 0;
        
        if (isClose) {
            // 平仓：减少持仓
            positionChange = side === 'buy' ? -qty : qty;
        } else {
            // 开仓：增加持仓
            positionChange = side === 'buy' ? qty : -qty;
            
            // 更新入仓价格（加权平均）
            if (Math.abs(this.currentPosition) < 0.0001) {
                // 当前无持仓，直接使用新订单价格
                this.positionEntryPrice = orderPrice;
            } else if ((this.currentPosition > 0 && side === 'buy') || (this.currentPosition < 0 && side === 'sell')) {
                // 同方向加仓，计算加权平均价格
                const currentValue = Math.abs(this.currentPosition) * this.positionEntryPrice;
                const newValue = qty * orderPrice;
                const totalQuantity = Math.abs(this.currentPosition) + qty;
                this.positionEntryPrice = (currentValue + newValue) / totalQuantity;
            } else {
                // 反向开仓（减仓），保持原入仓价格
                // 这种情况下不改变入仓价格，因为这是在平仓
            }
        }
        
        this.currentPosition += positionChange;
        
        // 如果持仓接近0，重置入仓价格
        if (Math.abs(this.currentPosition) < 0.0001) {
            this.currentPosition = 0;
            this.positionEntryPrice = 0;
        }
        
        this.log('INFO', '持仓更新', {
            side,
            quantity: qty,
            price: orderPrice,
            isClose,
            positionChange,
            oldPosition,
            newPosition: this.currentPosition,
            oldEntryPrice,
            newEntryPrice: this.positionEntryPrice,
            positionSide: this.getCurrentPositionSide(),
            positionSize: this.getCurrentPositionSize()
        });
        
        return this.currentPosition;
    }
    
    /**
     * 检查订单是否已成交
     */
    isOrderFilled(orderData) {
        // 根据 openapi.json，成交状态为 'Filled' 或 'PartiallyFilled'
        const filledStatuses = ['Filled', 'PartiallyFilled'];
        
        // 先检查状态
        if (filledStatuses.includes(orderData.status)) {
            this.log('DEBUG', '订单已成交（状态检查）', {
                orderId: orderData.id,
                status: orderData.status,
                executedQuantity: orderData.executedQuantity,
                isFilled: true
            });
            return true;
        }
        
        // 检查 executedQuantity（根据 openapi.json，这是正确的字段）
        if (orderData.executedQuantity && parseFloat(orderData.executedQuantity) > 0) {
            this.log('DEBUG', '订单已成交（执行数量检查）', {
                orderId: orderData.id,
                status: orderData.status,
                executedQuantity: orderData.executedQuantity,
                quantity: orderData.quantity,
                isFilled: true
            });
            return true;
        }
        
        this.log('DEBUG', '订单未成交', {
            orderId: orderData.id,
            status: orderData.status,
            executedQuantity: orderData.executedQuantity,
            quantity: orderData.quantity,
            isFilled: false
        });
        
        return false;
    }
    
    /**
     * 获取当前持仓数量（绝对值）
     */
    getCurrentPositionSize() {
        return Math.abs(this.currentPosition);
    }
    
    /**
     * 获取当前持仓方向
     */
    getCurrentPositionSide() {
        if (this.currentPosition > 0) return 'long'; // 多头
        if (this.currentPosition < 0) return 'short'; // 空头
        return 'flat'; // 无持仓
    }
    
    /**
     * 检查账户实际持仓（通过API）
     * @returns {Promise<boolean>} 是否有持仓
     */
    async checkAccountPosition() {
        try {
            // getPositions 已经兼容404和返回空数组
            const positions = await this.client.getPositions(this.config.symbol);

            if (positions && positions.length > 0) {
                for (const position of positions) {
                    const netQuantity = parseFloat(position.netQuantity);
                    const markPrice = parseFloat(position.markPrice);
                    const positionValue = Math.abs(netQuantity) * markPrice;

                    // 有持仓价值即视为有持仓
                    if (positionValue > 0) {
                        return true;
                    }
                }
            }

            // 没有持仓
            return false;
        } catch (error) {
            // getPositions 已经处理了404，只有真正的异常才会抛出到这里
            this.log('WARN', '检查账户持仓失败，使用内部持仓判断', {
                error: error.message
            });
            // 回退到内部持仓判断
            return this.getCurrentPositionSize() !== 0;
        }
    }
    
    /**
     * 检查订单是否需要更新价格（30秒内无持仓时）
     */
    async checkAndUpdateOrderPrices() {
        const currentTime = Date.now();
        const thirtySecondsAgo = currentTime - 30000; // 30秒前
        
        // 检查账户实际持仓
        const hasPosition = await this.checkAccountPosition();
        
        for (const [orderId, orderData] of this.activeOrders) {
            const createTime = this.orderCreateTimes.get(orderId);
            if (!createTime) continue;
            
            // 如果订单创建超过30秒且账户无持仓
            if (createTime < thirtySecondsAgo && !hasPosition) {
                this.log('INFO', '订单超过30秒无持仓，更新为最新限价', {
                    orderId,
                    age: Math.round((currentTime - createTime) / 1000),
                    currentPosition: this.currentPosition
                });
                
                try {
                    // 获取最新市场价格
                    const prices = await this.getCurrentPrice();
                    if (!prices) continue;
                    
                    // 计算新的限价价格
                    const internalSide = orderData.internalSide || (orderData.side === 'Bid' ? 'buy' : 'sell');
                    const newPrice = this.calculateOrderPrice(prices.bid, prices.ask, internalSide);
                    
                    // 检查价格是否在允许的挂单区间内
                    if (!this.isPriceInAllowedRange(newPrice)) {
                        this.log('INFO', '更新后的价格超出允许区间，取消订单且不重新下单', {
                            orderId,
                            newPrice: parseFloat(newPrice).toFixed(1),
                            minOrderPrice: this.config.minOrderPrice ? this.config.minOrderPrice.toFixed(1) : '无限制',
                            maxOrderPrice: this.config.maxOrderPrice ? this.config.maxOrderPrice.toFixed(1) : '无限制',
                            note: '允许关闭或减少仓位，但禁止开新仓'
                        });
                        
                        // 取消旧订单，但不重新下单
                        await this.cancelOrder(orderId);
                        continue;
                    }
                    
                    // 取消旧订单
                    await this.cancelOrder(orderId);
                    
                    // 下新订单（保持原订单方向）
                    const quantity = orderData.quantity;
                    // 使用存储的内部side格式
                    const side = orderData.internalSide || (orderData.side === 'Bid' ? 'buy' : 'sell'); // 保持原订单方向
                    
                    this.log('INFO', '重新下订单', {
                        oldOrderId: orderId,
                        side,
                        newPrice,
                        quantity,
                        note: '保持原订单方向'
                    });
                    
                    // 重新下单
                    await this.placeOrder(side, newPrice, quantity);
                    
                } catch (error) {
                    this.log('ERROR', '更新订单价格失败', {
                        orderId,
                        error: error.message
                    });
                }
            }
        }
    }
    
    /**
     * 检查持仓变化并智能更新平仓单
     */
    async checkPositionAndUpdateCloseOrders() {
        // 防止重复执行
        if (this.isCreatingCloseOrder) {
            this.log('DEBUG', '正在创建平仓订单，跳过本次检查');
            return;
        }
        
        // 获取实际持仓信息
        const actualPosition = await this.getActualPositionInfo();
        
        if (!actualPosition || actualPosition.positionValue === 0) {
            // 无持仓时，通过API查询并取消所有平仓单
            const apiCloseOrders = await this.getCloseOrdersFromAPI();
            if (apiCloseOrders.length > 0) {
                this.log('INFO', '无持仓，取消所有平仓单', { 
                    apiCloseOrdersCount: apiCloseOrders.length,
                    closeOrders: apiCloseOrders.map(order => ({
                        id: order.id,
                        side: order.side,
                        price: parseFloat(order.price).toFixed(1),
                        quantity: parseFloat(order.quantity).toFixed(5),
                        status: order.status
                    }))
                });
                
                for (const closeOrder of apiCloseOrders) {
                    await this.cancelOrder(closeOrder.id);
                }
                this.closeOrders.clear(); // 清理本地记录
                this.lastPositionValue = 0; // 重置持仓价值记录
            }
            return;
        }
        
        const currentPositionValue = actualPosition.positionValue;
        const currentPositionSize = actualPosition.netQuantity;
        
        // 通过API查询平仓订单
        const apiCloseOrders = await this.getCloseOrdersFromAPI();
        
        // 检查是否需要创建或更新平仓订单
        if (apiCloseOrders.length === 0) {
            // 检查是否刚刚失败过，如果是则等待一段时间再重试
            const timeSinceLastFail = Date.now() - this.lastCloseOrderFailTime;
            const minRetryInterval = 3000; // 3秒间隔
            
            if (this.lastCloseOrderFailTime > 0 && timeSinceLastFail < minRetryInterval) {
                this.log('DEBUG', '平仓订单创建失败未超过重试间隔，跳过创建', {
                    timeSinceLastFail: Math.round(timeSinceLastFail / 1000) + 's',
                    minRetryInterval: minRetryInterval / 1000 + 's'
                });
                return;
            }
            
            // 没有平仓订单，需要创建
            this.log('INFO', '无平仓订单，创建新的平仓单', {
                positionSize: currentPositionSize,
                positionSide: actualPosition.side,
                positionValue: currentPositionValue,
                timeSinceLastFail: this.lastCloseOrderFailTime > 0 ? Math.round(timeSinceLastFail / 1000) + 's' : 'N/A'
            });
            
            await this.createCloseOrderForPosition(actualPosition);
            
        } else {
            // 计算持仓价值变化阈值（ORDER_AMOUNT的20%）
            const valueChangeThreshold = this.config.orderAmount * 0.2;
            const valueChange = Math.abs(currentPositionValue - this.lastPositionValue);
            
            if (valueChange > valueChangeThreshold) {
                // 持仓价值变化超过阈值，需要更新平仓订单
                this.log('INFO', '持仓价值变化超过阈值，更新平仓订单', {
                    oldPositionValue: this.lastPositionValue,
                    newPositionValue: currentPositionValue,
                    valueChange: valueChange.toFixed(2),
                    threshold: valueChangeThreshold.toFixed(2),
                    positionSize: currentPositionSize,
                    positionSide: actualPosition.side,
                    thresholdPercentage: '20%'
                });
                
                // 取消所有现有的平仓订单
                for (const closeOrder of apiCloseOrders) {
                    try {
                        const cancelResult = await this.cancelOrder(closeOrder.id);
                        if (!cancelResult) {
                            this.log('WARN', '取消平仓订单失败，但继续处理', {
                                orderId: closeOrder.id,
                                orderStatus: closeOrder.status
                            });
                        }
                    } catch (error) {
                        this.log('ERROR', '取消平仓订单异常', {
                            orderId: closeOrder.id,
                            error: error.message,
                            orderStatus: closeOrder.status
                        });
                    }
                }
                
                // 重新创建平仓订单
                await this.createCloseOrderForPosition(actualPosition);
            } else {
                // this.log('INFO', '持仓价值变化未超过阈值，无需更新平仓订单', {
                //     valueChange: valueChange.toFixed(2),
                //     threshold: valueChangeThreshold.toFixed(2),
                //     thresholdPercentage: '20%'
                // });
            }
            
            // 检查平仓订单数量是否匹配持仓数量
            let totalCloseQuantity = 0;
            for (const closeOrder of apiCloseOrders) {
                totalCloseQuantity += parseFloat(closeOrder.quantity);
            }
            
            if (Math.abs(totalCloseQuantity - currentPositionSize) > 0.0001) {
                this.log('INFO', '平仓订单数量与持仓不匹配，重新创建', {
                    totalCloseQuantity,
                    currentPositionSize,
                    difference: Math.abs(totalCloseQuantity - currentPositionSize),
                    apiCloseOrdersCount: apiCloseOrders.length
                });
                
                // 取消所有现有平仓订单
                for (const closeOrder of apiCloseOrders) {
                    try {
                        const cancelResult = await this.cancelOrder(closeOrder.id);
                        if (!cancelResult) {
                            this.log('WARN', '取消平仓订单失败，但继续处理', {
                                orderId: closeOrder.id,
                                orderStatus: closeOrder.status
                            });
                        }
                    } catch (error) {
                        this.log('ERROR', '取消平仓订单异常', {
                            orderId: closeOrder.id,
                            error: error.message,
                            orderStatus: closeOrder.status
                        });
                    }
                }
                
                await this.createCloseOrderForPosition(actualPosition);
            } else {
                this.log('DEBUG', '平仓订单状态正常，无需更新', {
                    apiCloseOrdersCount: apiCloseOrders.length,
                    totalCloseQuantity,
                    currentPositionSize
                });
            }
        }
        
        // 更新持仓价值记录
        this.lastPositionValue = currentPositionValue;
    }
    
    /**
     * 为当前持仓创建平仓订单
     */
    async createCloseOrderForPosition(actualPosition) {
        try {
            const symbol = this.config.symbol;
            const now = Date.now();
            const minInterval = 10000; // 10秒间隔
            
            // 检查是否在最小间隔内创建过平仓单
            if (this.lastCloseOrderCreateTime.has(symbol)) {
                const timeSinceLastCreate = now - this.lastCloseOrderCreateTime.get(symbol);
                if (timeSinceLastCreate < minInterval) {
                    const remainingTime = Math.ceil((minInterval - timeSinceLastCreate) / 1000);
                    this.log('DEBUG', '平仓单创建间隔过短，跳过创建', {
                        symbol,
                        timeSinceLastCreate: Math.round(timeSinceLastCreate / 1000) + 's',
                        minInterval: minInterval / 1000 + 's',
                        remainingTime: remainingTime + 's'
                    });
                    return;
                }
            }
            
            // 先查询是否已有平仓订单
            const existingCloseOrders = await this.getCloseOrdersFromAPI();
            
            if (existingCloseOrders.length > 0) {
                // 已有平仓订单，取消旧订单并创建新订单
                this.log('INFO', '发现现有平仓订单，取消后重新创建', {
                    existingOrdersCount: existingCloseOrders.length,
                    positionValue: actualPosition.positionValue,
                    positionSize: actualPosition.netQuantity,
                    existingOrders: existingCloseOrders.map(order => ({
                        id: order.id,
                        side: order.side,
                        price: parseFloat(order.price).toFixed(1),
                        quantity: parseFloat(order.quantity).toFixed(5),
                        status: order.status
                    }))
                });
                
                // 取消所有现有平仓订单
                for (const closeOrder of existingCloseOrders) {
                    try {
                        const cancelResult = await this.cancelOrder(closeOrder.id);
                        if (!cancelResult) {
                            this.log('WARN', '取消现有平仓订单失败，但继续处理', {
                                orderId: closeOrder.id,
                                orderStatus: closeOrder.status
                            });
                        }
                    } catch (error) {
                        this.log('ERROR', '取消现有平仓订单异常', {
                            orderId: closeOrder.id,
                            error: error.message,
                            orderStatus: closeOrder.status
                        });
                    }
                }
                
                // 等待一小段时间确保取消操作完成
                await this.sleep(500);
            } else {
                // 没有现有平仓订单，直接创建新订单
                this.log('INFO', '无现有平仓订单，直接创建新订单', {
                    positionValue: actualPosition.positionValue,
                    positionSize: actualPosition.netQuantity
                });
            }
            
            const entrySide = actualPosition.side === 'long' ? 'buy' : 'sell';
            const dummyOrderId = `position_${Date.now()}`;
            
            this.log('INFO', '为持仓创建平仓订单', {
                dummyOrderId,
                entrySide,
                entryPrice: actualPosition.entryPrice,
                positionSize: actualPosition.netQuantity,
                positionValue: actualPosition.positionValue,
                positionSide: actualPosition.side,
                hadExistingOrders: existingCloseOrders.length > 0
            });
            
            const result = await this.placeCloseOrder(dummyOrderId, entrySide, actualPosition.entryPrice, actualPosition.netQuantity);
            
            if (result) {
                // 创建成功，清除失败时间记录
                this.lastCloseOrderFailTime = 0;
                this.log('INFO', '平仓订单创建成功', {
                    closeOrderId: result.id,
                    positionValue: actualPosition.positionValue,
                    replacedExisting: existingCloseOrders.length > 0,
                    existingOrdersCancelled: existingCloseOrders.length
                });
            } else {
                // 创建失败，记录失败时间
                this.lastCloseOrderFailTime = Date.now();
                this.log('WARN', '平仓订单创建失败，记录失败时间', {
                    failTime: new Date(this.lastCloseOrderFailTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
                    positionValue: actualPosition.positionValue,
                    positionSize: actualPosition.netQuantity,
                    positionSide: actualPosition.side,
                    entryPrice: actualPosition.entryPrice,
                    retryAfter: '3秒后重试',
                    hadExistingOrders: existingCloseOrders.length > 0,
                    existingOrdersCancelled: existingCloseOrders.length
                });
            }
            
        } catch (error) {
            // 异常情况也记录失败时间
            this.lastCloseOrderFailTime = Date.now();
            this.log('ERROR', '创建平仓订单异常', {
                error: error.message,
                errorStack: error.stack,
                positionValue: actualPosition.positionValue,
                positionSize: actualPosition.netQuantity,
                positionSide: actualPosition.side,
                entryPrice: actualPosition.entryPrice,
                failTime: new Date(this.lastCloseOrderFailTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
                retryAfter: '3秒后重试'
            });
        }
    }
    
    /**
     * 更新现有平仓订单的价格（不重新创建订单）
     */
    async updateCloseOrderPrices(actualPosition) {
        try {
            // 计算新的平仓价格
            const newClosePrice = await this.calculateClosePriceFromPosition(actualPosition);
            
            // 更新所有现有的平仓订单价格
            for (const [entryOrderId, closeOrder] of this.closeOrders) {
                const currentPrice = parseFloat(closeOrder.price);
                const newPrice = parseFloat(newClosePrice);
                
                // 只有价格真正变化时才更新
                if (Math.abs(currentPrice - newPrice) > 0.01) {
                    this.log('INFO', '更新平仓订单价格', {
                        orderId: closeOrder.id,
                        oldPrice: currentPrice,
                        newPrice: newPrice,
                        positionValue: actualPosition.positionValue,
                        entryPrice: actualPosition.entryPrice
                    });
                    
                    // 由于Backpack API可能不支持直接修改订单价格，
                    // 这里我们先取消旧订单，然后创建新订单
                    await this.cancelOrder(closeOrder.id);
                    
                    // 创建新的平仓订单
                    const closeSide = actualPosition.side === 'long' ? 'sell' : 'buy';
                    const closeOrderData = await this.placeOrder(
                        closeSide,
                        newClosePrice,
                        actualPosition.netQuantity.toFixed(5).replace(/\.?0+$/, ''),
                        5, // maxRetries
                        true, // reduceOnly
                        null, // postOnly (使用默认配置)
                        true // isCloseOrder
                    );
                    
                    if (closeOrderData) {
                        // 更新closeOrders记录
                        this.closeOrders.set(entryOrderId, {
                            id: closeOrderData.id,
                            price: newClosePrice,
                            quantity: actualPosition.netQuantity.toFixed(5),
                            side: closeSide,
                            timestamp: Date.now()
                        });
                    }
                } else {
                    this.log('DEBUG', '平仓订单价格无需更新', {
                        orderId: closeOrder.id,
                        currentPrice,
                        calculatedPrice: newPrice
                    });
                }
            }
            
        } catch (error) {
            this.log('ERROR', '更新平仓订单价格失败', {
                error: error.message,
                position: actualPosition
            });
        }
    }
    
    /**
     * 计算平仓价格
     */
    calculateClosePrice(entryPrice, side, quantity) {
        // 计算总手续费率（开仓 + 平仓，假设都使用 maker 费率）
        const totalFeeRate = this.config.makerFee * 2; // 开仓和平仓各一次
        
        // 目标净盈利比例（除手续费外的盈利）
        const netProfitRate = this.config.profitTarget;
        
        // 总盈利比例 = 净盈利比例 + 手续费比例
        const totalProfitRate = netProfitRate + totalFeeRate;
        
        let closePrice;
        if (side === 'buy') {
            // 买单：平仓价格 = 买入价 * (1 + 总盈利比例)
            closePrice = parseFloat(entryPrice) * (1 + totalProfitRate);
        } else {
            // 卖单：平仓价格 = 卖出价 * (1 - 总盈利比例)
            closePrice = parseFloat(entryPrice) * (1 - totalProfitRate);
        }
        
        this.log('DEBUG', '计算平仓价格', {
            entryPrice,
            side,
            quantity,
            totalFeeRate: (totalFeeRate * 100).toFixed(4) + '%',
            netProfitRate: (netProfitRate * 100).toFixed(4) + '%',
            totalProfitRate: (totalProfitRate * 100).toFixed(4) + '%',
            closePrice: closePrice.toFixed(1),
            feeType: 'maker'
        });
        
        return closePrice.toFixed(1);
    }
    
    /**
     * 下单 - 限价单，失败重试直到成功
     */
    async placeOrder(side, price, quantity, maxRetries = 5, reduceOnly = false, postOnly = null, isCloseOrder = false) {
        let retryCount = 0;
        
        while (retryCount < maxRetries) {
            try {
                // 直接使用 Bid/Ask 格式，符合 Backpack API 规范
                const apiSide = side === 'buy' ? 'Bid' : 'Ask';
                
                // 如果没有明确指定 postOnly，则使用配置文件中的默认值
                // 所有订单（包括平仓订单）都遵循配置中的 postOnly 设置
                const usePostOnly = postOnly !== null ? postOnly : this.config.postOnly;
                
                // this.log('INFO', '准备下单', { 
                //     side, 
                //     apiSide,
                //     price, 
                //     quantity, 
                //     symbol: this.config.symbol,
                //     orderType: 'Limit',
                //     reduceOnly,
                //     postOnly: usePostOnly,
                //     retry: retryCount + 1 
                // });
                
                const order = await this.client.placeOrder(
                    this.config.symbol,
                    apiSide,           // 'Bid' 或 'Ask'
                    'Limit',           // 限价单
                    quantity,          // 数量
                    formatPriceWithGlobalPrecision(price), // 价格 - 使用全局精度函数
                    reduceOnly,        // 是否仅平仓
                    usePostOnly        // 是否仅挂单
                );
                
                if (order && order.length > 0) {
                    const orderData = order[0];
                    
                    this.log('DEBUG', '订单创建API返回', {
                        orderData,
                        orderId: orderData.id,
                        hasId: !!orderData.id,
                        isCloseOrder
                    });
                    
                    // 检查订单是否创建成功（有ID且没有错误）
                    if (orderData.id && !orderData.code) {
                        // 只有开仓订单才加入 activeOrders，平仓订单不加入
                        if (!isCloseOrder) {
                            this.activeOrders.set(orderData.id, {
                                ...orderData,
                                internalSide: side,  // 保存内部使用的 side ('buy'/'sell')
                                originalPrice: price,
                                quantity,
                                timestamp: Date.now()
                                // 不覆盖API返回的status，使用原始状态
                            });
                            
                            // 记录订单创建时间
                            this.orderCreateTimes.set(orderData.id, Date.now());
                        }
                    } else {
                        // 订单创建失败
                        this.log('ERROR', '订单创建失败', {
                            orderData,
                            error: orderData.message || '未知错误',
                            code: orderData.code
                        });
                        throw new Error(orderData.message || '订单创建失败');
                    }
                    
                    this.stats.totalOrders++;
                    
                    this.log('INFO', '订单创建成功', { 
                        orderId: orderData.id, 
                        side, 
                        price, 
                        quantity,
                        reduceOnly,
                        isCloseOrder,
                        orderType: isCloseOrder ? '平仓订单' : '开仓订单',
                        retry: retryCount + 1
                    });
                    
                    // 如果是平仓订单，清除缓存
                    if (isCloseOrder) {
                        this.clearCloseOrdersCache();
                    }
                    
                    // 记录到CSV
                    this.logTrade({
                        symbol: this.config.symbol,
                        side: apiSide, // 直接使用 API side ('Bid' 或 'Ask')
                        orderType: 'Limit',
                        price,
                        quantity,
                        orderId: orderData.id,
                        status: 'New'
                    });
                    
                    // 下单成功后，如果不是平仓订单才检查并调整平仓单
                    // 避免平仓订单创建时触发无限循环
                    if (!isCloseOrder) {
                        await this.checkPositionAndUpdateCloseOrders();
                    }
                    
                    return orderData;
                } else {
                    throw new Error('订单创建失败：无返回数据');
                }
            } catch (error) {
                retryCount++;
                
                // 检查是否是PostOnlyTaker错误（挂单价格太接近市价会立即成交）
                const isPostOnlyTakerError = error.message && (
                    error.message.includes('PostOnlyTaker') ||
                    error.message.includes('would immediately match and take') ||
                    error.message.includes('Order would immediately match')
                );
                
                // 检查是否是ReduceOnly错误（平仓订单数量超过持仓）
                const isReduceOnlyError = error.message && (
                    error.message.includes('Reduce only order not reduced') ||
                    error.message.includes('reduce only') ||
                    error.message.includes('ReduceOnly')
                );
                
                if (isPostOnlyTakerError) {
                    this.log('WARN', 'PostOnly订单会立即成交，调整价格重新挂单', { 
                        error: error.message, 
                        side, 
                        originalPrice: price, 
                        quantity,
                        retry: retryCount
                    });
                    
                    // 获取最新的市场价格，调整挂单价格
                    const adjustedPrice = await this.adjustPriceForPostOnly(side, price);
                    if (adjustedPrice && adjustedPrice !== price) {
                        this.log('INFO', '价格已调整，重新挂单', {
                            side,
                            originalPrice: price,
                            adjustedPrice,
                            quantity
                        });
                        
                        // 使用调整后的价格重新挂单
                        price = adjustedPrice;
                        retryCount--; // 不计入重试次数，因为是价格调整
                        await this.sleep(500); // 短暂等待
                        continue;
                    }
                }
                
                if (isReduceOnlyError) {
                    this.log('WARN', 'ReduceOnly订单错误，撤销原平仓单并重新创建', { 
                        error: error.message, 
                        side, 
                        originalQuantity: quantity, 
                        retry: retryCount,
                        isCloseOrder
                    });
                    
                    // 如果是平仓订单，先撤销所有现有的平仓订单
                    if (isCloseOrder) {
                        try {
                            const existingCloseOrders = await this.getCloseOrdersFromAPI();
                            this.log('INFO', '撤销现有平仓订单', {
                                existingOrdersCount: existingCloseOrders.length,
                                side: side
                            });
                            
                            for (const order of existingCloseOrders) {
                                if (order.side === side) {
                                    try {
                                        await this.cancelOrder(order.id);
                                        this.log('INFO', '撤销平仓订单成功', {
                                            orderId: order.id,
                                            side: order.side,
                                            quantity: order.quantity
                                        });
                                    } catch (cancelError) {
                                        this.log('WARN', '撤销平仓订单失败', {
                                            orderId: order.id,
                                            error: cancelError.message
                                        });
                                    }
                                }
                            }
                            
                            // 等待一下确保撤销完成
                            await this.sleep(1000);
                        } catch (error) {
                            this.log('ERROR', '撤销平仓订单时出错', {
                                error: error.message
                            });
                        }
                    }
                    
                    // 重新获取实际持仓信息
                    const actualPosition = await this.getActualPositionInfo();
                    
                    this.log('DEBUG', 'ReduceOnly错误后重新获取持仓信息', {
                        actualPosition: actualPosition ? '存在' : '不存在',
                        positionValue: actualPosition ? actualPosition.positionValue : 0,
                        netQuantity: actualPosition ? actualPosition.netQuantity : 0,
                        isCloseOrder
                    });
                    
                    if (!actualPosition || actualPosition.positionValue === 0) {
                        this.log('ERROR', '无持仓但尝试平仓，取消操作', {
                            error: error.message,
                            side,
                            quantity,
                            isCloseOrder,
                            actualPosition: actualPosition ? '存在但价值为0' : '不存在'
                        });
                        return null;
                    }
                    
                    // 使用实际持仓数量重新下单
                    let adjustedQuantity;
                    try {
                        const precisionInfo = await this.getMarketPrecision(this.config.symbol);
                        adjustedQuantity = Math.abs(actualPosition.netQuantity).toFixed(precisionInfo.quantityPrecision).replace(/\.?0+$/, '');
                    } catch (error) {
                        this.log('WARN', '获取数量精度失败，使用默认精度', { error: error.message });
                        adjustedQuantity = Math.abs(actualPosition.netQuantity).toFixed(5).replace(/\.?0+$/, '');
                    }
                    
                    if (parseFloat(adjustedQuantity) <= 0) {
                        this.log('ERROR', '实际持仓数量为0或负数，取消平仓操作', {
                            actualQuantity: adjustedQuantity,
                            positionValue: actualPosition.positionValue
                        });
                        return null;
                    }
                    
                    this.log('INFO', '使用实际持仓数量重新创建平仓订单', {
                        originalQuantity: quantity,
                        adjustedQuantity,
                        positionSide: actualPosition.side,
                        positionValue: actualPosition.positionValue,
                        isCloseOrder
                    });
                    
                    // 使用调整后的数量
                    quantity = adjustedQuantity;
                    
                    retryCount--; // 不计入重试次数，因为是重新创建
                    await this.sleep(500); // 短暂等待
                    continue;
                }
                
                // 检查是否是价格偏离过远的错误
                const isPriceTooFarError = error.message.includes('Price is too far from the last active price');
                
                if (isPriceTooFarError) {
                    this.log('WARN', '价格偏离过远，尝试获取最新市场价格重新下单', {
                        error: error.message,
                        side,
                        currentPrice: price,
                        quantity,
                        retry: retryCount
                    });
                    
                    // 获取最新的市场价格
                    const marketData = await this.getMarketData();
                    if (marketData) {
                        const { bestBid, bestAsk } = marketData;
                        const bestBidNum = parseFloat(bestBid);
                        const bestAskNum = parseFloat(bestAsk);
                        
                        // 根据订单方向选择合适的价格
                        let newPrice;
                        if (side === 'buy') {
                            // 买单使用买1价格
                            newPrice = bestBidNum;
                        } else {
                            // 卖单使用卖1价格
                            newPrice = bestAskNum;
                        }
                        
                        this.log('INFO', '使用最新市场价格重新下单', {
                            side,
                            originalPrice: price,
                            newPrice: newPrice,
                            bestBid: bestBidNum,
                            bestAsk: bestAskNum
                        });
                        
                        // 使用新价格重新下单
                        price = formatPriceWithGlobalPrecision(newPrice);
                        retryCount--; // 不计入重试次数
                        await this.sleep(500); // 短暂等待
                        continue;
                    } else {
                        this.log('ERROR', '无法获取最新市场价格，跳过重试');
                    }
                }
                
                this.log('WARN', '下单失败，准备重试', { 
                    error: error.message, 
                    side, 
                    price, 
                    quantity,
                    retry: retryCount,
                    maxRetries,
                    isPostOnlyTakerError,
                    isPriceTooFarError
                });
                
                if (retryCount >= maxRetries) {
                    this.stats.failedOrders++;
                    this.log('ERROR', '下单重试次数已达上限', { 
                        error: error.message, 
                        side, 
                        price, 
                        quantity,
                        maxRetries
                    });
                    throw error;
                }
                
                // 重试前等待一段时间
                await this.sleep(1000 * retryCount); // 递增等待时间
            }
        }
    }
    
    /**
     * 获取市场数据（买1卖1价格）
     * @returns {Promise<Object|null>} 包含bestBid和bestAsk的市场数据
     */
    async getMarketData() {
        try {
            const depthData = await this.client.getDepth(this.config.symbol);
            if (!depthData || !depthData.bids || !depthData.asks || 
                depthData.bids.length === 0 || depthData.asks.length === 0) {
                this.log('WARN', '市场深度数据无效', {
                    hasDepthData: !!depthData,
                    hasBids: !!(depthData && depthData.bids),
                    hasAsks: !!(depthData && depthData.asks),
                    bidsLength: depthData?.bids?.length || 0,
                    asksLength: depthData?.asks?.length || 0
                });
                return null;
            }

            const bestBid = depthData.bids[depthData.bids.length - 1][0]; // 最高买价（买1）
            const bestAsk = depthData.asks[0][0]; // 最低卖价（卖1）
            
            const bestBidNum = parseFloat(bestBid);
            const bestAskNum = parseFloat(bestAsk);

            // 验证数据的有效性
            if (isNaN(bestBidNum) || isNaN(bestAskNum) || bestBidNum <= 0 || bestAskNum <= 0) {
                this.log('ERROR', '市场数据包含无效价格', {
                    bestBid: bestBid,
                    bestAsk: bestAsk,
                    bestBidNum: bestBidNum,
                    bestAskNum: bestAskNum
                });
                return null;
            }
            
            // 验证价格合理性
            if (bestAskNum <= bestBidNum) {
                this.log('ERROR', '市场数据异常：卖价低于买价', {
                    bestBid: bestBidNum,
                    bestAsk: bestAskNum,
                    spread: bestAskNum - bestBidNum
                });
                return null;
            }

            this.log('DEBUG', '获取市场数据', {
                symbol: this.config.symbol,
                bestBid: bestBidNum,
                bestAsk: bestAskNum,
                spread: (bestAskNum - bestBidNum).toFixed(2),
                spreadPercent: (((bestAskNum - bestBidNum) / bestBidNum) * 100).toFixed(4) + '%'
            });

            return {
                bestBid: bestBidNum.toString(),
                bestAsk: bestAskNum.toString(),
                bids: depthData.bids,
                asks: depthData.asks
            };

        } catch (error) {
            this.log('ERROR', '获取市场数据失败', { 
                error: error.message,
                symbol: this.config.symbol
            });
            return null;
        }
    }

    /**
     * 调整PostOnly订单价格，避免立即成交
     * @param {string} side - 订单方向 'buy' 或 'sell'
     * @param {string} currentPrice - 当前价格
     * @returns {Promise<string|null>} 调整后的价格
     */
    async adjustPriceForPostOnly(side, currentPrice) {
        try {
            // 获取最新的市场价格
            const marketData = await this.getMarketData();
            if (!marketData) {
                this.log('WARN', '无法获取市场数据，无法调整价格');
                return null;
            }
            
            const { bestBid, bestAsk } = marketData;
            const currentPriceNum = parseFloat(currentPrice);
            const bestBidNum = parseFloat(bestBid);
            const bestAskNum = parseFloat(bestAsk);
            
            // 验证市场数据的有效性
            if (isNaN(bestBidNum) || isNaN(bestAskNum) || bestBidNum <= 0 || bestAskNum <= 0) {
                this.log('ERROR', '市场数据无效', {
                    bestBid: bestBid,
                    bestAsk: bestAsk,
                    bestBidNum: bestBidNum,
                    bestAskNum: bestAskNum
                });
                return null;
            }
            
            // 验证价格合理性
            if (bestAskNum <= bestBidNum) {
                this.log('ERROR', '市场数据异常：卖价低于买价', {
                    bestBid: bestBidNum,
                    bestAsk: bestAskNum
                });
                return null;
            }
            
            // 价格调整幅度（确保不会立即成交）
            const priceStep = Math.max(0.1, currentPriceNum * 0.0001); // 至少0.1或0.01%
            let adjustedPrice;
            
            if (side === 'buy') {
                // 买单：确保价格低于当前最佳卖价(bestAsk)
                const maxBuyPrice = bestAskNum - priceStep;
                
                if (currentPriceNum >= bestAskNum) {
                    // 当前价格太高，调整为买1价格减去步长，确保不会立即成交
                    adjustedPrice = bestBidNum - priceStep;
                    this.log('DEBUG', '买单价格调整', {
                        currentPrice: currentPriceNum,
                        bestAsk: bestAskNum,
                        bestBid: bestBidNum,
                        maxBuyPrice: maxBuyPrice,
                        adjustedPrice,
                        priceStep,
                        note: '使用买1价格减去步长'
                    });
                } else {
                    // 价格看起来合理，可能是市场快速变动，稍微降低价格
                    adjustedPrice = currentPriceNum - priceStep;
                    this.log('DEBUG', '买单价格微调', {
                        currentPrice: currentPriceNum,
                        adjustedPrice,
                        priceStep
                    });
                }
                
            } else { // sell
                // 卖单：确保价格高于当前最佳买价(bestBid)
                const minSellPrice = bestBidNum + priceStep;

                if (currentPriceNum <= bestBidNum) {
                    // 当前价格太低，调整为卖1价格加上步长，确保不会立即成交
                    adjustedPrice = bestAskNum + priceStep;
                    this.log('DEBUG', '卖单价格调整', {
                        currentPrice: currentPriceNum,
                        bestBid: bestBidNum,
                        bestAsk: bestAskNum,
                        minSellPrice: minSellPrice,
                        adjustedPrice,
                        priceStep,
                        note: '使用卖1价格加上步长'
                    });
                } else {
                    // 价格看起来合理，可能是市场快速变动，稍微提高价格
                    adjustedPrice = currentPriceNum + priceStep;
                    this.log('DEBUG', '卖单价格微调', {
                        currentPrice: currentPriceNum,
                        adjustedPrice,
                        priceStep
                    });
                }
            }
            
            // 确保调整后的价格是合理的
            if (adjustedPrice <= 0 || isNaN(adjustedPrice)) {
                this.log('WARN', '调整后价格无效', {
                    adjustedPrice,
                    currentPrice: currentPriceNum,
                    bestBid: bestBidNum,
                    bestAsk: bestAskNum
                });
                return null;
            }
            
            // 验证调整后的价格是否在合理范围内
            if (side === 'buy' && adjustedPrice >= bestAskNum) {
                this.log('WARN', '调整后买单价格仍然过高', {
                    adjustedPrice,
                    bestAsk: bestAskNum
                });
                adjustedPrice = bestBidNum - priceStep;
            } else if (side === 'sell' && adjustedPrice <= bestBidNum) {
                this.log('WARN', '调整后卖单价格仍然过低', {
                    adjustedPrice,
                    bestBid: bestBidNum
                });
                adjustedPrice = bestAskNum + priceStep;
            }
            
            const formattedPrice = formatPriceWithGlobalPrecision(adjustedPrice);
            
            this.log('INFO', '价格调整完成', {
                side,
                originalPrice: currentPrice,
                adjustedPrice: formattedPrice,
                bestBid: bestBidNum,
                bestAsk: bestAskNum,
                priceStep
            });
            
            return formattedPrice;
            
        } catch (error) {
            this.log('ERROR', '价格调整失败', { 
                error: error.message, 
                side, 
                currentPrice 
            });
            return null;
        }
    }

    /**
     * 取消订单
     */
    async cancelOrder(orderId) {
        try {
            const cancelResult = await this.client.cancelOrder(orderId, this.config.symbol);
            this.activeOrders.delete(orderId);
            this.orderCreateTimes.delete(orderId); // 清理订单创建时间记录
            
            // 从平仓订单中删除（需要根据orderId查找对应的entryOrderId）
            for (const [entryOrderId, closeOrder] of this.closeOrders) {
                if (closeOrder.id === orderId) {
                    this.closeOrders.delete(entryOrderId);
                    break;
                }
            }
            this.log('INFO', '订单取消成功', {
                orderId: orderId,
                apiResponse: cancelResult
            });
            // 清除缓存，因为订单状态已改变
            this.clearCloseOrdersCache();
            return true;
        } catch (error) {
            // 检查是否是"Order not found"错误
            if (error.message && error.message.includes('Order not found')) {
                this.log('WARN', '订单不存在，可能已被取消或成交', {
                    orderId,
                    error: error.message
                });
                
                // 即使订单不存在，也要清理本地记录
                this.activeOrders.delete(orderId);
                this.orderCreateTimes.delete(orderId);
                
                // 从平仓订单中删除
                for (const [entryOrderId, closeOrder] of this.closeOrders) {
                    if (closeOrder.id === orderId) {
                        this.closeOrders.delete(entryOrderId);
                        break;
                    }
                }
                
                return true; // 视为成功，因为订单已经不存在
            } else {
                this.log('ERROR', '取消订单失败', {
                    orderId,
                    error: error.message
                });
                return false;
            }
        }
    }
    
    /**
     * 基于实际持仓信息计算平仓价格
     * @param {Object} position - 实际持仓信息
     * @returns {string} 平仓价格
     */
    async calculateClosePriceFromPosition(position) {
        // 计算总手续费率（开仓 + 平仓，假设都使用 maker 费率）
        const totalFeeRate = this.config.makerFee * 2; // 开仓和平仓各一次
        
        // 目标净盈利比例（除手续费外的盈利）
        const netProfitRate = this.config.profitTarget;
        
        // 总盈利比例 = 净盈利比例 + 手续费比例
        const totalProfitRate = netProfitRate + totalFeeRate;
        
        // 计算理论平仓价格
        let closePrice;
        if (position.side === 'long') {
            // 多头持仓：平仓价格 = 入仓价 * (1 + 总盈利比例)
            closePrice = position.entryPrice * (1 + totalProfitRate);
        } else {
            // 空头持仓：平仓价格 = 入仓价 * (1 - 总盈利比例)
            closePrice = position.entryPrice * (1 - totalProfitRate);
        }
        
        // 获取当前市场价格进行比较
        try {
            const { bid, ask } = await this.getCurrentPrice();
            const marketPrice = position.side === 'long' ? bid : ask; // 多头用买价平仓，空头用卖价平仓
            
            // 计算理论平仓价格的收益
            const theoreticalProfitRate = position.side === 'long' 
                ? (closePrice - position.entryPrice) / position.entryPrice
                : (position.entryPrice - closePrice) / position.entryPrice;
            
            // 计算市场价格的收益
            const marketProfitRate = position.side === 'long'
                ? (marketPrice - position.entryPrice) / position.entryPrice
                : (position.entryPrice - marketPrice) / position.entryPrice;
            
            // 如果市场价格收益更高且超过目标收益，使用市场价格
            if (marketProfitRate > theoreticalProfitRate && marketProfitRate >= netProfitRate) {
                this.log('INFO', '市场价格收益更高，使用市场价格作为平仓价格', {
                    positionSide: position.side,
                    entryPrice: position.entryPrice.toFixed(1),
                    theoreticalPrice: closePrice.toFixed(1),
                    marketPrice: marketPrice.toFixed(1),
                    theoreticalProfitRate: (theoreticalProfitRate * 100).toFixed(4) + '%',
                    marketProfitRate: (marketProfitRate * 100).toFixed(4) + '%',
                    targetProfitRate: (netProfitRate * 100).toFixed(4) + '%'
                });
                closePrice = marketPrice;
            }
        } catch (error) {
            this.log('WARN', '获取市场价格失败，使用理论平仓价格', {
                error: error.message,
                theoreticalPrice: closePrice.toFixed(1)
            });
        }
        
        this.log('DEBUG', '计算平仓价格', {
            positionSide: position.side,
            entryPrice: position.entryPrice,
            netQuantity: position.netQuantity,
            positionValue: position.positionValue,
            totalFeeRate: (totalFeeRate * 100).toFixed(4) + '%',
            netProfitRate: (netProfitRate * 100).toFixed(4) + '%',
            totalProfitRate: (totalProfitRate * 100).toFixed(4) + '%',
            closePrice: closePrice.toString()
        });
        
        // 获取当前市场价格来确定小数位数（强制获取最新价格）
        try {
            // 清除缓存，强制获取最新市场价格
            this.lastMarketPriceQueryTime = 0;
            const { bid, ask } = await this.getCurrentPrice();
            const marketPrice = position.side === 'long' ? bid : ask;
            const formattedPrice = formatPriceWithGlobalPrecision(closePrice);
            
            this.log('DEBUG', '平仓价格精度调整', {
                originalPrice: closePrice,
                marketPrice: marketPrice,
                formattedPrice: formattedPrice
            });
            
            return formattedPrice;
        } catch (error) {
            // 如果获取市场价格失败，使用默认精度（1位小数）
            this.log('WARN', '获取市场价格失败，使用默认精度', {
                error: error.message,
                defaultPrice: formatPriceWithGlobalPrecision(closePrice)
            });
            return formatPriceWithGlobalPrecision(closePrice);
        }
    }
    
    /**
     * 通过API查询平仓订单
     */
    async getCloseOrdersFromAPI() {
        const now = Date.now();
        
        // 检查缓存是否有效
        if (this.cachedCloseOrders && (now - this.cachedCloseOrdersTime) < this.cacheValidDuration) {
            // this.log('DEBUG', '使用缓存的平仓订单数据', {
            //     cacheAge: now - this.cachedCloseOrdersTime,
            //     cacheValidDuration: this.cacheValidDuration,
            //     cachedOrdersCount: this.cachedCloseOrders.length,
            //     cachedOrderDetails: this.cachedCloseOrders.map(o => ({
            //         id: o.id,
            //         side: o.side,
            //         price: parseFloat(o.price).toFixed(1),
            //         quantity: parseFloat(o.quantity).toFixed(4),
            //         status: o.status
            //     }))
            // });
            this.log('DEBUG', '使用缓存的平仓订单数据');
            return this.cachedCloseOrders;
        }
        
        // 检查查询间隔，避免频繁查询
        if (now - this.lastCloseOrdersQueryTime < this.minQueryInterval) {
            this.log('DEBUG', '查询间隔过短，跳过API查询', {
                timeSinceLastQuery: now - this.lastCloseOrdersQueryTime,
                minInterval: this.minQueryInterval
            });
            return this.cachedCloseOrders || [];
        }
        
        try {
            this.lastCloseOrdersQueryTime = now;
            const orders = await this.client.getOrders(this.config.symbol);
            if (!orders || !Array.isArray(orders)) {
                this.cachedCloseOrders = [];
                this.cachedCloseOrdersTime = now;
                return [];
            }
            
            // 筛选出平仓订单（reduceOnly = true 且状态为 pending 或 active）
            const closeOrders = orders.filter(order => {
                return order.reduceOnly === true && 
                       (order.status === 'pending' || order.status === 'active' || order.status === 'New');
            });
            
            // 更新缓存
            this.cachedCloseOrders = closeOrders;
            this.cachedCloseOrdersTime = now;
            
            this.log('DEBUG', '通过API查询平仓订单', {
                totalOrders: orders.length,
                closeOrdersCount: closeOrders.length,
                closeOrderDetails: closeOrders.map(o => ({
                    id: o.id,
                    side: o.side,
                    price: parseFloat(o.price).toFixed(1),
                    quantity: parseFloat(o.quantity).toFixed(4),
                    status: o.status,
                    reduceOnly: o.reduceOnly
                }))
            });
            
            return closeOrders;
        } catch (error) {
            this.log('ERROR', '查询平仓订单失败', {
                error: error.message
            });
            return this.cachedCloseOrders || [];
        }
    }
    
    /**
     * 清除平仓订单缓存并重置查询间隔
     */
    clearCloseOrdersCache() {
        this.cachedCloseOrders = null;
        this.cachedCloseOrdersTime = 0;
        this.lastCloseOrdersQueryTime = 0; // 重置查询间隔，允许立即查询
        this.log('DEBUG', '清除平仓订单缓存并重置查询间隔');
    }
    
    /**
     * 获取账户实际持仓信息
     * @returns {Promise<Object|null>} 持仓信息
     */
    async getActualPositionInfo() {
        try {
            const positions = await this.client.getPositions(this.config.symbol);
            
            if (positions && positions.length > 0) {
                for (const position of positions) {
                    const netQuantity = parseFloat(position.netQuantity);
                    const markPrice = parseFloat(position.markPrice);
                    const entryPrice = parseFloat(position.entryPrice);
                    const positionValue = Math.abs(netQuantity) * markPrice;
                    
                    if (positionValue > 0) {
                        return {
                            netQuantity: Math.abs(netQuantity), // 持仓数量（绝对值）
                            side: netQuantity > 0 ? 'long' : 'short', // 持仓方向
                            entryPrice, // 入仓价格
                            markPrice, // 标记价格
                            positionValue, // 持仓价值
                            unrealizedPnl: parseFloat(position.pnlUnrealized)
                        };
                    }
                }
            }
            
            return null; // 无持仓
        } catch (error) {
            this.log('WARN', '获取实际持仓信息失败');
            return null;
        }
    }
    
    /**
     * 下平仓单
     */
    async placeCloseOrder(entryOrderId, entrySide, entryPrice, quantity) {
        try {
            const symbol = this.config.symbol;
            const now = Date.now();
            
            // 防止重复创建，如果已经在创建过程中，直接返回
            if (this.isCreatingCloseOrder) {
                this.log('DEBUG', '已在创建平仓订单过程中，跳过重复调用', { entryOrderId });
                return null;
            }
            
            // 设置创建标志
            this.isCreatingCloseOrder = true;
            
            // 获取账户实际持仓信息
            const actualPosition = await this.getActualPositionInfo();
            
            if (!actualPosition || actualPosition.positionValue === 0) {
                this.log('WARN', '当前无持仓，跳过平仓单');
                return null;
            }
            
            // 通过API查询真实的平仓订单状态
            const existingCloseOrders = await this.getCloseOrdersFromAPI();
            
            if (existingCloseOrders.length > 0) {
                this.log('INFO', '发现现有平仓订单，取消后重新创建', { 
                    existingOrdersCount: existingCloseOrders.length,
                    existingOrders: existingCloseOrders.map(order => ({
                        id: order.id,
                        side: order.side,
                        price: parseFloat(order.price).toFixed(1),
                        quantity: parseFloat(order.quantity).toFixed(5),
                        status: order.status
                    }))
                });
                
                // 取消所有现有平仓订单
                for (const closeOrder of existingCloseOrders) {
                    try {
                        const cancelResult = await this.cancelOrder(closeOrder.id);
                        if (!cancelResult) {
                            this.log('WARN', '取消现有平仓订单失败，但继续处理', {
                                orderId: closeOrder.id,
                                orderStatus: closeOrder.status
                            });
                        }
                    } catch (error) {
                        this.log('ERROR', '取消现有平仓订单异常', {
                            orderId: closeOrder.id,
                            error: error.message,
                            orderStatus: closeOrder.status
                        });
                    }
                }
                
                // 等待一小段时间确保取消操作完成
                await this.sleep(500);
                
                // 清理本地记录
                this.closeOrders.clear();
            } else {
                this.log('INFO', '无现有平仓单，直接创建新平仓单');
            }
            
            // 基于实际持仓信息计算平仓价格
            const closePrice = await this.calculateClosePriceFromPosition(actualPosition);
            
            // 计算平仓方向（与实际持仓相反）
            // 如果是多头持仓(long)，需要卖出平仓(sell)
            // 如果是空头持仓(short)，需要买入平仓(buy)
            const closeSide = actualPosition.side === 'long' ? 'sell' : 'buy';
            
            // 转换side格式，符合内部处理逻辑
            const closeApiSide = closeSide === 'buy' ? 'Bid' : 'Ask';
            
            this.log('INFO', '准备下平仓单', {
                entryOrderId,
                actualPosition,
                closeSide,
                closeApiSide,
                orderType: 'Limit',
                closePrice,
                explanation: `实际持仓${actualPosition.side} ${actualPosition.netQuantity}，入仓价${actualPosition.entryPrice}，平仓价${closePrice}`
            });
            
            // 使用API返回的原始数量，并格式化为正确的精度
            const actualQuantity = Math.abs(actualPosition.netQuantity);
            
            // 获取市场精度信息来格式化数量
            let orderQuantity;
            try {
                const precisionInfo = await this.getMarketPrecision(this.config.symbol);
                orderQuantity = actualQuantity.toFixed(precisionInfo.quantityPrecision).replace(/\.?0+$/, '');
            } catch (error) {
                this.log('WARN', '获取数量精度失败，使用默认精度', { error: error.message });
                orderQuantity = actualQuantity.toFixed(5).replace(/\.?0+$/, '');
            }
            
            // 确保订单数量为正数
            if (actualQuantity <= 0) {
                this.log('WARN', '持仓数量无效，无法创建平仓订单', {
                    actualQuantity,
                    positionValue: actualPosition.positionValue
                });
                return null;
            }
            
            // 下平仓单（使用实际持仓数量，限价单，仅平仓）
            // 通过 placeOrder 方法，平仓订单会自动使用配置的 postOnly 设置
            this.log('DEBUG', '准备创建平仓订单', {
                closeSide,
                closePrice,
                quantity: orderQuantity,
                actualQuantity: actualQuantity,
                positionSide: actualPosition.side,
                positionValue: actualPosition.positionValue,
                entryPrice: actualPosition.entryPrice,
                currentPrice: actualPosition.currentPrice
            });
            
            const closeOrderData = await this.placeOrder(
                closeSide,             // 'buy' 或 'sell'
                closePrice,       // 价格
                orderQuantity,         // 使用处理后的数量
                5,                     // maxRetries
                true,                  // reduceOnly = true，仅平仓
                null,                  // postOnly = null，使用默认配置
                true                   // isCloseOrder = true，标识为平仓订单
            );
            
            this.log('DEBUG', '平仓订单创建结果', {
                closeOrderData: closeOrderData ? '成功' : '失败',
                orderId: closeOrderData ? closeOrderData.id : 'N/A'
            });
            
            if (closeOrderData) {
                // 将平仓订单记录到 closeOrders
                this.closeOrders.set(entryOrderId, {
                    ...closeOrderData,
                    entryOrderId,
                    entrySide,
                    entryPrice,
                    closeSide,
                    closePrice,
                    timestamp: Date.now(),
                    status: 'pending'
                });
                
                // 记录平仓单创建时间
                this.lastCloseOrderCreateTime.set(symbol, now);
                
                this.log('INFO', '平仓单创建成功', {
                    entryOrderId,
                    closeOrderId: closeOrderData.id,
                    closeSide,
                    closePrice,
                    quantity: orderQuantity,
                    actualQuantity: actualQuantity,
                    positionValue: actualPosition.positionValue,
                    reduceOnly: true,
                    postOnly: this.config.postOnly
                });
                
                // 记录到CSV
                this.logTrade({
                    symbol: this.config.symbol,
                    side: closeApiSide, // 直接使用 API side ('Bid' 或 'Ask')
                    orderType: 'Limit',
                    price: closePrice,
                    quantity: orderQuantity,
                    orderId: closeOrderData.id,
                    status: 'New',
                    notes: `平仓单 for ${entryOrderId}`
                });
                
                return closeOrderData;
            } else {
                throw new Error('平仓单创建失败：无返回数据');
            }
            
        } catch (error) {
            this.log('ERROR', '下平仓单失败', { 
                entryOrderId, 
                entrySide, 
                entryPrice, 
                quantity,
                error: error.message,
                stack: error.stack
            });
            // 不要抛出错误，继续运行
            return null;
        } finally {
            // 重置创建标志
            this.isCreatingCloseOrder = false;
        }
    }
    
    /**
     * 监控订单状态
     */
    async monitorOrders() {
        try {
            const orders = await this.client.getOrders(this.config.symbol);
            const currentOrderIds = new Set(orders.map(o => o.id));
            
            this.log('DEBUG', '监控订单状态', {
                totalOrders: orders.length,
                activeOrders: this.activeOrders.size,
                closeOrders: this.closeOrders.size,
                apiOrderIds: Array.from(currentOrderIds),
                activeOrderIds: Array.from(this.activeOrders.keys()),
                orders: orders.map(o => ({ id: o.id, status: o.status, side: o.side }))
            });
            
            // 检查已完成的开仓订单
            for (const [orderId, orderData] of this.activeOrders) {
                const currentOrder = orders.find(o => o.id === orderId);
                
                if (!currentOrderIds.has(orderId)) {
                    // 订单不在活跃列表中，可能已完成或取消
                    this.log('INFO', '订单不在活跃列表中，处理完成');
                    await this.handleEntryOrderCompletion(orderId, orderData);
                } else if (currentOrder) {
                    // 更新订单状态
                    const updatedOrderData = {
                        ...orderData,
                        ...currentOrder,
                        status: currentOrder.status
                    };
                    this.activeOrders.set(orderId, updatedOrderData);
                    
                    // 检查订单是否已成交（即使还在活跃列表中）
                    if (this.isOrderFilled(updatedOrderData)) {
                        this.log('INFO', '订单已成交，处理完成');
                        await this.handleEntryOrderCompletion(orderId, updatedOrderData);
                    }
                }
            }
            
            // 检查已完成的平仓订单
            for (const [entryOrderId, closeOrderData] of this.closeOrders) {
                if (!currentOrderIds.has(closeOrderData.id)) {
                    // 平仓订单已完成或取消
                    await this.handleCloseOrderCompletion(entryOrderId, closeOrderData);
                } else {
                    // 更新平仓订单状态
                    const currentOrder = orders.find(o => o.id === closeOrderData.id);
                    if (currentOrder) {
                        this.closeOrders.set(entryOrderId, {
                            ...closeOrderData,
                            ...currentOrder,
                            status: currentOrder.status.toLowerCase()
                        });
                    }
                }
            }
            
            this.log('DEBUG', '订单监控完成', { 
                activeOrders: this.activeOrders.size,
                closeOrders: this.closeOrders.size,
                totalOrders: orders.length 
            });
            
        } catch (error) {
            this.log('ERROR', '监控订单失败');
        }
    }
    
    /**
     * 处理开仓订单完成
     */
    async handleEntryOrderCompletion(orderId, orderData) {
        try {
            this.log('INFO', '开仓订单完成');
            
            // 只有成交的订单才更新持仓
            this.log('DEBUG', '检查订单是否成交', {
                orderId,
                status: orderData.status,
                filledQuantity: orderData.filledQuantity,
                isFilled: this.isOrderFilled(orderData)
            });
            
            if (this.isOrderFilled(orderData)) {
                // 使用实际成交数量，而不是订单数量
                const executedQty = parseFloat(orderData.executedQuantity) || parseFloat(orderData.quantity);
                const side = orderData.internalSide || (orderData.side === 'Bid' ? 'buy' : 'sell');
                const price = parseFloat(orderData.price);
                const entryTime = orderData.timestamp || Date.now();
                
                // 记录成交价格和方向
                recordTradePrice(price, side);
                
                // 记录最后一个成交订单的时间
                this.lastFilledOrderTime = entryTime;
                
                // 记录开仓时间
                recordPositionEntry(entryTime);
                
                // 记录开仓交易历史（已通过全局函数记录开仓时间）
                const quantity = parseFloat(orderData.executedQuantity) || parseFloat(orderData.quantity);
                console.log(`✅ 开仓交易记录: ${this.config.symbol} - ${orderId} - ${side} - ${quantity}@${price}`);
                
                this.log('INFO', '订单成交，更新持仓', {
                    orderId,
                    side,
                    orderQuantity: orderData.quantity,
                    executedQuantity: orderData.executedQuantity,
                    actualQuantity: executedQty,
                    price,
                    currentPosition: this.currentPosition,
                    lastTradeRecorded: `${side} at ${formatPriceWithGlobalPrecision(price)}`,
                    tradeHistoryRecorded: true
                });
                this.updatePosition(side, executedQty, price, false);
                
                // 注意：这里暂时无法直接获取持仓价值，将在checkPositionAndUpdateCloseOrders中更新
            } else {
                // 订单没有成交，检查持仓金额变化
                const currentPosition = await this.getActualPositionInfo();
                const currentPositionValue = currentPosition ? currentPosition.positionValue : 0;
                
                // 计算期望的持仓金额增加（ORDER_AMOUNT的90%）
                const expectedIncrease = this.config.orderAmount * 0.9;
                const actualIncrease = currentPositionValue - this.lastPositionValueBeforeOrder;
                
                this.log('INFO', '订单未成交，检查持仓金额变化', {
                    orderId,
                    status: orderData.status,
                    lastPositionValue: this.lastPositionValueBeforeOrder,
                    currentPositionValue,
                    actualIncrease,
                    expectedIncrease,
                    orderAmount: this.config.orderAmount,
                    thresholdPercentage: '90%'
                });
                
                // 如果持仓金额增加没有达到ORDER_AMOUNT的90%，立即下新单
                if (actualIncrease < expectedIncrease) {
                    this.log('INFO', '持仓金额增加不足，立即下新单', {
                        orderId,
                        actualIncrease,
                        expectedIncrease,
                        difference: expectedIncrease - actualIncrease,
                        reason: '持仓金额增加未达到ORDER_AMOUNT的90%'
                    });
                    
                    // 清理订单记录
                    this.activeOrders.delete(orderId);
                    this.orderCreateTimes.delete(orderId);
                    
                    // 立即下新单，不等待
                    setTimeout(async () => {
                        try {
                            await this.placeNewOrder();
                        } catch (error) {
                            this.log('ERROR', '立即下单失败', { error: error.message });
                        }
                    }, 100); // 短暂延迟100ms确保状态更新完成
                    
                    return; // 提前返回，不执行后续的平仓单逻辑
                } else {
                    this.log('INFO', '持仓金额增加足够，订单可能已有效成交', {
                        orderId,
                        actualIncrease,
                        expectedIncrease,
                        reason: '持仓金额增加达到或超过ORDER_AMOUNT的90%'
                    });
                    
                    // 记录开仓交易历史（通过持仓变化检测到的成交，使用新的交易历史管理器）
                    const entryTime = orderData.timestamp || Date.now();
                    const price = parseFloat(orderData.price);
                    const side = orderData.internalSide || (orderData.side === 'Bid' ? 'buy' : 'sell');
                    const quantity = parseFloat(orderData.executedQuantity) || parseFloat(orderData.quantity);
                    
                    // 记录成交价格和方向
                    recordTradePrice(price, side);
                    
                    // 记录最后一个成交订单的时间
                    this.lastFilledOrderTime = entryTime;
                    
                    // 记录开仓交易历史
                    tradeHistoryManager.recordEntry(
                        this.config.symbol,
                        orderId,
                        entryTime,
                        price,
                        side,
                        quantity
                    );
                }
            }
            
            // 计算盈亏
            const profit = await this.calculateProfit(orderData);
            
            // 无论盈亏都下平仓单，平仓价格始终为盈利目标价
            this.log('INFO', '开仓订单完成，准备下平仓单', { 
                orderId, 
                profit, 
                profitTarget: this.config.profitTarget,
                newPosition: this.currentPosition
            });

            // 记录交易
            this.logTrade({
                ...orderData,
                status: 'Filled',
                profit: profit.toFixed(4),
                notes: `Entry completed (Target: ${this.config.profitTarget})`
            });

            // 下平仓单，平仓价格始终为盈利目标价
            try {
                const side = orderData.internalSide || (orderData.side === 'Bid' ? 'buy' : 'sell');
                const executedQty = parseFloat(orderData.executedQuantity) || parseFloat(orderData.quantity);
                this.log('DEBUG', '准备下平仓单（平仓价）', {
                    orderId,
                    side,
                    orderPrice: orderData.price,
                    executedQty,
                    currentPosition: this.currentPosition
                });
                await this.placeCloseOrder(orderId, side, parseFloat(orderData.price), executedQty);
            } catch (error) {
                this.log('ERROR', '下平仓单失败', {
                    orderId,
                    error: error.message,
                    stack: error.stack
                });
            }

            this.activeOrders.delete(orderId);
            this.orderCreateTimes.delete(orderId); // 清理订单创建时间记录
            
        } catch (error) {
            this.log('ERROR', '处理开仓订单完成失败');
        }
    }
    
    /**
     * 处理平仓订单完成
     */
    async handleCloseOrderCompletion(entryOrderId, closeOrderData) {
        try {
            // 检查是否已经处理过这个平仓订单，避免重复处理
            const closeOrderKey = `${entryOrderId}_${closeOrderData.id}`;
            if (this.processedCloseOrders && this.processedCloseOrders.has(closeOrderKey)) {
                return;
            }
            
            // 记录已处理的平仓订单
            if (!this.processedCloseOrders) {
                this.processedCloseOrders = new Set();
            }
            this.processedCloseOrders.add(closeOrderKey);
            
            this.log('INFO', '新建平仓订单完成', { 
                entryOrderId, 
                closeOrderId: closeOrderData.id, 
                status: closeOrderData.status 
            });
            
            console.log(`=== 平仓订单完成处理开始 ===`);
            console.log(`entryOrderId: ${entryOrderId}`);
            console.log(`closeOrderId: ${closeOrderData.id}`);
            console.log(`status: ${closeOrderData.status}`);
            console.log(`isOrderFilled: ${this.isOrderFilled(closeOrderData)}`);
            console.log(`=== 平仓订单完成处理开始 ===`);
            
            // 只有成交的平仓订单才更新持仓
            if (this.isOrderFilled(closeOrderData)) {
                // 使用实际成交数量
                const executedQty = parseFloat(closeOrderData.executedQuantity) || parseFloat(closeOrderData.quantity);
                const closeSide = closeOrderData.side === 'Bid' ? 'buy' : 'sell';
                const closePrice = parseFloat(closeOrderData.price);
                const closeTime = closeOrderData.timestamp || Date.now();
                
                // 记录成交价格和方向
                recordTradePrice(closePrice, closeSide);
                
                // 记录最后一个成交订单的时间
                this.lastFilledOrderTime = closeTime;
                
                this.log('INFO', '平仓订单成交，更新持仓', {
                    closeOrderId: closeOrderData.id,
                    closeSide,
                    orderQuantity: closeOrderData.quantity,
                    executedQuantity: closeOrderData.executedQuantity,
                    actualQuantity: executedQty,
                    closePrice,
                    currentPosition: this.currentPosition,
                    lastTradeRecorded: `${closeSide} at ${formatPriceWithGlobalPrecision(closePrice)}`
                });
                this.updatePosition(closeSide, executedQty, closePrice, true);
            }
            
            // 计算实际盈利
            const entryOrder = this.activeOrders.get(entryOrderId);
            if (entryOrder) {
                const actualProfit = await this.calculateActualProfit(entryOrder, closeOrderData);
                
                console.log(`=== 平仓盈利计算 ===`);
                console.log(`entryOrderId: ${entryOrderId}`);
                console.log(`closeOrderId: ${closeOrderData.id}`);
                console.log(`actualProfit: ${actualProfit}`);
                console.log(`actualProfit > 0: ${actualProfit > 0}`);
                console.log(`=== 平仓盈利计算完成 ===`);
                
                // 无论盈亏都记录交易历史（用于下一笔开仓时的金额调整）
                const entryTime = entryOrder.timestamp || Date.now();
                const closeTime = Date.now();
                const duration = closeTime - entryTime;
                
                // 记录平仓交易历史（已通过全局函数记录平仓时间）
                const closePrice = parseFloat(closeOrderData.price);
                
                console.log(`✅ 平仓交易记录: ${this.config.symbol} - ${entryOrderId} -> ${closeOrderData.id} - 盈利: ${actualProfit.toFixed(4)}`);
                
                // 清空成交价格记录（持仓平仓成功）
                clearTradePrice();
                
                // 记录平仓时间（无论盈亏）
                recordPositionClose(closeTime);
                
                if (actualProfit > 0) {
                    this.stats.successfulOrders++;
                    this.stats.totalProfit += actualProfit;
                    
                    this.log('INFO', '平仓成功', { 
                        entryOrderId, 
                        closeOrderId: closeOrderData.id,
                        actualProfit,
                        newPosition: this.currentPosition,
                        tradePriceCleared: true,
                        tradeDuration: `${(duration / 1000).toFixed(1)}秒`,
                        tradeDurationMinutes: (duration / (1000 * 60)).toFixed(2)
                    });
                    
                    // 记录平仓交易
                    this.logTrade({
                        ...closeOrderData,
                        status: 'Filled',
                        profit: actualProfit.toFixed(4),
                        notes: `平仓成功 (Entry: ${entryOrderId})`
                    });
                    
                    // 平仓后立即下新单
                    this.log('INFO', '平仓成功，立即开新单', { 
                        entryOrderId, 
                        actualProfit,
                        newPosition: this.currentPosition
                    });
                    await this.placeNewOrder();
                } else {
                    this.log('INFO', '平仓亏损，但已记录交易历史', { 
                        entryOrderId, 
                        closeOrderId: closeOrderData.id,
                        actualProfit,
                        newPosition: this.currentPosition,
                        tradeHistoryRecorded: true
                    });
                    
                    // 记录未盈利交易
                    this.logTrade({
                        ...closeOrderData,
                        status: 'Filled',
                        profit: actualProfit.toFixed(4),
                        notes: `平仓无盈利 (Entry: ${entryOrderId})`
                    });
                    
                    // 等待后下新单
                    setTimeout(async () => {
                        try {
                            await this.placeNewOrder();
                        } catch (error) {
                            this.log('ERROR', '延迟下单失败', { error: error.message });
                        }
                    }, this.config.orderWaitTime * 1000);
                }
            }
            
            // 只有成交的平仓订单才从closeOrders中删除
            if (this.isOrderFilled(closeOrderData)) {
                this.closeOrders.delete(entryOrderId);
                this.log('INFO', '平仓订单已成交，从跟踪列表中移除', {
                    entryOrderId,
                    closeOrderId: closeOrderData.id
                });
            } else {
                this.log('DEBUG', '平仓订单状态变化，继续跟踪', {
                    entryOrderId,
                    closeOrderId: closeOrderData.id,
                    status: closeOrderData.status
                });
            }
            
        } catch (error) {
            this.log('ERROR', '处理平仓订单完成失败', { entryOrderId, error: error.message });
        }
    }
    
    /**
     * 处理订单完成（保留原函数以兼容）
     */
    async handleOrderCompletion(orderId, orderData) {
        try {
            this.log('INFO', '订单完成');
            
            // 计算盈亏
            const profit = await this.calculateProfit(orderData);
            
            // 3. 平仓单：计算当前持仓的盈利扣除手续费后是否达到平仓标准
            if (profit >= this.config.profitTarget) {
                this.stats.successfulOrders++;
                this.stats.totalProfit += profit;
                this.log('INFO', '订单达到平仓标准', { 
                    orderId, 
                    profit, 
                    profitTarget: this.config.profitTarget,
                    isProfitable: true
                });
                
                // 记录盈利交易
                this.logTrade({
                    ...orderData,
                    status: 'Filled',
                    profit: profit.toFixed(4),
                    notes: `Profitable (Target: ${this.config.profitTarget})`
                });
                
                // 2. 平仓后马上下一单
                this.log('INFO', '订单达到平仓标准，立即开新单', { 
                    orderId, 
                    profit, 
                    profitTarget: this.config.profitTarget 
                });
                await this.placeNewOrder();
            } else {
                this.log('INFO', '订单未达到平仓标准');
                
                // 记录未盈利交易
                this.logTrade({
                    ...orderData,
                    status: 'Filled',
                    profit: profit.toFixed(4),
                    notes: `No profit (Target: ${this.config.profitTarget})`
                });
                
                // 未达到平仓标准时等待指定时间后开新单
                this.log('INFO', `订单未达到平仓标准，等待 ${this.config.orderWaitTime} 秒后开新单`);
                
                setTimeout(async () => {
                    try {
                        await this.placeNewOrder();
                    } catch (error) {
                        this.log('ERROR', '延迟下单失败', { error: error.message });
                    }
                }, this.config.orderWaitTime * 1000);
            }
            
            this.activeOrders.delete(orderId);
            this.orderCreateTimes.delete(orderId); // 清理订单创建时间记录
            
        } catch (error) {
            this.log('ERROR', '处理订单完成失败', { orderId, error: error.message });
        }
    }
    
    /**
     * 计算实际盈利 - 基于开仓和平仓价格
     */
    async calculateActualProfit(entryOrder, closeOrder) {
        try {
            const entryPrice = parseFloat(entryOrder.price);
            const closePrice = parseFloat(closeOrder.price);
            const quantity = parseFloat(entryOrder.quantity);
            const entrySide = entryOrder.side;
            
            // 计算手续费
            const entryFee = entryPrice * quantity * this.config.makerFee;
            const closeFee = closePrice * quantity * this.config.makerFee;
            const totalFee = entryFee + closeFee;
            
            let actualProfit = 0;
            
            if (entrySide === 'buy') {
                // 买单：平仓价格 - 开仓价格 - 手续费
                actualProfit = (closePrice - entryPrice) * quantity - totalFee;
            } else {
                // 卖单：开仓价格 - 平仓价格 - 手续费
                actualProfit = (entryPrice - closePrice) * quantity - totalFee;
            }
            
            this.log('DEBUG', '计算实际盈利', {
                entryOrderId: entryOrder.id,
                closeOrderId: closeOrder.id,
                entrySide,
                entryPrice,
                closePrice,
                quantity,
                entryFee: entryFee.toFixed(6),
                closeFee: closeFee.toFixed(6),
                totalFee: totalFee.toFixed(6),
                actualProfit: actualProfit.toFixed(6)
            });
            
            return actualProfit;
            
        } catch (error) {
            this.log('ERROR', '计算实际盈利失败', { 
                entryOrderId: entryOrder.id, 
                closeOrderId: closeOrder.id,
                error: error.message 
            });
            return 0;
        }
    }
    
    /**
     * 计算订单盈亏 - 基于实际持仓盈利扣除手续费
     */
    async calculateProfit(orderData) {
        try {
            const quantity = parseFloat(orderData.quantity);
            const price = parseFloat(orderData.price);
            const side = orderData.side;
            
            // 计算手续费（限价单使用maker fee）
            const fee = price * quantity * this.config.makerFee;
            
            // 获取当前市场价格来计算实际盈亏
            const { bid, ask } = await this.getCurrentPrice();
            
            let actualProfit = 0;
            
            if (side === 'buy') {
                // 买单：当前卖价 - 买入价 - 手续费
                // 如果当前卖价高于买入价，说明可以盈利
                actualProfit = (ask - price) * quantity - fee;
            } else {
                // 卖单：卖出价 - 当前买价 - 手续费
                // 如果当前买价低于卖出价，说明可以盈利
                actualProfit = (price - bid) * quantity - fee;
            }
            
            this.log('DEBUG', '计算订单盈亏', {
                orderId: orderData.id,
                side,
                quantity,
                price,
                currentBid: bid,
                currentAsk: ask,
                fee: fee.toFixed(6),
                actualProfit: actualProfit.toFixed(6),
                profitTarget: this.config.profitTarget,
                isProfitable: actualProfit >= this.config.profitTarget
            });
            
            return actualProfit;
            
        } catch (error) {
            this.log('ERROR', '计算订单盈亏失败', { 
                orderId: orderData.id, 
                error: error.message 
            });
            return 0;
        }
    }
    
    /**
     * 检查价格是否在允许的挂单区间内
     * 优先顺序：
     * 1. 超出价格区间，拒绝
     * 2. 最后一个成交订单时间超过等待时间，允许下单（即使价格超出区间）
     * 3. 等待时间内，拒绝
     * 
     * @param {number} price - 要检查的价格
     * @param {boolean} checkWaitTime - 是否检查等待时间（如果超过等待时间则允许下单）
     * @returns {boolean} 是否在允许区间内
     */
    isPriceInAllowedRange(price, checkWaitTime = true) {
        const priceNum = parseFloat(price);
        
        // 如果没有配置价格限制，则允许所有价格
        if (this.config.minOrderPrice === null && this.config.maxOrderPrice === null) {
            return true;
        }
        
        let priceOutOfRange = false;
        let priceLimitReason = '';
        
        // 检查最小价格限制
        if (this.config.minOrderPrice !== null && priceNum < this.config.minOrderPrice) {
            priceOutOfRange = true;
            priceLimitReason = `价格低于最小可挂单价格 (${priceNum.toFixed(1)} < ${this.config.minOrderPrice.toFixed(1)})`;
        }
        
        // 检查最大价格限制
        if (this.config.maxOrderPrice !== null && priceNum > this.config.maxOrderPrice) {
            priceOutOfRange = true;
            priceLimitReason = `价格高于最大可挂单价格 (${priceNum.toFixed(1)} > ${this.config.maxOrderPrice.toFixed(1)})`;
        }
        
        // 优先顺序1：如果价格在区间内，直接返回true（不检查等待时间）
        if (!priceOutOfRange) {
            return true;
        }
        
        // 优先顺序2和3：价格超出区间，检查等待时间
        if (!checkWaitTime) {
            // 不检查等待时间，直接拒绝
            this.log('INFO', priceLimitReason + '，禁止开仓', {
                price: priceNum.toFixed(1),
                minOrderPrice: this.config.minOrderPrice ? this.config.minOrderPrice.toFixed(1) : '无限制',
                maxOrderPrice: this.config.maxOrderPrice ? this.config.maxOrderPrice.toFixed(1) : '无限制',
                checkWaitTime: false
            });
            return false;
        }
        
        // 检查是否有上一个成交订单记录
        if (this.lastFilledOrderTime <= 0) {
            // 没有上一个成交订单记录，拒绝下单
            this.log('INFO', priceLimitReason + '，且没有上一个成交订单记录，禁止开仓', {
                price: priceNum.toFixed(1),
                minOrderPrice: this.config.minOrderPrice ? this.config.minOrderPrice.toFixed(1) : '无限制',
                maxOrderPrice: this.config.maxOrderPrice ? this.config.maxOrderPrice.toFixed(1) : '无限制',
                hasLastFilledOrderTime: false
            });
            return false;
        }
        
        // 计算距离上一个成交订单的时间
        const now = Date.now();
        const timeSinceLastFilled = now - this.lastFilledOrderTime;
        const waitTime = this.config.orderWaitTime * 1000; // 转换为毫秒
        
        // 优先顺序2：如果上一个成交订单已经超过ORDER_WAIT_TIME，允许下单（即使价格超出区间）
        if (timeSinceLastFilled >= waitTime) {
            this.log('INFO', '价格超出允许区间，但上一个成交订单已超过等待时间，允许下单', {
                price: priceNum.toFixed(1),
                minOrderPrice: this.config.minOrderPrice ? this.config.minOrderPrice.toFixed(1) : '无限制',
                maxOrderPrice: this.config.maxOrderPrice ? this.config.maxOrderPrice.toFixed(1) : '无限制',
                lastFilledOrderTime: new Date(this.lastFilledOrderTime).toLocaleString(),
                timeSinceLastFilled: Math.ceil(timeSinceLastFilled / 1000) + '秒',
                waitTime: this.config.orderWaitTime + '秒',
                reason: priceLimitReason
            });
            return true; // 超过等待时间，允许下单
        }
        
        // 优先顺序3：等待时间内，拒绝下单
        const remainingTime = Math.ceil((waitTime - timeSinceLastFilled) / 1000);
        this.log('INFO', '价格超出允许区间，且上一个成交订单未超过等待时间，禁止开仓', {
            price: priceNum.toFixed(1),
            minOrderPrice: this.config.minOrderPrice ? this.config.minOrderPrice.toFixed(1) : '无限制',
            maxOrderPrice: this.config.maxOrderPrice ? this.config.maxOrderPrice.toFixed(1) : '无限制',
            lastFilledOrderTime: new Date(this.lastFilledOrderTime).toLocaleString(),
            timeSinceLastFilled: Math.ceil(timeSinceLastFilled / 1000) + '秒',
            waitTime: this.config.orderWaitTime + '秒',
            remainingTime: remainingTime + '秒',
            reason: priceLimitReason
        });
        return false;
    }

    /**
     * 下新单
     */
    async placeNewOrder() {
        // 防止重复调用
        if (this.isProcessingOrder) {
            this.log('DEBUG', '正在处理订单中，跳过重复调用');
            return;
        }
        
        this.isProcessingOrder = true;
        
        try {
            // 获取市场价格
            const { bid, ask } = await this.getCurrentPrice();

            // 获取实际持仓信息
            const currentPosition = await this.getActualPositionInfo();
            const isNewPosition = !currentPosition || currentPosition.positionValue === 0;
            
            // 计算订单参数 - 直接使用买1或卖1价格
            const side = this.config.tradeDirection;
            const price = this.calculateOrderPrice(bid, ask, side);
            
            // 检查价格是否在允许的挂单区间内（只对开仓订单检查）
            // 如果价格超出区间，但上一个成交订单已超过ORDER_WAIT_TIME，则允许下单
            if (!this.isPriceInAllowedRange(price, true)) {
                // isPriceInAllowedRange 内部已经记录了详细的日志，这里直接返回
                return;
            }
            
            // 根据是否为开仓调整订单金额
            let quantity;
            if (isNewPosition) {
                // 从无到有的开仓，先通过API获取持仓历史
                this.log('DEBUG', '检测到开仓机会，获取持仓历史', {
                    positionValue: currentPosition ? currentPosition.positionValue : 0,
                    isNewPosition: true
                });
                
                // 通过API获取最近1次完整的持仓历史
                const positionHistory = await fetchLastPositionFromAPI(this.config.symbol, this.client, this.config.tradeDirection);
                if (positionHistory) {
                    // 更新全局持仓时间记录
                    recordPositionEntry(positionHistory.entryTime);
                    recordPositionClose(positionHistory.closeTime);
                    console.log(`✅ 已更新持仓历史记录`);
                } else {
                    console.log(`⚠️ 未找到持仓历史，将使用默认倍数`);
                }
                
                quantity = await this.calculateOrderQuantityWithPrecision(price);
            } else {
                // 已有持仓，使用基础金额
                // this.log('INFO', '已有持仓，使用基础金额', {
                //     positionValue: currentPosition.positionValue,
                //     isNewPosition: false
                // });
                quantity = await this.calculateOrderQuantityWithPrecision(price, true); // 传入true表示使用基础金额
            }

            // 转换side格式
            const apiSide = side === 'buy' ? 'Bid' : 'Ask';

            // 检查价格差异控制 - 只有在有持仓时才检查与上一笔同方向交易的价差
            if (currentPosition && currentPosition.positionValue > 0) {
                const lastTradeInfo = getLastTradeInfo();
                if (lastTradeInfo.price && lastTradeInfo.side === side) {
                    const lastPrice = lastTradeInfo.price;
                    const newOrderPrice = parseFloat(price);
                    
                    // 获取动态配置
                    const { priceDifferenceMultiplier } = this.getDynamicConfig();
                    const minDifference = (this.config.minPriceDifference * priceDifferenceMultiplier) / 100; // 转换为小数
                    
                    // 计算价格差异百分比
                    const priceDifferencePercent = Math.abs(newOrderPrice - lastPrice) / lastPrice;
                    
                    if (side === 'buy') {
                        // 买单：新价格需要比上一笔买单价格至少低 minPriceDifference%
                        const requiredPrice = lastPrice * (1 - minDifference);
                        if (newOrderPrice > requiredPrice) {
                            this.log('INFO', '新买单价格价差不足，跳过下单', {
                                lastTradePrice: formatPriceWithGlobalPrecision(lastPrice),
                                newOrderPrice: formatPriceWithGlobalPrecision(newOrderPrice),
                                requiredPrice: formatPriceWithGlobalPrecision(requiredPrice),
                                priceDifferencePercent: (priceDifferencePercent * 100).toFixed(3) + '%',
                                minRequiredDifference: this.config.minPriceDifference + '%',
                                reason: `买单价格需要比上一笔买单价格低至少${this.config.minPriceDifference}%`
                            });
                            return;
                        }
                    }
                    
                    if (side === 'sell') {
                        // 卖单：新价格需要比上一笔卖单价格至少高 minPriceDifference%
                        const requiredPrice = lastPrice * (1 + minDifference);
                        if (newOrderPrice < requiredPrice) {
                            this.log('INFO', '新卖单价格价差不足，跳过下单', {
                                lastTradePrice: formatPriceWithGlobalPrecision(lastPrice),
                                newOrderPrice: formatPriceWithGlobalPrecision(newOrderPrice),
                                requiredPrice: formatPriceWithGlobalPrecision(requiredPrice),
                                priceDifferencePercent: (priceDifferencePercent * 100).toFixed(3) + '%',
                                minRequiredDifference: this.config.minPriceDifference + '%',
                                reason: `卖单价格需要比上一笔卖单价格高至少${this.config.minPriceDifference}%`
                            });
                            return;
                        }
                    }
                    
                    this.log('DEBUG', '新订单价格检查通过', {
                        lastTradePrice: formatPriceWithGlobalPrecision(lastPrice),
                        newOrderPrice: formatPriceWithGlobalPrecision(newOrderPrice),
                        side,
                        priceDifference: side === 'buy' ? 
                            formatPriceWithGlobalPrecision(newOrderPrice - lastPrice) : 
                            formatPriceWithGlobalPrecision(lastPrice - newOrderPrice)
                    });
                } else {
                    this.log('DEBUG', '没有同方向的历史交易价格，跳过价格差异检查', {
                        hasLastTradePrice: !!lastTradeInfo.price,
                        lastTradeSide: lastTradeInfo.side,
                        currentSide: side,
                        positionValue: currentPosition.positionValue
                    });
                }
            } else {
                this.log('DEBUG', '无持仓状态，跳过价格差异检查', {
                    hasPosition: !!(currentPosition && currentPosition.positionValue > 0),
                    positionValue: currentPosition ? currentPosition.positionValue : 0
                });
            }
            
            // 检查是否达到单币种持仓最大金额限制
            if (currentPosition && currentPosition.positionValue > 0) {
                // 检查当前持仓价值是否已达到限制
                if (currentPosition.positionValue >= this.config.maxPositionValue) {
                    this.log('INFO', '已达到单币种持仓最大金额限制', {
                        currentPositionValue: currentPosition.positionValue.toFixed(2),
                        maxPositionValue: this.config.maxPositionValue,
                        symbol: this.config.symbol,
                        unit: 'USDC'
                    });
                    return;
                }
                
                // 检查新订单是否会超过限制
                const newOrderValue = this.config.orderAmount;
                const projectedPositionValue = currentPosition.positionValue + newOrderValue;
                
                if (projectedPositionValue > this.config.maxPositionValue) {
                    // this.log('INFO', '新订单将超过持仓金额限制，跳过下单', {
                    //     currentPositionValue: currentPosition.positionValue.toFixed(2),
                    //     newOrderValue,
                    //     projectedPositionValue: projectedPositionValue.toFixed(2),
                    //     maxPositionValue: this.config.maxPositionValue,
                    //     symbol: this.config.symbol,
                    //     unit: 'USDC'
                    // });
                    return;
                }
            }
            
            // 检查订单间等待时间
            const now = Date.now();
            const timeSinceLastOrder = now - this.lastOrderTime;
            const waitTime = this.config.orderWaitTime * 1000; // 转换为毫秒

            // 检查是否已有pending订单（只允许一个pending订单）
            if (this.activeOrders.size >= 1) {
                // 只允许有一个活跃订单，检查价格是否相同
                let needPlaceNewOrder = true;
                for (const [orderId, orderData] of this.activeOrders) {
                    // 只比较方向和价格
                    const orderSide = orderData.internalSide || (orderData.side === 'Bid' ? 'buy' : 'sell');
                    const orderPrice = parseFloat(orderData.price);
                    if (orderSide === side && Math.abs(orderPrice - price) < 0.0000001) {
                        // 价格和方向都一样，不需要重新下单
                        this.log('INFO', '已有相同价格的活跃订单，无需重新下单', {
                            orderId,
                            side,
                            price,
                            orderPrice
                        });
                        needPlaceNewOrder = false;
                        break;
                    }
                }
                if (!needPlaceNewOrder) {
                    return;
                }

                this.log('INFO', '已有活跃订单，取消后再下新单', { 
                    activeOrders: this.activeOrders.size
                });

                // 取消所有现有的活跃订单
                for (const [orderId, orderData] of this.activeOrders) {
                    this.log('INFO', '取消现有活跃订单');
                    await this.cancelOrder(orderId);
                }

                // 清理活跃订单记录
                this.activeOrders.clear();

                // 等待一小段时间确保取消操作完成
                await this.sleep(5);
            }

            // 检查订单间等待时间（只有在有持仓时才检查）
            const actualPosition = await this.getActualPositionInfo();
            const hasPosition = actualPosition && actualPosition.positionValue > 0;
            
            if (hasPosition && timeSinceLastOrder < waitTime) {
                const remainingTime = Math.ceil((waitTime - timeSinceLastOrder) / 1000);
                this.log(
                    'INFO',
                    `有持仓且订单间等待时间未到，跳过下单（距可下单还有${remainingTime}秒）`,
                    { 
                        timeSinceLastOrder: Math.ceil(timeSinceLastOrder / 1000),
                        waitTime: this.config.orderWaitTime,
                        remainingTime,
                        activeOrders: this.activeOrders.size,
                        positionValue: actualPosition.positionValue
                    }
                );
                return;
            } else if (!hasPosition) {
                this.log('INFO', '无持仓状态，忽略等待时间限制，立即下单', {
                    timeSinceLastOrder: Math.ceil(timeSinceLastOrder / 1000),
                    waitTime: this.config.orderWaitTime,
                    activeOrders: this.activeOrders.size
                });
            }

            // this.log('INFO', '准备下新单', { 
            //     side, 
            //     apiSide,
            //     price, 
            //     quantity, 
            //     bid, 
            //     ask,
            //     activeOrders: this.activeOrders.size,
            //     timeSinceLastOrder: Math.ceil(timeSinceLastOrder / 1000),
            //     skipWaitTime
            // });

            // 记录下单前的持仓金额，用于后续判断订单是否有效成交
            const positionBeforeOrder = await this.getActualPositionInfo();
            this.lastPositionValueBeforeOrder = positionBeforeOrder ? positionBeforeOrder.positionValue : 0;
            
            this.log('DEBUG', '记录下单前持仓金额', {
                lastPositionValueBeforeOrder: this.lastPositionValueBeforeOrder,
                orderAmount: this.config.orderAmount,
                expectedIncrease: this.config.orderAmount * 0.9
            });

            // 下单
            await this.placeOrder(side, price, quantity);

            // 更新上次下单时间
            this.lastOrderTime = now;

            // 下单成功后，立即检查并调整平仓单
            await this.checkPositionAndUpdateCloseOrders();

        } catch (error) {
            this.log('ERROR', '下新单失败', { error: error.message });
        } finally {
            this.isProcessingOrder = false;
        }
    }
    
    /**
     * 风险管理：取消超时订单
     */
    async riskManagement() {
        const now = Date.now();
        const timeout = 5 * 60 * 1000; // 5分钟超时
        
        for (const [orderId, orderData] of this.activeOrders) {
            if (now - orderData.timestamp > timeout) {
                this.log('WARN', '订单超时，准备取消', { orderId, age: now - orderData.timestamp });
                await this.cancelOrder(orderId);
            }
        }
    }
    
    /**
     * 打印账户持仓统计信息
     */
    async printStats() {
        // 检查是否到了显示统计的时间（每分钟一次）
        const now = Date.now();
        if (!this.lastStatsTime) {
            this.lastStatsTime = now;
        }
        
        if (now - this.lastStatsTime < 60000) { // 60秒 = 1分钟
            return; // 还没到显示时间
        }
        
        this.lastStatsTime = now;
        
        const runtime = this.stats.startTime ? now - this.stats.startTime : 0;
        const runtimeHours = Math.floor(runtime / (1000 * 60 * 60));
        const runtimeMinutes = Math.floor((runtime % (1000 * 60 * 60)) / (1000 * 60));
        
        // 清屏效果（打印一些空行）
        console.log('\n'.repeat(2));
        console.log('┌───────────────────────────────────────────────┐');
        console.log('│              💰 持仓统计信息                    │');
        console.log('├───────────────────────────────────────────────┤');
        console.log(`│ 🕒 运行时间: ${runtimeHours.toString().padStart(2, '0')}:${runtimeMinutes.toString().padStart(2, '0')}                          │`);
        
        try {
            // 查询实际的账户持仓
            const positions = await this.client.getPositions(this.config.symbol);
            
            if (positions && positions.length > 0) {
                for (const position of positions) {
                    const netQuantity = parseFloat(position.netQuantity);
                    const entryPrice = parseFloat(position.entryPrice);
                    const markPrice = parseFloat(position.markPrice);
                    const unrealizedPnl = parseFloat(position.pnlUnrealized);
                    const realizedPnl = parseFloat(position.pnlRealized);
                    const totalPnl = unrealizedPnl + realizedPnl;
                    const positionValue = Math.abs(netQuantity) * markPrice;
                    const positionSide = netQuantity > 0 ? 'LONG' : netQuantity < 0 ? 'SHORT' : 'FLAT';
                    
                    // 获取平仓订单详细信息（强制获取最新数据，不受查询间隔限制）
                    let closeOrderInfo = '无平仓订单';
                    let totalCloseOrderValue = 0;
                    try {
                        // 强制清除缓存，获取最新数据
                        this.clearCloseOrdersCache();
                        const closeOrders = await this.getCloseOrdersFromAPI();
                        
                        this.log('DEBUG', '持仓统计中查询平仓订单', {
                            totalCloseOrders: closeOrders.length,
                            positionSide,
                            oppositeSide: positionSide === 'LONG' ? 'sell' : 'buy',
                            allOrders: closeOrders.map(order => {
                                const apiSideToStandard = { 'Bid': 'buy', 'Ask': 'sell' };
                                const standardSide = apiSideToStandard[order.side] || order.side;
                                return {
                                    id: order.id,
                                    apiSide: order.side,
                                    standardSide: standardSide,
                                    status: order.status,
                                    price: parseFloat(order.price).toFixed(1)
                                };
                            })
                        });
                        
                        if (closeOrders && closeOrders.length > 0) {
                            // 找到与当前持仓方向相反的平仓订单
                            const oppositeSide = positionSide === 'LONG' ? 'sell' : 'buy';
                            // 将API的side格式转换为标准格式
                            const apiSideToStandard = {
                                'Bid': 'buy',
                                'Ask': 'sell'
                            };
                            
                            const relevantCloseOrders = closeOrders.filter(order => {
                                const standardSide = apiSideToStandard[order.side] || order.side;
                                return standardSide === oppositeSide && 
                                       (order.status === 'open' || order.status === 'pending' || order.status === 'active' || order.status === 'New');
                            });
                            
                            if (relevantCloseOrders.length > 0) {
                                // 如果平仓订单超过1个，取消所有平仓订单
                                if (relevantCloseOrders.length > 1) {
                                    this.log('WARN', '发现多个平仓订单，取消所有平仓订单', {
                                        closeOrdersCount: relevantCloseOrders.length,
                                        orders: relevantCloseOrders.map(order => ({
                                            id: order.id,
                                            side: order.side,
                                            price: parseFloat(order.price).toFixed(1),
                                            quantity: parseFloat(order.quantity).toFixed(5),
                                            status: order.status
                                        }))
                                    });
                                    
                                    // 取消所有平仓订单
                                    for (const order of relevantCloseOrders) {
                                        try {
                                            await this.cancelOrder(order.id);
                                        } catch (error) {
                                            this.log('ERROR', '取消平仓订单失败', {
                                                orderId: order.id,
                                                error: error.message
                                            });
                                        }
                                    }
                                    
                                    // 清除缓存
                                    this.clearCloseOrdersCache();
                                    closeOrderInfo = '已取消多个平仓订单';
                                } else {
                                    // 只有一个平仓订单，显示详细信息
                                    const closeOrder = relevantCloseOrders[0];
                                    const closePrice = parseFloat(closeOrder.price);
                                    const closeQuantity = parseFloat(closeOrder.quantity);
                                    const closeValue = closePrice * closeQuantity;
                                    totalCloseOrderValue = closeValue;
                                    
                                    closeOrderInfo = `${closePrice.toFixed(1)} (${closeQuantity.toFixed(4)}) = ${closeValue.toFixed(2)} USDC`;
                                }
                            }
                        }
                    } catch (error) {
                        this.log('DEBUG', '获取平仓订单信息失败', { error: error.message });
                    }
                    
                    // 盈亏颜色指示
                    const pnlColor = totalPnl > 0 ? '🟢' : totalPnl < 0 ? '🔴' : '⚪';
                    const pnlSign = totalPnl > 0 ? '+' : '';
                    
                    console.log('├───────────────────────────────────────────────┤');
                    console.log(`│ 📈 ${position.symbol.padEnd(17)} │`);
                    console.log(`│ 💼 持仓: ${Math.abs(netQuantity).toFixed(4).padEnd(10)} ${positionSide.padEnd(5)}    │`);
                    console.log(`│ 💰 价值: ${positionValue.toFixed(2).padEnd(12)} USDC           │`);
                    console.log(`│ 📊 入仓: ${formatPriceWithGlobalPrecision(entryPrice).padEnd(10)} 现价: ${formatPriceWithGlobalPrecision(markPrice).padEnd(10)} │`);
                    console.log(`│ 🎯 平仓: ${closeOrderInfo.padEnd(35)} │`);
                    console.log(`│ ${pnlColor} 盈亏: ${pnlSign}${totalPnl.toFixed(4).padEnd(12)} USDC           │`);
                }
            } else {
                console.log('├───────────────────────────────────────────────┤');
                console.log('│ 📭 当前无持仓                                  │');
            }
        } catch (error) {
            // 检查是否是404错误（通常表示没有持仓）
            if (error.message && error.message.includes('404')) {
                console.log('├───────────────────────────────────────────────┤');
                console.log('│ 📭 当前无持仓                                  │');
                this.log('DEBUG', '无持仓信息（404）', { error: error.message });
            } else {
                this.log('ERROR', '获取持仓信息失败', { error: error.message });
                console.log('├───────────────────────────────────────────────┤');
                console.log('│ ❌ 无法获取持仓信息                             │');
            }
        }
        
        console.log('└───────────────────────────────────────────────┘');
    }
    

    /**
     * 启动机器人
     */
    async start() {
        if (this.isRunning) {
            this.log('WARN', '机器人已在运行中');
            return;
        }
        
        this.isRunning = true;
        this.stats.startTime = Date.now();
        
        this.log('INFO', '🚀 剥头皮交易机器人启动');
        
        try {
            // 0. 初始化全局价格精度
            await this.initializeGlobalPricePrecision();
            
            // 主循环
            while (this.isRunning) {
                try {
                    // 监控订单
                    await this.monitorOrders();
                    
                    // 检查订单是否需要更新价格（5秒内无持仓时）
                    await this.checkAndUpdateOrderPrices();
                    
                    // 检查持仓变化并更新平仓单
                    await this.checkPositionAndUpdateCloseOrders();
                    
                    // 风险管理
                    await this.riskManagement();
                    
                    // 检查是否需要下新单（等待时间后）
                    await this.placeNewOrder();
                    
                    // 打印统计信息
                    await this.printStats();
                    
                    // 等待一段时间
                    await this.sleep(10000); // 10秒
                    
                } catch (error) {
                    this.log('ERROR', '主循环错误', { error: error.message });
                    await this.sleep(5000); // 错误后等待5秒
                }
            }
        } catch (error) {
            this.log('ERROR', '机器人运行错误', { error: error.message });
        } finally {
            this.log('INFO', '机器人停止');
        }
    }
    
    /**
     * 停止机器人
     */
    stop() {
        this.log('INFO', '正在停止机器人...');
        this.isRunning = false;
        
        // 取消所有活跃订单
        this.cancelAllOrders();
    }
    
    /**
     * 取消所有活跃订单
     */
    async cancelAllOrders() {
        this.log('INFO', '取消所有活跃订单', { 
            activeOrders: this.activeOrders.size,
            closeOrders: this.closeOrders.size 
        });
        
        // 取消所有开仓订单
        for (const orderId of this.activeOrders.keys()) {
            await this.cancelOrder(orderId);
        }
        
        // 取消所有平仓订单
        for (const [entryOrderId, closeOrder] of this.closeOrders) {
            try {
                await this.client.cancelOrder(closeOrder.id, this.config.symbol);
                this.log('INFO', '平仓订单取消成功', { 
                    entryOrderId, 
                    closeOrderId: closeOrder.id 
                });
            } catch (error) {
                this.log('ERROR', '取消平仓订单失败', { 
                    entryOrderId, 
                    closeOrderId: closeOrder.id,
                    error: error.message 
                });
            }
        }
        
        this.closeOrders.clear();
    }
    
    /**
     * 睡眠函数
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// 导出类
module.exports = ScalpingBot;

// 如果直接运行此文件
if (require.main === module) {
    // 从命令行参数或环境变量获取配置
    const config = {
        symbol: process.env.SYMBOL || 'BTC_USDC_PERP',
        orderAmount: parseFloat(process.env.ORDER_AMOUNT) || 100,
        profitTarget: parseFloat(process.env.PROFIT_TARGET) || 0.0001,
        orderWaitTime: parseInt(process.env.ORDER_WAIT_TIME) || 450,
        maxPositionValue: parseFloat(process.env.MAX_POSITION_VALUE) || 40000,
        tradeDirection: process.env.TRADE_DIRECTION || 'buy',
        logLevel: process.env.LOG_LEVEL || 'INFO'
    };
    
    // 创建并启动机器人
    const bot = new ScalpingBot(config);
    
    // 优雅关闭处理
    process.on('SIGINT', async () => {
        console.log('\n收到停止信号，正在安全关闭...');
        bot.stop();
        process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
        console.log('\n收到终止信号，正在安全关闭...');
        bot.stop();
        process.exit(0);
    });
    
    // 启动机器人
    bot.start().catch(error => {
        console.error('机器人启动失败:', error);
        process.exit(1);
    });
}
