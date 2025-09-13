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
            profitTarget: config.profitTarget || 0.001, // 止盈目标 (USDC)
            orderWaitTime: config.orderWaitTime || 60, // 订单间等待时间 (秒)
            maxActiveOrders: config.maxActiveOrders || 40, // 最大成交订单数（基于持仓价值）
            tradeDirection: config.tradeDirection || 'buy', // 'buy' 或 'sell'
            
            // 手续费配置（从配置文件读取）
            makerFee: config.fees?.maker || 0.0001, // 挂单手续费 0.01%
            takerFee: config.fees?.taker || 0.00026, // 市价手续费 0.026%
            
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
        
        this.log('INFO', 'ScalpingBot 初始化完成', { config: this.config });
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
        const logEntry = `[${timestamp}] [${level}] ${message}`;
        
        // 控制台输出
        if (this.shouldLog(level)) {
            console.log(logEntry);
            if (Object.keys(data).length > 0) {
                console.log(JSON.stringify(data, null, 2));
            }
        }
        
        // 文件日志
        if (this.config.enableFileLog) {
            const fileEntry = `${logEntry}\n${Object.keys(data).length > 0 ? JSON.stringify(data, null, 2) + '\n' : ''}`;
            fs.appendFileSync(this.debugLogFile, fileEntry);
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
        try {
            const bestPrices = await this.client.getBestPrices(this.config.symbol);
            const bid = parseFloat(bestPrices.bestBid[0]);
            const ask = parseFloat(bestPrices.bestAsk[0]);
            const midPrice = (bid + ask) / 2;
            
            this.log('DEBUG', '获取市场价格', { bid, ask, midPrice });
            return { bid, ask, midPrice };
        } catch (error) {
            this.log('ERROR', '获取市场价格失败', { error: error.message });
            throw error;
        }
    }
    
    /**
     * 计算订单价格 - 限价单，学习 test.js 的做法
     */
    calculateOrderPrice(bid, ask, side) {
        if (side === 'buy') {
            // 买单：使用买1价格（就像 test.js 中的 bestBidPrice）
            return parseFloat(bid).toFixed(1);
        } else {
            // 卖单：使用卖1价格（就像 test.js 中的 bestAskPrice）
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
     * 检查持仓变化并重新下止盈单
     */
    async checkPositionAndUpdateCloseOrders() {
        const currentPositionSize = this.getCurrentPositionSize();
        const currentPositionSide = this.getCurrentPositionSide();
        
        if (currentPositionSize === 0) {
            // 无持仓时，取消所有平仓单
            if (this.closeOrders.size > 0) {
                this.log('INFO', '无持仓，取消所有平仓单', { 
                    closeOrdersCount: this.closeOrders.size 
                });
                
                for (const [entryOrderId, closeOrder] of this.closeOrders) {
                    await this.cancelOrder(closeOrder.id);
                }
                this.closeOrders.clear();
            }
            return;
        }
        
        // 有持仓时，检查是否需要更新平仓单
        let needNewCloseOrder = false;
        let totalCloseQuantity = 0;
        
        for (const [entryOrderId, closeOrder] of this.closeOrders) {
            const closeQuantity = parseFloat(closeOrder.quantity);
            totalCloseQuantity += closeQuantity;
            
            // 如果平仓单数量与当前持仓数量不匹配，需要重新下平仓单
            if (Math.abs(closeQuantity - currentPositionSize) > 0.0001) {
                this.log('INFO', '持仓变化，重新下平仓单', {
                    entryOrderId,
                    oldQuantity: closeQuantity,
                    newQuantity: currentPositionSize,
                    currentPositionSide
                });
                
                // 取消旧平仓单
                await this.cancelOrder(closeOrder.id);
                needNewCloseOrder = true;
            }
        }
        
        // 检查总平仓数量是否匹配持仓数量
        if (currentPositionSize !== 0 && Math.abs(totalCloseQuantity - currentPositionSize) > 0.0001) {
            this.log('INFO', '平仓单总数量与持仓不匹配，需要调整', {
                currentPositionSize,
                totalCloseQuantity,
                currentPositionSide,
                closeOrdersCount: this.closeOrders.size
            });
            
            // 取消所有现有平仓单
            for (const [entryOrderId, closeOrder] of this.closeOrders) {
                await this.cancelOrder(closeOrder.id);
            }
            this.closeOrders.clear();
            needNewCloseOrder = true;
        }
        
        // 如果需要新的平仓单，下一个新的
        if (needNewCloseOrder && currentPositionSize !== 0) {
            if (this.positionEntryPrice > 0) {
                const entrySide = currentPositionSide === 'long' ? 'buy' : 'sell';
                const dummyOrderId = `position_${Date.now()}`;
                
                this.log('INFO', '重新下平仓单', {
                    dummyOrderId,
                    entrySide,
                    entryPrice: this.positionEntryPrice,
                    currentPositionSize,
                    currentPositionSide
                });
                
                try {
                    await this.placeTakeProfitOrder(dummyOrderId, entrySide, this.positionEntryPrice, currentPositionSize);
                } catch (error) {
                    this.log('ERROR', '重新下平仓单失败', {
                        error: error.message,
                        currentPositionSize,
                        currentPositionSide,
                        entryPrice: this.positionEntryPrice
                    });
                }
            }
        }
        
        // 如果有持仓但没有平仓单，需要下止盈单
        if (currentPositionSize !== 0 && this.closeOrders.size === 0) {
            this.log('INFO', '有持仓但无平仓单，需要下止盈单', {
                currentPositionSize,
                currentPositionSide,
                activeOrders: this.activeOrders.size,
                entryPrice: this.positionEntryPrice
            });
            
            // 直接根据持仓情况下止盈单，不依赖活跃订单
            if (this.positionEntryPrice > 0) {
                // 根据持仓方向确定开仓时的方向（用于计算止盈价格）
                // 如果当前持仓是多头(long)，说明开仓时是买入(buy)
                // 如果当前持仓是空头(short)，说明开仓时是卖出(sell)
                const entrySide = currentPositionSide === 'long' ? 'buy' : 'sell';
                const dummyOrderId = `position_${Date.now()}`; // 生成一个虚拟订单ID
                
                this.log('INFO', '根据持仓直接下止盈单', {
                    dummyOrderId,
                    entrySide,
                    entryPrice: this.positionEntryPrice,
                    currentPositionSize,
                    currentPositionSide,
                    explanation: `持仓${currentPositionSide}，开仓时为${entrySide}，平仓时为${currentPositionSide === 'long' ? 'sell' : 'buy'}`
                });
                
                try {
                    await this.placeTakeProfitOrder(dummyOrderId, entrySide, this.positionEntryPrice, currentPositionSize);
                } catch (error) {
                    this.log('ERROR', '直接下止盈单失败', {
                        error: error.message,
                        currentPositionSize,
                        currentPositionSide,
                        entryPrice: this.positionEntryPrice
                    });
                }
            } else {
                this.log('WARN', '持仓入仓价格为0，无法下止盈单', {
                    currentPositionSize,
                    currentPositionSide,
                    entryPrice: this.positionEntryPrice
                });
            }
        }
    }
    
    /**
     * 计算止盈价格
     */
    calculateTakeProfitPrice(entryPrice, side, quantity) {
        // 使用taker费率计算手续费
        const fee = entryPrice * quantity * this.config.takerFee;
        const profitPerUnit = (this.config.profitTarget + fee) / quantity;
        
        let takeProfitPrice;
        if (side === 'buy') {
            // 买单：止盈价格 = 买入价 + 每单位盈利
            takeProfitPrice = parseFloat(entryPrice) + profitPerUnit;
        } else {
            // 卖单：止盈价格 = 卖出价 - 每单位盈利
            takeProfitPrice = parseFloat(entryPrice) - profitPerUnit;
        }
        
        this.log('DEBUG', '计算止盈价格', {
            entryPrice,
            side,
            quantity,
            fee: fee.toFixed(6),
            profitTarget: this.config.profitTarget,
            profitPerUnit: profitPerUnit.toFixed(6),
            takeProfitPrice: takeProfitPrice.toFixed(1),
            feeType: 'taker'
        });
        
        return takeProfitPrice.toFixed(1);
    }
    
    /**
     * 下单 - 限价单，失败重试直到成功
     */
    async placeOrder(side, price, quantity, maxRetries = 5, reduceOnly = false) {
        let retryCount = 0;
        
        while (retryCount < maxRetries) {
            try {
                // 直接使用 Bid/Ask 格式，就像 test.js 中一样
                const apiSide = side === 'buy' ? 'Bid' : 'Ask';
                
                this.log('INFO', '准备下单', { 
                    side, 
                    apiSide,
                    price, 
                    quantity, 
                    symbol: this.config.symbol,
                    orderType: 'Limit',
                    retry: retryCount + 1 
                });
                
                const order = await this.client.placeOrder(
                    this.config.symbol,
                    apiSide,           // 'Bid' 或 'Ask'
                    'Limit',           // 限价单
                    quantity,          // 数量
                    price,             // 价格
                    reduceOnly         // 是否仅平仓
                );
                
                if (order && order.length > 0) {
                    const orderData = order[0];
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
                    
                    this.stats.totalOrders++;
                    
                    this.log('INFO', '订单创建成功', { 
                        orderId: orderData.id, 
                        side, 
                        price, 
                        quantity,
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
                    
                    // 下单成功后，立即检查并调整平仓单
                    await this.checkPositionAndUpdateCloseOrders();
                    
                    return orderData;
                } else {
                    throw new Error('订单创建失败：无返回数据');
                }
            } catch (error) {
                retryCount++;
                this.log('WARN', '下单失败，准备重试', { 
                    error: error.message, 
                    side, 
                    price, 
                    quantity,
                    retry: retryCount,
                    maxRetries
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
     * 取消订单
     */
    async cancelOrder(orderId) {
        try {
            await this.client.cancelOrder(orderId, this.config.symbol);
            this.activeOrders.delete(orderId);
            this.orderCreateTimes.delete(orderId); // 清理订单创建时间记录
            this.closeOrders.delete(orderId); // 同时从平仓订单中删除
            this.orderCreateTimes.delete(orderId); // 清理订单创建时间记录
            this.log('INFO', '订单取消成功', { orderId });
            return true;
        } catch (error) {
            this.log('ERROR', '取消订单失败', { orderId, error: error.message });
            return false;
        }
    }
    
    /**
     * 基于实际持仓信息计算止盈价格
     * @param {Object} position - 实际持仓信息
     * @returns {string} 止盈价格
     */
    calculateTakeProfitPriceFromPosition(position) {
        // 计算总手续费（开仓 + 平仓都使用 taker 费率）
        const totalFee = position.positionValue * this.config.takerFee * 2; // 开仓和平仓各一次
        
        // 计算目标盈利
        const targetProfit = this.config.profitTarget;
        
        // 计算每单位需要的盈利
        const profitPerUnit = (targetProfit + totalFee) / position.netQuantity;
        
        let takeProfitPrice;
        if (position.side === 'long') {
            // 多头持仓：止盈价格 = 入仓价 + 每单位盈利
            takeProfitPrice = position.entryPrice + profitPerUnit;
        } else {
            // 空头持仓：止盈价格 = 入仓价 - 每单位盈利
            takeProfitPrice = position.entryPrice - profitPerUnit;
        }
        
        this.log('DEBUG', '计算止盈价格', {
            positionSide: position.side,
            entryPrice: position.entryPrice,
            netQuantity: position.netQuantity,
            positionValue: position.positionValue,
            totalFee: totalFee.toFixed(4),
            targetProfit: targetProfit.toFixed(4),
            profitPerUnit: profitPerUnit.toFixed(4),
            takeProfitPrice: takeProfitPrice.toFixed(1)
        });
        
        return takeProfitPrice.toFixed(1);
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
            this.log('WARN', '获取实际持仓信息失败', { error: error.message });
            return null;
        }
    }
    
    /**
     * 下止盈单
     */
    async placeTakeProfitOrder(entryOrderId, entrySide, entryPrice, quantity) {
        try {
            // 获取账户实际持仓信息
            const actualPosition = await this.getActualPositionInfo();
            
            if (!actualPosition || actualPosition.positionValue === 0) {
                this.log('WARN', '当前无持仓，跳过止盈单', { entryOrderId });
                return null;
            }
            
            // 确保全局只有一个平仓单 - 取消所有现有平仓单
            if (this.closeOrders.size > 0) {
                this.log('INFO', '取消所有现有平仓单，重新下单', { 
                    closeOrdersCount: this.closeOrders.size
                });
                
                for (const [existingEntryOrderId, existingCloseOrder] of this.closeOrders) {
                    await this.cancelOrder(existingCloseOrder.id);
                }
                this.closeOrders.clear();
            }
            
            // 基于实际持仓信息计算止盈价格
            const takeProfitPrice = this.calculateTakeProfitPriceFromPosition(actualPosition);
            
            // 计算平仓方向（与实际持仓相反）
            // 如果是多头持仓(long)，需要卖出平仓(sell)
            // 如果是空头持仓(short)，需要买入平仓(buy)
            const closeSide = actualPosition.side === 'long' ? 'sell' : 'buy';
            
            // 转换side格式，就像 test.js 中一样
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
            const closeOrder = await this.client.placeOrder(
                this.config.symbol,
                closeApiSide,          // 'Bid' 或 'Ask'
                'Limit',               // 限价单
                actualPosition.netQuantity.toFixed(4),  // 使用实际持仓数量
                takeProfitPrice,       // 价格
                true                   // reduceOnly = true，仅平仓
            );
            
            if (closeOrder && closeOrder.length > 0) {
                const closeOrderData = closeOrder[0];
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
                    quantity: actualPosition.netQuantity,
                    positionValue: actualPosition.positionValue
                });
                
                // 记录到CSV
                this.logTrade({
                    symbol: this.config.symbol,
                    side: closeApiSide, // 直接使用 API side ('Bid' 或 'Ask')
                    orderType: 'Limit',
                    price: takeProfitPrice,
                    quantity,
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
                    this.log('INFO', '订单不在活跃列表中，处理完成', { orderId });
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
                        this.log('INFO', '订单已成交，处理完成', { orderId, status: currentOrder.status });
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
            this.log('ERROR', '监控订单失败', { error: error.message });
        }
    }
    
    /**
     * 处理开仓订单完成
     */
    async handleEntryOrderCompletion(orderId, orderData) {
        try {
            this.log('INFO', '开仓订单完成', { orderId, status: orderData.status });
            
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
            this.log('ERROR', '处理开仓订单完成失败', { orderId, error: error.message });
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
            
            this.closeOrders.delete(entryOrderId);
            
        } catch (error) {
            this.log('ERROR', '处理平仓订单完成失败', { entryOrderId, error: error.message });
        }
    }
    
    /**
     * 处理订单完成（保留原函数以兼容）
     */
    async handleOrderCompletion(orderId, orderData) {
        try {
            this.log('INFO', '订单完成', { orderId, status: orderData.status });
            
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
                this.log('INFO', '订单未达到止盈标准', { 
                    orderId, 
                    profit, 
                    profitTarget: this.config.profitTarget,
                    isProfitable: false
                });
                
                // 记录未盈利交易
                this.logTrade({
                    ...orderData,
                    status: 'Filled',
                    profit: profit.toFixed(4),
                    notes: `No profit (Target: ${this.config.profitTarget})`
                });
                
                // 未达到止盈标准时等待指定时间后开新单
                this.log('INFO', `订单未达到止盈标准，等待 ${this.config.orderWaitTime} 秒后开新单`, { 
                    orderId, 
                    profit, 
                    profitTarget: this.config.profitTarget,
                    waitTime: this.config.orderWaitTime 
                });
                
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

            // 检查是否达到最大成交订单数限制（基于实际账户持仓）
            const actualPosition = await this.getActualPositionInfo();
            if (actualPosition && actualPosition.positionValue > 0) {
                // 计算当前持仓对应的订单数量（基于订单金额）
                const positionOrderCount = Math.ceil(actualPosition.positionValue / this.config.orderAmount);
                
                if (positionOrderCount >= this.config.maxActiveOrders) {
                    this.log('INFO', '已达到最大成交订单数限制', {
                        positionValue: actualPosition.positionValue,
                        positionOrderCount,
                        maxActiveOrders: this.config.maxActiveOrders,
                        orderAmount: this.config.orderAmount
                    });
                    return;
                }
            }
            
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
                    this.log('INFO', '取消现有活跃订单', { orderId });
                    await this.cancelOrder(orderId);
                }

                // 清理活跃订单记录
                this.activeOrders.clear();

                // 等待一小段时间确保取消操作完成
                await this.sleep(500);
            }

            // 检查订单间等待时间
            const now = Date.now();
            const timeSinceLastOrder = now - this.lastOrderTime;
            const waitTime = this.config.orderWaitTime * 1000; // 转换为毫秒

            if (timeSinceLastOrder < waitTime) {
                const remainingTime = Math.ceil((waitTime - timeSinceLastOrder) / 1000);
                this.log('DEBUG', '订单间等待时间未到，跳过下单', { 
                    timeSinceLastOrder: Math.ceil(timeSinceLastOrder / 1000),
                    waitTime: this.config.orderWaitTime,
                    remainingTime
                });
                return;
            }

            this.log('INFO', '准备下新单', { 
                side, 
                apiSide,
                price, 
                quantity, 
                bid, 
                ask,
                activeOrders: this.activeOrders.size,
                timeSinceLastOrder: Math.ceil(timeSinceLastOrder / 1000)
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
        const runtime = this.stats.startTime ? Date.now() - this.stats.startTime : 0;
        const runtimeSeconds = Math.round(runtime / 1000);
        
        console.log('\n📊 账户持仓统计信息');
        console.log('================');
        console.log(`运行时间: ${runtimeSeconds} 秒`);
        console.log(`总盈利: ${this.stats.totalProfit.toFixed(4)} USDC`);
        
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
                    const positionValue = Math.abs(netQuantity) * markPrice;
                    const positionSide = netQuantity > 0 ? 'long' : netQuantity < 0 ? 'short' : 'flat';
                    
                    console.log(`\n🔹 ${position.symbol}:`);
                    console.log(`   持仓数量: ${Math.abs(netQuantity).toFixed(4)} (${positionSide})`);
                    console.log(`   持仓价值: ${positionValue.toFixed(2)} USDC`);
                    console.log(`   入仓价格: ${entryPrice.toFixed(1)} USDC`);
                    console.log(`   标记价格: ${markPrice.toFixed(1)} USDC`);
                    console.log(`   未实现盈亏: ${unrealizedPnl.toFixed(4)} USDC`);
                    console.log(`   已实现盈亏: ${realizedPnl.toFixed(4)} USDC`);
                }
            } else {
                console.log('📭 当前无持仓');
            }
        } catch (error) {
            // 检查是否是404错误（通常表示没有持仓）
            if (error.message && error.message.includes('404')) {
                console.log('📭 当前无持仓');
                this.log('DEBUG', '无持仓信息（404）', { error: error.message });
            } else {
                this.log('ERROR', '获取持仓信息失败', { error: error.message });
                console.log('❌ 无法获取持仓信息');
            }
        }
        
        console.log(`\n📋 订单状态:`);
        console.log(`   活跃开仓订单: ${this.activeOrders.size}`);
        console.log(`   活跃平仓订单: ${this.closeOrders.size}`);
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
        
        this.log('INFO', '🚀 剥头皮交易机器人启动', { config: this.config });
        
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
        profitTarget: parseFloat(process.env.PROFIT_TARGET) || 0.01,
        orderWaitTime: parseInt(process.env.ORDER_WAIT_TIME) || 450,
        maxActiveOrders: parseInt(process.env.MAX_ACTIVE_ORDERS) || 40,
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
