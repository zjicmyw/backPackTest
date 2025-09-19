const BackpackClient = require('./backpack-client');
const fs = require('fs');
const path = require('path');

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
        this.orderCreateTimes = new Map(); // 订单创建时间
        this.currentMarketPrice = 0; // 当前市场价格
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
        
        // API查询间隔控制
        this.lastCloseOrdersQueryTime = 0;
        this.lastMarketPriceQueryTime = 0;
        this.minQueryInterval = 1000; // 最小查询间隔1秒
        
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
     * 获取当前市场价格
     */
    async getCurrentPrice() {
        const now = Date.now();
        
        // 检查查询间隔，避免频繁查询
        if (now - this.lastMarketPriceQueryTime < this.minQueryInterval) {
            this.log('DEBUG', '市场价格查询间隔过短，跳过API查询', {
                timeSinceLastQuery: now - this.lastMarketPriceQueryTime,
                minInterval: this.minQueryInterval
            });
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
            // 买单：使用买1价格（市场最佳买入价）
            return parseFloat(bid).toFixed(1);
        } else {
            // 卖单：使用卖1价格（市场最佳卖出价）
            return parseFloat(ask).toFixed(1);
        }
    }
    
    /**
     * 计算订单数量
     */
    calculateOrderQuantity(price) {
        const quantity = (this.config.orderAmount / price).toFixed(4);
        return quantity;
    }
    
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
                    apiCloseOrdersCount: apiCloseOrders.length 
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
            this.log('INFO', '无平仓订单，创建新的止盈单', {
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
                this.log('DEBUG', '持仓价值变化未超过阈值，无需更新平仓订单', {
                    valueChange: valueChange.toFixed(2),
                    threshold: valueChangeThreshold.toFixed(2),
                    thresholdPercentage: '20%'
                });
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
            
            // 先查询是否已有平仓订单
            const existingCloseOrders = await this.getCloseOrdersFromAPI();
            
            if (existingCloseOrders.length > 0) {
                // 已有平仓订单，取消旧订单并创建新订单
                this.log('INFO', '发现现有平仓订单，取消后重新创建', {
                    existingOrdersCount: existingCloseOrders.length,
                    positionValue: actualPosition.positionValue,
                    positionSize: actualPosition.netQuantity
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
            
            const result = await this.placeTakeProfitOrder(dummyOrderId, entrySide, actualPosition.entryPrice, actualPosition.netQuantity);
            
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
            // 计算新的止盈价格
            const newTakeProfitPrice = await this.calculateTakeProfitPriceFromPosition(actualPosition);
            
            // 更新所有现有的平仓订单价格
            for (const [entryOrderId, closeOrder] of this.closeOrders) {
                const currentPrice = parseFloat(closeOrder.price);
                const newPrice = parseFloat(newTakeProfitPrice);
                
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
                        newTakeProfitPrice,
                        actualPosition.netQuantity.toFixed(4),
                        5, // maxRetries
                        true, // reduceOnly
                        null, // postOnly (使用默认配置)
                        true // isCloseOrder
                    );
                    
                    if (closeOrderData) {
                        // 更新closeOrders记录
                        this.closeOrders.set(entryOrderId, {
                            id: closeOrderData.id,
                            price: newTakeProfitPrice,
                            quantity: actualPosition.netQuantity.toFixed(4),
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
     * 计算止盈价格
     */
    calculateTakeProfitPrice(entryPrice, side, quantity) {
        // 计算总手续费率（开仓 + 平仓，假设都使用 maker 费率）
        const totalFeeRate = this.config.makerFee * 2; // 开仓和平仓各一次
        
        // 目标净盈利比例（除手续费外的盈利）
        const netProfitRate = this.config.profitTarget;
        
        // 总盈利比例 = 净盈利比例 + 手续费比例
        const totalProfitRate = netProfitRate + totalFeeRate;
        
        let takeProfitPrice;
        if (side === 'buy') {
            // 买单：止盈价格 = 买入价 * (1 + 总盈利比例)
            takeProfitPrice = parseFloat(entryPrice) * (1 + totalProfitRate);
        } else {
            // 卖单：止盈价格 = 卖出价 * (1 - 总盈利比例)
            takeProfitPrice = parseFloat(entryPrice) * (1 - totalProfitRate);
        }
        
        this.log('DEBUG', '计算止盈价格', {
            entryPrice,
            side,
            quantity,
            totalFeeRate: (totalFeeRate * 100).toFixed(4) + '%',
            netProfitRate: (netProfitRate * 100).toFixed(4) + '%',
            totalProfitRate: (totalProfitRate * 100).toFixed(4) + '%',
            takeProfitPrice: takeProfitPrice.toFixed(1),
            feeType: 'maker'
        });
        
        return takeProfitPrice.toFixed(1);
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
                // 所有订单（包括止盈订单）都遵循配置中的 postOnly 设置
                const usePostOnly = postOnly !== null ? postOnly : this.config.postOnly;
                
                this.log('INFO', '准备下单', { 
                    side, 
                    apiSide,
                    price, 
                    quantity, 
                    symbol: this.config.symbol,
                    orderType: 'Limit',
                    reduceOnly,
                    postOnly: usePostOnly,
                    retry: retryCount + 1 
                });
                
                const order = await this.client.placeOrder(
                    this.config.symbol,
                    apiSide,           // 'Bid' 或 'Ask'
                    'Limit',           // 限价单
                    quantity,          // 数量
                    price,             // 价格
                    reduceOnly,        // 是否仅平仓
                    usePostOnly        // 是否仅挂单
                );
                
                if (order && order.length > 0) {
                    const orderData = order[0];
                    
                    // 只有开仓订单才加入 activeOrders，止盈订单不加入
                    if (!isCloseOrder) {
                        this.activeOrders.set(orderData.id, {
                            ...orderData,
                            internalSide: side,  // 保存内部使用的 side ('buy'/'sell')
                            originalPrice: price,
                            quantity,
                            timestamp: Date.now(),
                            status: 'pending'
                        });
                        
                        // 记录订单创建时间
                        this.orderCreateTimes.set(orderData.id, Date.now());
                    }
                    
                    this.stats.totalOrders++;
                    
                    this.log('INFO', '订单创建成功', { 
                        orderId: orderData.id, 
                        side, 
                        price, 
                        quantity,
                        reduceOnly,
                        isCloseOrder,
                        orderType: isCloseOrder ? '止盈订单' : '开仓订单',
                        retry: retryCount + 1
                    });
                    
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
                    this.log('WARN', 'ReduceOnly订单错误，重新获取持仓信息调整数量', { 
                        error: error.message, 
                        side, 
                        originalQuantity: quantity, 
                        retry: retryCount,
                        isCloseOrder
                    });
                    
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
                    
                    // 调整数量为实际持仓数量
                    const adjustedQuantity = actualPosition.netQuantity.toFixed(4);
                    
                    if (parseFloat(adjustedQuantity) <= 0) {
                        this.log('ERROR', '实际持仓数量为0或负数，取消平仓操作', {
                            actualQuantity: adjustedQuantity,
                            positionValue: actualPosition.positionValue
                        });
                        return null;
                    }
                    
                    this.log('INFO', '调整平仓数量重新下单', {
                        originalQuantity: quantity,
                        adjustedQuantity,
                        positionSide: actualPosition.side,
                        positionValue: actualPosition.positionValue
                    });
                    
                    // 使用调整后的数量
                    quantity = adjustedQuantity;
                    
                    retryCount--; // 不计入重试次数，因为是数量调整
                    await this.sleep(500); // 短暂等待
                    continue;
                }
                
                this.log('WARN', '下单失败，准备重试', { 
                    error: error.message, 
                    side, 
                    price, 
                    quantity,
                    retry: retryCount,
                    maxRetries,
                    isPostOnlyTakerError
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
                this.log('WARN', '市场深度数据无效');
                return null;
            }

            const bestBid = depthData.bids[0][0]; // 最高买价
            const bestAsk = depthData.asks[0][0]; // 最低卖价

            this.log('DEBUG', '获取市场数据', {
                symbol: this.config.symbol,
                bestBid,
                bestAsk,
                spread: (parseFloat(bestAsk) - parseFloat(bestBid)).toFixed(2)
            });

            return {
                bestBid,
                bestAsk,
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
            
            // 价格调整幅度（确保不会立即成交）
            const priceStep = Math.max(0.1, currentPriceNum * 0.0001); // 至少0.1或0.01%
            
            let adjustedPrice;
            
            if (side === 'buy') {
                // 买单：确保价格低于当前最佳卖价(bestAsk)
                const maxBuyPrice = parseFloat(bestAsk) - priceStep;
                
                if (currentPriceNum >= parseFloat(bestAsk)) {
                    // 当前价格太高，调整为安全价格
                    adjustedPrice = Math.min(maxBuyPrice, parseFloat(bestBid));
                    this.log('DEBUG', '买单价格调整', {
                        currentPrice: currentPriceNum,
                        bestAsk: parseFloat(bestAsk),
                        bestBid: parseFloat(bestBid),
                        adjustedPrice,
                        priceStep
                    });
                } else {
                    // 价格看起来合理，可能是市场快速变动，稍微降低价格
                    adjustedPrice = currentPriceNum - priceStep;
                }
                
            } else { // sell
                // 卖单：确保价格高于当前最佳买价(bestBid)
                const minSellPrice = parseFloat(bestBid) + priceStep;
                
                if (currentPriceNum <= parseFloat(bestBid)) {
                    // 当前价格太低，调整为安全价格
                    adjustedPrice = Math.max(minSellPrice, parseFloat(bestAsk));
                    this.log('DEBUG', '卖单价格调整', {
                        currentPrice: currentPriceNum,
                        bestBid: parseFloat(bestBid),
                        bestAsk: parseFloat(bestAsk),
                        adjustedPrice,
                        priceStep
                    });
                } else {
                    // 价格看起来合理，可能是市场快速变动，稍微提高价格
                    adjustedPrice = currentPriceNum + priceStep;
                }
            }
            
            // 确保调整后的价格是合理的
            if (adjustedPrice <= 0) {
                this.log('WARN', '调整后价格无效');
                return null;
            }
            
            return adjustedPrice.toFixed(1);
            
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
            await this.client.cancelOrder(orderId, this.config.symbol);
            this.activeOrders.delete(orderId);
            this.orderCreateTimes.delete(orderId); // 清理订单创建时间记录
            
            // 从平仓订单中删除（需要根据orderId查找对应的entryOrderId）
            for (const [entryOrderId, closeOrder] of this.closeOrders) {
                if (closeOrder.id === orderId) {
                    this.closeOrders.delete(entryOrderId);
                    break;
                }
            }
            this.log('INFO', '订单取消成功');
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
     * 基于实际持仓信息计算止盈价格
     * @param {Object} position - 实际持仓信息
     * @returns {string} 止盈价格
     */
    async calculateTakeProfitPriceFromPosition(position) {
        // 计算总手续费率（开仓 + 平仓，假设都使用 maker 费率）
        const totalFeeRate = this.config.makerFee * 2; // 开仓和平仓各一次
        
        // 目标净盈利比例（除手续费外的盈利）
        const netProfitRate = this.config.profitTarget;
        
        // 总盈利比例 = 净盈利比例 + 手续费比例
        const totalProfitRate = netProfitRate + totalFeeRate;
        
        // 计算理论止盈价格
        let takeProfitPrice;
        if (position.side === 'long') {
            // 多头持仓：止盈价格 = 入仓价 * (1 + 总盈利比例)
            takeProfitPrice = position.entryPrice * (1 + totalProfitRate);
        } else {
            // 空头持仓：止盈价格 = 入仓价 * (1 - 总盈利比例)
            takeProfitPrice = position.entryPrice * (1 - totalProfitRate);
        }
        
        // 获取当前市场价格进行比较
        try {
            const { bid, ask } = await this.getCurrentPrice();
            const marketPrice = position.side === 'long' ? bid : ask; // 多头用买价平仓，空头用卖价平仓
            
            // 计算理论止盈价格的收益
            const theoreticalProfitRate = position.side === 'long' 
                ? (takeProfitPrice - position.entryPrice) / position.entryPrice
                : (position.entryPrice - takeProfitPrice) / position.entryPrice;
            
            // 计算市场价格的收益
            const marketProfitRate = position.side === 'long'
                ? (marketPrice - position.entryPrice) / position.entryPrice
                : (position.entryPrice - marketPrice) / position.entryPrice;
            
            // 如果市场价格收益更高且超过目标收益，使用市场价格
            if (marketProfitRate > theoreticalProfitRate && marketProfitRate >= netProfitRate) {
                this.log('INFO', '市场价格收益更高，使用市场价格作为止盈价格', {
                    positionSide: position.side,
                    entryPrice: position.entryPrice.toFixed(1),
                    theoreticalPrice: takeProfitPrice.toFixed(1),
                    marketPrice: marketPrice.toFixed(1),
                    theoreticalProfitRate: (theoreticalProfitRate * 100).toFixed(4) + '%',
                    marketProfitRate: (marketProfitRate * 100).toFixed(4) + '%',
                    targetProfitRate: (netProfitRate * 100).toFixed(4) + '%'
                });
                takeProfitPrice = marketPrice;
            }
        } catch (error) {
            this.log('WARN', '获取市场价格失败，使用理论止盈价格', {
                error: error.message,
                theoreticalPrice: takeProfitPrice.toFixed(1)
            });
        }
        
        this.log('DEBUG', '计算止盈价格', {
            positionSide: position.side,
            entryPrice: position.entryPrice,
            netQuantity: position.netQuantity,
            positionValue: position.positionValue,
            totalFeeRate: (totalFeeRate * 100).toFixed(4) + '%',
            netProfitRate: (netProfitRate * 100).toFixed(4) + '%',
            totalProfitRate: (totalProfitRate * 100).toFixed(4) + '%',
            takeProfitPrice: takeProfitPrice.toFixed(1)
        });
        
        return takeProfitPrice.toFixed(1);
    }
    
    /**
     * 通过API查询平仓订单
     */
    async getCloseOrdersFromAPI() {
        const now = Date.now();
        
        // 检查查询间隔，避免频繁查询
        if (now - this.lastCloseOrdersQueryTime < this.minQueryInterval) {
            this.log('DEBUG', '查询间隔过短，跳过API查询', {
                timeSinceLastQuery: now - this.lastCloseOrdersQueryTime,
                minInterval: this.minQueryInterval
            });
            return [];
        }
        
        try {
            this.lastCloseOrdersQueryTime = now;
            const orders = await this.client.getOrders(this.config.symbol);
            if (!orders || !Array.isArray(orders)) {
                return [];
            }
            
            // 筛选出平仓订单（reduceOnly = true 且状态为 pending 或 active）
            const closeOrders = orders.filter(order => {
                return order.reduceOnly === true && 
                       (order.status === 'pending' || order.status === 'active' || order.status === 'New');
            });
            
            this.log('DEBUG', '通过API查询平仓订单', {
                totalOrders: orders.length,
                closeOrdersCount: closeOrders.length,
                closeOrderIds: closeOrders.map(o => o.id),
                closeOrderStatuses: closeOrders.map(o => o.status)
            });
            
            return closeOrders;
        } catch (error) {
            this.log('ERROR', '查询平仓订单失败', {
                error: error.message
            });
            return [];
        }
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
     * 下止盈单
     */
    async placeTakeProfitOrder(entryOrderId, entrySide, entryPrice, quantity) {
        try {
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
                this.log('WARN', '当前无持仓，跳过止盈单');
                return null;
            }
            
            // 通过API查询真实的平仓订单状态
            const existingCloseOrders = await this.getCloseOrdersFromAPI();
            
            if (existingCloseOrders.length > 0) {
                this.log('INFO', '发现现有平仓订单，取消后重新创建', { 
                    existingOrdersCount: existingCloseOrders.length
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
            
            // 基于实际持仓信息计算止盈价格
            const takeProfitPrice = await this.calculateTakeProfitPriceFromPosition(actualPosition);
            
            // 计算平仓方向（与实际持仓相反）
            // 如果是多头持仓(long)，需要卖出平仓(sell)
            // 如果是空头持仓(short)，需要买入平仓(buy)
            const closeSide = actualPosition.side === 'long' ? 'sell' : 'buy';
            
            // 转换side格式，符合内部处理逻辑
            const closeApiSide = closeSide === 'buy' ? 'Bid' : 'Ask';
            
            this.log('INFO', '准备下止盈单', {
                entryOrderId,
                actualPosition,
                closeSide,
                closeApiSide,
                orderType: 'Limit',
                takeProfitPrice,
                explanation: `实际持仓${actualPosition.side} ${actualPosition.netQuantity}，入仓价${actualPosition.entryPrice}，止盈价${takeProfitPrice}`
            });
            
            // 下止盈单（使用实际持仓数量，限价单，仅平仓）
            // 通过 placeOrder 方法，止盈订单会自动使用配置的 postOnly 设置
            this.log('DEBUG', '准备创建平仓订单', {
                closeSide,
                takeProfitPrice,
                quantity: actualPosition.netQuantity.toFixed(4),
                positionSide: actualPosition.side,
                positionValue: actualPosition.positionValue,
                entryPrice: actualPosition.entryPrice,
                currentPrice: actualPosition.currentPrice
            });
            
            const closeOrderData = await this.placeOrder(
                closeSide,             // 'buy' 或 'sell'
                takeProfitPrice,       // 价格
                actualPosition.netQuantity.toFixed(4),  // 使用实际持仓数量
                5,                     // maxRetries
                true,                  // reduceOnly = true，仅平仓
                null,                  // postOnly = null，使用默认配置
                true                   // isCloseOrder = true，标识为止盈订单
            );
            
            this.log('DEBUG', '平仓订单创建结果', {
                closeOrderData: closeOrderData ? '成功' : '失败',
                orderId: closeOrderData ? closeOrderData.id : 'N/A'
            });
            
            if (closeOrderData) {
                // 将止盈订单记录到 closeOrders
                this.closeOrders.set(entryOrderId, {
                    ...closeOrderData,
                    entryOrderId,
                    entrySide,
                    entryPrice,
                    closeSide,
                    takeProfitPrice,
                    timestamp: Date.now(),
                    status: 'pending'
                });
                
                this.log('INFO', '止盈单创建成功', {
                    entryOrderId,
                    closeOrderId: closeOrderData.id,
                    closeSide,
                    takeProfitPrice,
                    quantity: actualPosition.netQuantity.toFixed(4),
                    positionValue: actualPosition.positionValue,
                    reduceOnly: true,
                    postOnly: this.config.postOnly
                });
                
                // 记录到CSV
                this.logTrade({
                    symbol: this.config.symbol,
                    side: closeApiSide, // 直接使用 API side ('Bid' 或 'Ask')
                    orderType: 'Limit',
                    price: takeProfitPrice,
                    quantity: actualPosition.netQuantity.toFixed(4),
                    orderId: closeOrderData.id,
                    status: 'New',
                    notes: `TakeProfit for ${entryOrderId}`
                });
                
                return closeOrderData;
            } else {
                throw new Error('止盈单创建失败：无返回数据');
            }
            
        } catch (error) {
            this.log('ERROR', '下止盈单失败', { 
                entryOrderId, 
                entrySide, 
                entryPrice, 
                quantity,
                currentPositionSize,
                currentPositionSide,
                closeSide,
                closeApiSide,
                takeProfitPrice,
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
                closeOrders: this.closeOrders.size
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
                this.log('INFO', '订单成交，更新持仓', {
                    orderId,
                    side,
                    orderQuantity: orderData.quantity,
                    executedQuantity: orderData.executedQuantity,
                    actualQuantity: executedQty,
                    price,
                    currentPosition: this.currentPosition
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
                this.log('DEBUG', '准备下平仓单（止盈价）', {
                    orderId,
                    side,
                    orderPrice: orderData.price,
                    executedQty,
                    currentPosition: this.currentPosition
                });
                await this.placeTakeProfitOrder(orderId, side, parseFloat(orderData.price), executedQty);
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
            this.log('INFO', '平仓订单完成', { 
                entryOrderId, 
                closeOrderId: closeOrderData.id, 
                status: closeOrderData.status 
            });
            
            // 只有成交的平仓订单才更新持仓
            if (this.isOrderFilled(closeOrderData)) {
                // 使用实际成交数量
                const executedQty = parseFloat(closeOrderData.executedQuantity) || parseFloat(closeOrderData.quantity);
                const closeSide = closeOrderData.side === 'Bid' ? 'buy' : 'sell';
                const closePrice = parseFloat(closeOrderData.price);
                this.log('INFO', '平仓订单成交，更新持仓', {
                    closeOrderId: closeOrderData.id,
                    closeSide,
                    orderQuantity: closeOrderData.quantity,
                    executedQuantity: closeOrderData.executedQuantity,
                    actualQuantity: executedQty,
                    closePrice,
                    currentPosition: this.currentPosition
                });
                this.updatePosition(closeSide, executedQty, closePrice, true);
            }
            
            // 计算实际盈利
            const entryOrder = this.activeOrders.get(entryOrderId);
            if (entryOrder) {
                const actualProfit = await this.calculateActualProfit(entryOrder, closeOrderData);
                
                if (actualProfit > 0) {
                    this.stats.successfulOrders++;
                    this.stats.totalProfit += actualProfit;
                    this.log('INFO', '止盈成功', { 
                        entryOrderId, 
                        closeOrderId: closeOrderData.id,
                        actualProfit,
                        newPosition: this.currentPosition
                    });
                    
                    // 记录止盈交易
                    this.logTrade({
                        ...closeOrderData,
                        status: 'Filled',
                        profit: actualProfit.toFixed(4),
                        notes: `TakeProfit successful (Entry: ${entryOrderId})`
                    });
                    
                    // 止盈后立即下新单
                    this.log('INFO', '止盈成功，立即开新单', { 
                        entryOrderId, 
                        actualProfit,
                        newPosition: this.currentPosition
                    });
                    await this.placeNewOrder();
                } else {
                    this.log('INFO', '平仓未盈利', { 
                        entryOrderId, 
                        closeOrderId: closeOrderData.id,
                        actualProfit,
                        newPosition: this.currentPosition
                    });
                    
                    // 记录未盈利交易
                    this.logTrade({
                        ...closeOrderData,
                        status: 'Filled',
                        profit: actualProfit.toFixed(4),
                        notes: `TakeProfit no profit (Entry: ${entryOrderId})`
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
            
            // 3. 止盈单：计算当前持仓的盈利扣除手续费后是否达到止盈标准
            if (profit >= this.config.profitTarget) {
                this.stats.successfulOrders++;
                this.stats.totalProfit += profit;
                this.log('INFO', '订单达到止盈标准', { 
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
                
                // 2. 止盈后马上下一单
                this.log('INFO', '订单达到止盈标准，立即开新单', { 
                    orderId, 
                    profit, 
                    profitTarget: this.config.profitTarget 
                });
                await this.placeNewOrder();
            } else {
                this.log('INFO', '订单未达到止盈标准');
                
                // 记录未盈利交易
                this.logTrade({
                    ...orderData,
                    status: 'Filled',
                    profit: profit.toFixed(4),
                    notes: `No profit (Target: ${this.config.profitTarget})`
                });
                
                // 未达到止盈标准时等待指定时间后开新单
                this.log('INFO', `订单未达到止盈标准，等待 ${this.config.orderWaitTime} 秒后开新单`);
                
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
     * 下新单
     */
    async placeNewOrder() {
        try {
            // 获取市场价格
            const { bid, ask } = await this.getCurrentPrice();

            // 计算订单参数 - 直接使用买1或卖1价格
            const side = this.config.tradeDirection;
            const price = this.calculateOrderPrice(bid, ask, side);
            const quantity = this.calculateOrderQuantity(price);

            // 转换side格式
            const apiSide = side === 'buy' ? 'Bid' : 'Ask';

            // 检查持仓价格控制
            const actualPosition = await this.getActualPositionInfo();
            if (actualPosition && actualPosition.positionValue > 0) {
                // 检查新订单价格是否高于持仓入场价格
                const entryPrice = parseFloat(actualPosition.entryPrice);
                const newOrderPrice = parseFloat(price);
                
                if (side === 'buy' && newOrderPrice > entryPrice) {
                    this.log('WARN', '新买单价格高于持仓入场价格，跳过下单', {
                        entryPrice: entryPrice.toFixed(1),
                        newOrderPrice: newOrderPrice.toFixed(1),
                        priceDifference: (newOrderPrice - entryPrice).toFixed(1),
                        positionSide: actualPosition.side,
                        positionValue: actualPosition.positionValue.toFixed(2),
                        reason: '风险控制：避免增加持仓成本'
                    });
                    return;
                }
                
                if (side === 'sell' && newOrderPrice < entryPrice) {
                    this.log('WARN', '新卖单价格低于持仓入场价格，跳过下单', {
                        entryPrice: entryPrice.toFixed(1),
                        newOrderPrice: newOrderPrice.toFixed(1),
                        priceDifference: (entryPrice - newOrderPrice).toFixed(1),
                        positionSide: actualPosition.side,
                        positionValue: actualPosition.positionValue.toFixed(2),
                        reason: '风险控制：避免增加持仓成本'
                    });
                    return;
                }
                
                this.log('DEBUG', '新订单价格检查通过', {
                    entryPrice: entryPrice.toFixed(1),
                    newOrderPrice: newOrderPrice.toFixed(1),
                    side,
                    positionSide: actualPosition.side,
                    priceDifference: side === 'buy' ? 
                        (newOrderPrice - entryPrice).toFixed(1) : 
                        (entryPrice - newOrderPrice).toFixed(1)
                });
            }
            
            // 检查是否达到单币种持仓最大金额限制
            if (actualPosition && actualPosition.positionValue > 0) {
                // 检查当前持仓价值是否已达到限制
                if (actualPosition.positionValue >= this.config.maxPositionValue) {
                    this.log('INFO', '已达到单币种持仓最大金额限制', {
                        currentPositionValue: actualPosition.positionValue.toFixed(2),
                        maxPositionValue: this.config.maxPositionValue,
                        symbol: this.config.symbol,
                        unit: 'USDC'
                    });
                    return;
                }
                
                // 检查新订单是否会超过限制
                const newOrderValue = this.config.orderAmount;
                const projectedPositionValue = actualPosition.positionValue + newOrderValue;
                
                if (projectedPositionValue > this.config.maxPositionValue) {
                    this.log('INFO', '新订单将超过持仓金额限制，跳过下单', {
                        currentPositionValue: actualPosition.positionValue.toFixed(2),
                        newOrderValue,
                        projectedPositionValue: projectedPositionValue.toFixed(2),
                        maxPositionValue: this.config.maxPositionValue,
                        symbol: this.config.symbol,
                        unit: 'USDC'
                    });
                    return;
                }
            }
            
            // 检查订单间等待时间（只有在没有活跃订单时才检查）
            let skipWaitTime = false;
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
                
                // 取消订单后跳过等待时间检查，立即下新单
                skipWaitTime = true;
            } else {
                // 没有活跃订单时，优先确保始终有一个活跃订单
                // 只有在有持仓但没有活跃订单的情况下才检查等待时间
                const actualPosition = await this.getActualPositionInfo();
                const hasPosition = actualPosition && actualPosition.positionValue > 0;
                
                if (hasPosition && timeSinceLastOrder < waitTime) {
                    const remainingTime = Math.ceil((waitTime - timeSinceLastOrder) / 1000);
                    this.log('DEBUG', '有持仓但等待时间未到，跳过下单', { 
                        timeSinceLastOrder: Math.ceil(timeSinceLastOrder / 1000),
                        waitTime: this.config.orderWaitTime,
                        remainingTime,
                        hasPosition
                    });
                    return;
                } else if (!hasPosition) {
                    // 没有持仓时，应该立即下单，不受等待时间限制
                    this.log('INFO', '没有持仓，立即下单');
                    skipWaitTime = true;
                }
            }

            this.log('INFO', '准备下新单', { 
                side, 
                apiSide,
                price, 
                quantity, 
                bid, 
                ask,
                activeOrders: this.activeOrders.size,
                timeSinceLastOrder: Math.ceil(timeSinceLastOrder / 1000),
                skipWaitTime
            });

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
                    
                    // 盈亏颜色指示
                    const pnlColor = totalPnl > 0 ? '🟢' : totalPnl < 0 ? '🔴' : '⚪';
                    const pnlSign = totalPnl > 0 ? '+' : '';
                    
                    console.log('├───────────────────────────────────────────────┤');
                    console.log(`│ 📈 ${position.symbol.padEnd(17)} │`);
                    console.log(`│ 💼 持仓: ${Math.abs(netQuantity).toFixed(4).padEnd(10)} ${positionSide.padEnd(5)}    │`);
                    console.log(`│ 💰 价值: ${positionValue.toFixed(2).padEnd(12)} USDC           │`);
                    console.log(`│ 📊 入仓: ${entryPrice.toFixed(1).padEnd(10)} 现价: ${markPrice.toFixed(1).padEnd(10)} │`);
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
            // 1. 机器人开启后马上下1单
            this.log('INFO', '机器人启动，立即下第一单');
            await this.placeNewOrder();
            
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
