/**
 * Backpack 速刷合约交易机器人
 * 
 * 功能特性：
 * - 限价开仓 + 市价关仓的快速交易循环
 * - WebSocket 实时价格监控
 * - 双重波动风控机制
 * - 完整交易次数限制
 * - 详细日志记录
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const BackpackClient = require('./backpack-client.js');

/**
 * 价格历史管理器
 * 用于波动风控的价格变化监控
 */
class PriceHistoryManager {
    constructor() {
        this.priceHistory = []; // {timestamp, price}
    }
    
    /**
     * 添加价格记录
     * @param {number} price - 价格
     */
    addPrice(price) {
        const now = Date.now();
        this.priceHistory.push({ timestamp: now, price: parseFloat(price) });
        
        // 清理超过30分钟的历史数据
        const cutoffTime = now - (30 * 60 * 1000);
        this.priceHistory = this.priceHistory.filter(record => record.timestamp > cutoffTime);
    }
    
    /**
     * 获取指定时间窗口内的价格变化百分比
     * @param {number} timeWindowMinutes - 时间窗口（分钟）
     * @returns {number} 价格变化百分比
     */
    getPriceChangePercent(timeWindowMinutes) {
        if (this.priceHistory.length < 2) return 0;
        
        const now = Date.now();
        const windowStart = now - (timeWindowMinutes * 60 * 1000);
        
        // 获取时间窗口内的价格数据
        const windowPrices = this.priceHistory.filter(record => record.timestamp >= windowStart);
        if (windowPrices.length < 2) return 0;
        
        const oldestPrice = windowPrices[0].price;
        const latestPrice = windowPrices[windowPrices.length - 1].price;
        
        return Math.abs((latestPrice - oldestPrice) / oldestPrice);
    }
    
    /**
     * 获取最新价格
     * @returns {number} 最新价格
     */
    getLatestPrice() {
        if (this.priceHistory.length === 0) return null;
        return this.priceHistory[this.priceHistory.length - 1].price;
    }
}

/**
 * 速刷合约交易机器人
 */
class VolumeBot {
    constructor(config = {}) {
        // 配置
        this.config = {
            // API 配置
            apiKey: config.api?.apiKey,
            privateKey: config.api?.privateKey,
            
            // 交易配置
            symbol: config.volumeTrading?.symbol || 'BTC_USDC_PERP',
            orderAmount: config.volumeTrading?.orderAmount || 100,
            limitOrderSide: config.volumeTrading?.limitOrderSide || 'buy',
            maxTrades: config.volumeTrading?.maxTrades || 1000,
            
            // 手续费配置
            makerFee: config.volumeTrading?.fees?.maker || 0.0001,
            takerFee: config.volumeTrading?.fees?.taker || 0.00026,
            
            // 波动风控配置
            volatility1: config.volatilityControl?.volatility1 || {
                timeWindow: 1,
                priceChangeThreshold: 0.02,
                pauseDuration: 5
            },
            volatility2: config.volatilityControl?.volatility2 || {
                timeWindow: 5,
                priceChangeThreshold: 0.05,
                pauseDuration: 15
            },
            
            // WebSocket 配置
            wsUrl: config.websocket?.url || 'wss://ws.backpack.exchange',
            reconnectInterval: config.websocket?.reconnectInterval || 5000,
            maxReconnectAttempts: config.websocket?.maxReconnectAttempts || 10,
            
            // 日志配置
            logLevel: config.logging?.level || 'INFO',
            enableCsvLog: config.logging?.enableCsvLog !== false,
            enableFileLog: config.logging?.enableFileLog !== false,
            
            // 测试模式
            testMode: config.testMode?.enabled || false,
            stopOnError: config.testMode?.stopOnError || false
        };
        
        // 状态管理
        this.isRunning = false;
        this.isPaused = false;
        this.pauseReason = null;
        this.pauseUntil = null;
        this.completedTrades = 0;
        this.currentLimitOrder = null;
        this.isProcessingTrade = false;
        this.isClosingPosition = false; // 是否正在平仓
        this.priceDataReady = false; // 价格数据是否就绪
        
        // WebSocket 连接
        this.ws = null;
        this.reconnectAttempts = 0;
        this.lastPingTime = null;
        
        // 价格历史管理
        this.priceHistory = new PriceHistoryManager();
        
        // API 客户端
        this.client = new BackpackClient(this.config.apiKey, this.config.privateKey);
        
        // 日志文件路径
        this.setupLogPaths();
        
        // 绑定事件处理
        this.setupEventHandlers();
    }
    
    /**
     * 设置日志文件路径
     */
    setupLogPaths() {
        const today = new Date().toISOString().split('T')[0];
        this.csvLogPath = path.join('logs', `volume_trades_${today}.csv`);
        this.debugLogPath = path.join('logs', `volume_debug_${today}.log`);
        
        // 确保日志目录存在
        if (!fs.existsSync('logs')) {
            fs.mkdirSync('logs', { recursive: true });
        }
        
        // 创建CSV日志头部
        if (this.config.enableCsvLog && !fs.existsSync(this.csvLogPath)) {
            const csvHeader = 'timestamp,trade_number,limit_order_id,market_order_id,side,price,quantity,status,profit_loss,notes\n';
            fs.writeFileSync(this.csvLogPath, csvHeader);
        }
    }
    
    /**
     * 设置事件处理器
     */
    setupEventHandlers() {
        // 优雅关闭
        process.on('SIGINT', () => {
            this.log('INFO', '接收到关闭信号，正在安全关闭机器人...');
            this.shutdown();
        });
        
        process.on('SIGTERM', () => {
            this.log('INFO', '接收到终止信号，正在安全关闭机器人...');
            this.shutdown();
        });
    }
    
    /**
     * 日志记录
     * @param {string} level - 日志级别
     * @param {string} message - 日志消息
     * @param {object} data - 附加数据
     */
    log(level, message, data = {}) {
        const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        const logMessage = `[${timestamp}] [${level}] ${message}`;
        
        // 控制台输出
        if (this.shouldLog(level)) {
            if (Object.keys(data).length > 0) {
                console.log(logMessage, data);
            } else {
                console.log(logMessage);
            }
        }
        
        // 文件日志
        if (this.config.enableFileLog) {
            const fileMessage = Object.keys(data).length > 0 
                ? `${logMessage} ${JSON.stringify(data)}\n`
                : `${logMessage}\n`;
            fs.appendFileSync(this.debugLogPath, fileMessage);
        }
    }
    
    /**
     * 判断是否应该记录日志
     * @param {string} level - 日志级别
     * @returns {boolean}
     */
    shouldLog(level) {
        const levels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
        return levels[level] >= levels[this.config.logLevel];
    }
    
    /**
     * 记录交易到CSV
     * @param {object} tradeData - 交易数据
     */
    logTradeToCsv(tradeData) {
        if (!this.config.enableCsvLog) return;
        
        const {
            tradeNumber,
            limitOrderId,
            marketOrderId,
            side,
            price,
            quantity,
            status,
            profitLoss,
            notes
        } = tradeData;
        
        const timestamp = new Date().toISOString();
        const csvLine = `${timestamp},${tradeNumber},${limitOrderId || ''},${marketOrderId || ''},${side},${price || ''},${quantity || ''},${status},${profitLoss || ''},${notes || ''}\n`;
        
        fs.appendFileSync(this.csvLogPath, csvLine);
    }
    
    /**
     * 启动机器人
     */
    async start() {
        try {
            this.log('INFO', '🚀 启动速刷合约交易机器人');
            this.log('INFO', '配置信息', {
                symbol: this.config.symbol,
                orderAmount: this.config.orderAmount,
                limitOrderSide: this.config.limitOrderSide,
                maxTrades: this.config.maxTrades,
                volatility1Threshold: this.config.volatility1.priceChangeThreshold,
                volatility2Threshold: this.config.volatility2.priceChangeThreshold
            });
            
            // 验证API连接
            await this.validateApiConnection();
            
            // 连接WebSocket
            await this.connectWebSocket();
            
            // 开始交易循环
            this.isRunning = true;
            this.startTradingLoop();
            
            this.log('INFO', '✅ 机器人启动成功，开始监控市场...');
            
        } catch (error) {
            this.log('ERROR', '启动失败', { error: error.message });
            throw error;
        }
    }
    
    /**
     * 验证API连接
     */
    async validateApiConnection() {
        try {
            this.log('INFO', '验证API连接...');
            const balance = await this.client.getBalances();
            
            // 检查API响应
            if (!balance || !Array.isArray(balance)) {
                throw new Error('API返回的余额数据格式不正确');
            }
            
            this.log('INFO', '✅ API连接验证成功');
            this.log('DEBUG', '账户余额信息', { balanceCount: balance.length });
            
            // 检查USDC余额
            const usdcBalances = balance.filter(b => 
                b.token && (b.token === 'USDC' || b.token.includes('USDC'))
            );
            
            if (usdcBalances.length === 0) {
                this.log('WARN', '未找到USDC余额，显示所有余额信息', { balance });
                throw new Error('未找到USDC余额');
            }
            
            const availableUSDC = usdcBalances.reduce((sum, b) => sum + parseFloat(b.available), 0);
            this.log('INFO', `USDC钱包余额: ${availableUSDC.toFixed(2)} USDC`);
            
            // 检查抵押品余额（包括借贷中的资金）
            let totalUSDC = availableUSDC;
            this.log('INFO', '检查抵押品余额（包括借贷资金）...');
            try {
                const collateral = await this.client.signedRequest('GET', '/api/v1/capital/collateral', 'collateralQuery');
                const usdcCollateral = collateral.collateral?.find(c => c.symbol === 'USDC');
                if (usdcCollateral) {
                    const totalQuantity = parseFloat(usdcCollateral.totalQuantity || '0');
                    const lendQuantity = parseFloat(usdcCollateral.lendQuantity || '0');
                    const availableQuantity = parseFloat(usdcCollateral.availableQuantity || '0');
                    const collateralValue = parseFloat(usdcCollateral.collateralValue || '0');
                    
                    // Backpack交易所中，借贷资金也可用于交易
                    // 使用总数量作为可用资金
                    totalUSDC = totalQuantity;
                    
                    this.log('INFO', `💰 USDC资金详情:`, {
                        钱包余额: availableUSDC.toFixed(2),
                        借贷余额: lendQuantity.toFixed(2),
                        可用总额: totalQuantity.toFixed(2),
                        抵押品价值: collateralValue.toFixed(2)
                    });
                    
                    if (lendQuantity > 0) {
                        this.log('INFO', `✅ 检测到 ${lendQuantity.toFixed(2)} USDC 在借贷中，可用于交易`);
                    }
                } else {
                    this.log('WARN', '未找到USDC抵押品信息');
                }
            } catch (error) {
                this.log('WARN', '获取抵押品信息失败', { error: error.message });
                this.log('INFO', '使用钱包余额作为可用资金');
            }
            
            this.log('INFO', `💵 USDC总可用资金: ${totalUSDC.toFixed(2)} USDC`);
            
            if (totalUSDC < this.config.orderAmount) {
                if (this.config.testMode) {
                    this.log('WARN', `⚠️ 测试模式: USDC余额不足，当前: ${totalUSDC.toFixed(2)} USDC，需要: ${this.config.orderAmount} USDC`);
                    this.log('INFO', '🧪 测试模式已启用，将跳过余额检查继续运行（不会真实下单）');
                } else {
                    this.log('WARN', `USDC余额不足，当前: ${totalUSDC.toFixed(2)} USDC，需要: ${this.config.orderAmount} USDC`);
                    this.log('INFO', '💡 提示: 请向账户充值USDC后再启动速刷机器人');
                    this.log('INFO', '🧪 或者使用 --test-mode 参数进行测试');
                    throw new Error(`USDC余额不足，当前: ${totalUSDC.toFixed(2)} USDC，需要: ${this.config.orderAmount} USDC`);
                }
            }
            
        } catch (error) {
            this.log('ERROR', 'API连接验证失败', { error: error.message });
            throw error;
        }
    }
    
    /**
     * 连接WebSocket
     */
    async connectWebSocket() {
        return new Promise((resolve, reject) => {
            try {
                this.log('INFO', '连接WebSocket...');
                
                this.ws = new WebSocket(this.config.wsUrl);
                
                this.ws.on('open', () => {
                    this.log('INFO', '✅ WebSocket连接成功');
                    this.reconnectAttempts = 0;
                    
                    // 订阅价格流
                    this.subscribeToStreams();
                    
                    // 启动心跳
                    this.startHeartbeat();
                    
                    resolve();
                });
                
                this.ws.on('message', (data) => {
                    this.handleWebSocketMessage(data);
                });
                
                this.ws.on('close', (code, reason) => {
                    this.log('WARN', 'WebSocket连接关闭', { code, reason: reason.toString() });
                    this.handleWebSocketClose();
                });
                
                this.ws.on('error', (error) => {
                    this.log('ERROR', 'WebSocket错误', { error: error.message });
                    reject(error);
                });
                
                this.ws.on('pong', () => {
                    this.lastPingTime = null;
                });
                
            } catch (error) {
                this.log('ERROR', 'WebSocket连接失败', { error: error.message });
                reject(error);
            }
        });
    }
    
    /**
     * 订阅WebSocket流
     */
    subscribeToStreams() {
        // 订阅ticker流获取实时价格
        const tickerStream = `ticker.${this.config.symbol}`;
        
        const subscribeMessage = {
            method: 'SUBSCRIBE',
            params: [tickerStream]
        };
        
        this.ws.send(JSON.stringify(subscribeMessage));
        this.log('INFO', '订阅价格流', { stream: tickerStream });
    }
    
    /**
     * 启动心跳
     */
    startHeartbeat() {
        setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                if (this.lastPingTime && Date.now() - this.lastPingTime > this.config.pongTimeout) {
                    this.log('WARN', 'WebSocket心跳超时，重新连接');
                    this.ws.close();
                    return;
                }
                
                this.lastPingTime = Date.now();
                this.ws.ping();
            }
        }, 30000); // 30秒心跳
    }
    
    /**
     * 处理WebSocket消息
     * @param {Buffer} data - 消息数据
     */
    handleWebSocketMessage(data) {
        try {
            const message = JSON.parse(data.toString());
            
            if (message.stream && message.stream.startsWith('ticker.')) {
                this.handleTickerUpdate(message.data);
            }
            
        } catch (error) {
            this.log('ERROR', 'WebSocket消息解析失败', { error: error.message });
        }
    }
    
    /**
     * 处理价格更新
     * @param {object} tickerData - 价格数据
     */
    handleTickerUpdate(tickerData) {
        // 从WebSocket ticker数据中获取当前价格 (字段名为 'c')
        const price = parseFloat(tickerData.c);
        
        if (!price || isNaN(price)) {
            this.log('WARN', '无效的价格数据', { tickerData });
            return;
        }
        
        this.priceHistory.addPrice(price);
        this.lastTicker = tickerData;
        
        // 标记价格数据已就绪
        if (!this.priceDataReady) {
            this.priceDataReady = true;
            this.log('INFO', '✅ 价格数据已就绪，可以开始交易');
        }
        
        this.log('DEBUG', '价格更新', {
            symbol: tickerData.s,
            price: price,
            volume: tickerData.v,
            high: parseFloat(tickerData.h),
            low: parseFloat(tickerData.l)
        });
        
        // 检查波动风控
        this.checkVolatilityControl();
    }
    
    /**
     * 检查波动风控
     */
    checkVolatilityControl() {
        if (this.isPaused) return;
        
        // 检查1分钟波动
        const change1min = this.priceHistory.getPriceChangePercent(this.config.volatility1.timeWindow);
        if (change1min > this.config.volatility1.priceChangeThreshold) {
            this.pauseTrading('volatility1', this.config.volatility1.pauseDuration, change1min);
            return;
        }
        
        // 检查5分钟波动
        const change5min = this.priceHistory.getPriceChangePercent(this.config.volatility2.timeWindow);
        if (change5min > this.config.volatility2.priceChangeThreshold) {
            this.pauseTrading('volatility2', this.config.volatility2.pauseDuration, change5min);
            return;
        }
    }
    
    /**
     * 暂停交易
     * @param {string} reason - 暂停原因
     * @param {number} durationMinutes - 暂停时长（分钟）
     * @param {number} changePercent - 价格变化百分比
     */
    pauseTrading(reason, durationMinutes, changePercent) {
        this.isPaused = true;
        this.pauseReason = reason;
        this.pauseUntil = Date.now() + (durationMinutes * 60 * 1000);
        
        this.log('WARN', `⚠️ 触发波动风控，暂停交易`, {
            reason: reason,
            priceChange: `${(changePercent * 100).toFixed(2)}%`,
            pauseDuration: `${durationMinutes}分钟`,
            resumeTime: new Date(this.pauseUntil).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
        });
        
        // 取消当前限价订单
        if (this.currentLimitOrder) {
            this.cancelCurrentLimitOrder('波动风控暂停');
        }
    }
    
    /**
     * 检查是否可以恢复交易
     */
    checkResumeTrading() {
        if (!this.isPaused) return;
        
        if (Date.now() >= this.pauseUntil) {
            // 检查当前波动是否已经降低
            const currentChange = this.pauseReason === 'volatility1' 
                ? this.priceHistory.getPriceChangePercent(this.config.volatility1.timeWindow)
                : this.priceHistory.getPriceChangePercent(this.config.volatility2.timeWindow);
            
            const threshold = this.pauseReason === 'volatility1'
                ? this.config.volatility1.priceChangeThreshold
                : this.config.volatility2.priceChangeThreshold;
            
            if (currentChange <= threshold) {
                this.isPaused = false;
                this.pauseReason = null;
                this.pauseUntil = null;
                
                this.log('INFO', '✅ 波动降低，恢复交易', {
                    currentChange: `${(currentChange * 100).toFixed(2)}%`,
                    threshold: `${(threshold * 100).toFixed(2)}%`
                });
            } else {
                // 延长暂停时间
                const extendMinutes = this.pauseReason === 'volatility1' ? 5 : 15;
                this.pauseUntil = Date.now() + (extendMinutes * 60 * 1000);
                
                this.log('WARN', '波动仍然过高，延长暂停时间', {
                    currentChange: `${(currentChange * 100).toFixed(2)}%`,
                    extendMinutes: extendMinutes
                });
            }
        }
    }
    
    /**
     * 处理WebSocket关闭
     */
    handleWebSocketClose() {
        if (this.isRunning && this.reconnectAttempts < this.config.maxReconnectAttempts) {
            this.reconnectAttempts++;
            this.log('INFO', `尝试重新连接WebSocket (${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`);
            
            setTimeout(() => {
                this.connectWebSocket().catch(error => {
                    this.log('ERROR', 'WebSocket重连失败', { error: error.message });
                });
            }, this.config.reconnectInterval);
        } else {
            this.log('ERROR', 'WebSocket连接失败，超过最大重试次数');
            this.shutdown();
        }
    }
    
    /**
     * 开始交易循环
     */
    startTradingLoop() {
        const loop = async () => {
            if (!this.isRunning) return;
            
            try {
                // 检查是否可以恢复交易
                this.checkResumeTrading();
                
                // 检查交易次数限制
                if (this.completedTrades >= this.config.maxTrades) {
                    this.log('INFO', `✅ 已完成 ${this.completedTrades} 次交易，达到上限，停止交易`);
                    this.shutdown();
                    return;
                }
                
                // 如果没有暂停且没有正在处理交易，且价格数据已就绪，且没有正在平仓，开始新的交易
                if (!this.isPaused && !this.isProcessingTrade && !this.currentLimitOrder && !this.isClosingPosition && this.priceDataReady) {
                    await this.startNewTrade();
                } else if (!this.priceDataReady) {
                    this.log('DEBUG', '等待价格数据就绪...');
                } else if (this.isClosingPosition) {
                    this.log('DEBUG', '正在平仓中，等待平仓完成...');
                }
                
            } catch (error) {
                this.log('ERROR', '交易循环错误', { error: error.message });
            }
            
            // 继续循环
            setTimeout(loop, 1000); // 1秒检查一次
        };
        
        loop();
    }
    
    /**
     * 开始新的交易
     */
    async startNewTrade() {
        try {
            this.isProcessingTrade = true;
            
            this.log('INFO', `🔄 开始第 ${this.completedTrades + 1} 次交易`);
            
            // 获取限价订单价格（使用买1/卖1价格）
            const limitPrice = await this.getLimitOrderPrice();
            
            if (!limitPrice || isNaN(limitPrice)) {
                this.log('ERROR', '获取限价订单价格失败', { limitPrice });
                
                // 测试模式下遇到错误立即停止
                if (this.config.stopOnError) {
                    this.log('ERROR', '测试模式：价格获取失败，立即停止');
                    process.exit(1);
                }
                
                this.isProcessingTrade = false;
                return;
            }
            
            this.log('INFO', '获取到限价订单价格', { limitPrice, side: this.config.limitOrderSide });
            
            // 下限价订单
            await this.placeLimitOrder(limitPrice);
            
        } catch (error) {
            this.log('ERROR', '开始新交易失败', { error: error.message });
            
            // 测试模式下遇到错误立即停止
            if (this.config.stopOnError) {
                this.log('ERROR', '测试模式：交易失败，立即停止');
                process.exit(1);
            }
            
            this.isProcessingTrade = false;
        }
    }
    
    /**
     * 获取买1/卖1价格作为限价订单价格
     * @returns {Promise<number>} 限价订单价格
     */
    async getLimitOrderPrice() {
        try {
            // 获取买1卖1价格
            const bestPrices = await this.client.getBestPrices(this.config.symbol);
            
            if (!bestPrices.bestBid || !bestPrices.bestAsk) {
                throw new Error('无法获取买1卖1价格');
            }
            
            const bidPrice = parseFloat(bestPrices.bestBid[0]);
            const askPrice = parseFloat(bestPrices.bestAsk[0]);
            
            this.log('INFO', '获取买1卖1价格', {
                bid: bidPrice,
                ask: askPrice,
                side: this.config.limitOrderSide
            });
            
            // 根据挂单方向选择价格，避免立即成交
            if (this.config.limitOrderSide === 'buy') {
                // 买单使用略低于买1的价格，避免立即成交
                const adjustedPrice = bidPrice * 0.9999; // 降低0.01%
                this.log('DEBUG', '调整买单价格避免立即成交', {
                    originalBid: bidPrice,
                    adjustedPrice: adjustedPrice
                });
                return adjustedPrice;
            } else {
                // 卖单使用略高于卖1的价格，避免立即成交
                const adjustedPrice = askPrice * 1.0001; // 提高0.01%
                this.log('DEBUG', '调整卖单价格避免立即成交', {
                    originalAsk: askPrice,
                    adjustedPrice: adjustedPrice
                });
                return adjustedPrice;
            }
            
        } catch (error) {
            this.log('ERROR', '获取限价订单价格失败', { error: error.message });
            
            // 测试模式下遇到错误立即停止
            if (this.config.stopOnError) {
                this.log('ERROR', '测试模式：遇到错误，立即停止');
                process.exit(1);
            }
            
            throw error;
        }
    }
    
    /**
     * 下限价订单
     * @param {number} price - 订单价格
     */
    async placeLimitOrder(price) {
        try {
            this.log('INFO', '下单参数计算', {
                inputPrice: price,
                orderAmount: this.config.orderAmount
            });
            
            // 计算订单数量
            const quantity = this.config.orderAmount / price;
            
            this.log('INFO', '计算订单数量', {
                quantity: quantity,
                isNaN: isNaN(quantity)
            });
            
            // 获取交易对精度
            const markets = await this.client.getMarkets();
            const market = markets.find(m => m.symbol === this.config.symbol);
            if (!market) {
                throw new Error(`找不到交易对 ${this.config.symbol}`);
            }
            
            // 从市场数据中获取精度信息
            const tickSize = parseFloat(market.filters?.price?.tickSize || '0.01');
            const stepSize = parseFloat(market.filters?.quantity?.stepSize || '0.0001');
            
            this.log('INFO', '交易对精度信息', {
                symbol: market.symbol,
                tickSize: tickSize,
                stepSize: stepSize
            });
            
            // 调整精度
            const adjustedQuantity = this.adjustQuantityPrecision(quantity, stepSize);
            const adjustedPrice = this.adjustPricePrecision(price, tickSize);
            
            this.log('INFO', '精度调整结果', {
                originalPrice: price,
                adjustedPrice: adjustedPrice,
                originalQuantity: quantity,
                adjustedQuantity: adjustedQuantity
            });
            
            this.log('INFO', '下限价订单', {
                side: this.config.limitOrderSide,
                price: adjustedPrice,
                quantity: adjustedQuantity,
                amount: adjustedPrice * adjustedQuantity
            });
            
            // 下单
            const order = await this.client.placeOrder(
                this.config.symbol,
                this.config.limitOrderSide === 'buy' ? 'Bid' : 'Ask',
                'Limit',
                adjustedQuantity.toString(),
                adjustedPrice.toString(),
                false, // reduceOnly = false (开仓订单)
                true   // postOnly = true (仅挂单)
            );
            
            // 检查订单是否创建成功
            if (!order || !Array.isArray(order) || !order[0] || !order[0].id || order[0].operation !== 'Ok') {
                this.log('WARN', '限价订单创建失败，可能会立即成交，重新调整价格', { order });
                
                // 测试模式下遇到错误立即停止
                if (this.config.stopOnError) {
                    this.log('ERROR', '测试模式：订单创建失败，立即停止');
                    process.exit(1);
                }
                
                // 重新获取价格并调整
                setTimeout(async () => {
                    this.log('INFO', '🔄 重新尝试创建限价订单');
                    await this.startNewTrade();
                }, 2000); // 2秒后重试
                
                this.isProcessingTrade = false;
                return;
            }
            
            const orderInfo = order[0];
            this.currentLimitOrder = {
                orderId: orderInfo.id,
                side: this.config.limitOrderSide,
                price: adjustedPrice,
                quantity: adjustedQuantity,
                timestamp: Date.now()
            };
            
            this.log('INFO', '✅ 限价订单创建成功', {
                orderId: orderInfo.id,
                side: this.config.limitOrderSide,
                price: adjustedPrice,
                quantity: adjustedQuantity,
                status: orderInfo.status
            });
            
            // 记录到CSV
            this.logTradeToCsv({
                tradeNumber: this.completedTrades + 1,
                limitOrderId: orderInfo.id,
                side: this.config.limitOrderSide,
                price: adjustedPrice,
                quantity: adjustedQuantity,
                status: 'limit_placed',
                notes: '限价订单已下达'
            });
            
            // 开始监控订单状态
            this.monitorLimitOrder();
            
        } catch (error) {
            this.log('ERROR', '下限价订单失败', { error: error.message });
            this.isProcessingTrade = false;
            
            // 测试模式下遇到错误立即停止
            if (this.config.stopOnError) {
                this.log('ERROR', '测试模式：下单失败，立即停止');
                process.exit(1);
            }
            
            // 记录失败到CSV
            this.logTradeToCsv({
                tradeNumber: this.completedTrades + 1,
                status: 'limit_failed',
                notes: `限价订单失败: ${error.message}`
            });
        }
    }
    
    /**
     * 监控限价订单状态（通过持仓变化检测成交）
     */
    monitorLimitOrder() {
        const startTime = Date.now();
        const timeoutDuration = 10000; // 10秒超时
        let initialPosition = null;
        
        // 记录初始持仓状态
        this.getInitialPosition().then(position => {
            initialPosition = position;
            this.log('DEBUG', '记录初始持仓状态', {
                netQuantity: initialPosition ? initialPosition.netQuantity : '0',
                hasPosition: !!initialPosition
            });
        });
        
        const checkInterval = setInterval(async () => {
            try {
                if (!this.currentLimitOrder) {
                    clearInterval(checkInterval);
                    return;
                }
                
                // 检查是否超时（10秒未成交）
                const elapsed = Date.now() - startTime;
                if (elapsed > timeoutDuration) {
                    clearInterval(checkInterval);
                    this.log('INFO', '限价订单10秒未成交，重新调整价格', {
                        orderId: this.currentLimitOrder.orderId,
                        elapsed: `${elapsed}ms`
                    });
                    
                    // 取消当前订单
                    try {
                        await this.client.cancelOrder(this.currentLimitOrder.orderId, this.config.symbol);
                        this.log('INFO', '已取消超时的限价订单');
                    } catch (cancelError) {
                        this.log('WARN', '取消订单失败', { error: cancelError.message });
                    }
                    
                    // 重新创建订单
                    this.currentLimitOrder = null;
                    setTimeout(async () => {
                        this.log('INFO', '🔄 重新创建限价订单（10秒超时）');
                        await this.startNewTrade();
                    }, 1000); // 1秒后重试
                    
                    return;
                }
                
                // 通过持仓变化检测订单是否成交
                const currentPosition = await this.getCurrentPosition();
                
                // 检测持仓是否发生变化
                const positionChanged = this.hasPositionChanged(initialPosition, currentPosition);
                
                if (positionChanged) {
                    // 持仓发生变化，说明订单已成交
                    clearInterval(checkInterval);
                    this.log('INFO', '🎉 检测到持仓变化，限价订单已成交，立即下市价平仓订单', {
                        orderId: this.currentLimitOrder.orderId,
                        side: this.currentLimitOrder.side,
                        price: this.currentLimitOrder.price,
                        quantity: this.currentLimitOrder.quantity,
                        initialPosition: initialPosition ? initialPosition.netQuantity : '0',
                        currentPosition: currentPosition ? currentPosition.netQuantity : '0'
                    });
                    
                    // 保存限价订单信息用于平仓
                    const limitOrderInfo = { ...this.currentLimitOrder };
                    
                    // 清除限价订单状态，设置平仓状态
                    this.currentLimitOrder = null;
                    this.isProcessingTrade = false;
                    this.isClosingPosition = true;
                    
                    await this.placeMarketCloseOrder(limitOrderInfo);
                    
                } else {
                    // 持仓未变化，订单未成交，继续监控
                    this.log('DEBUG', '持仓未变化，限价订单未成交，继续监控', {
                        orderId: this.currentLimitOrder.orderId,
                        elapsed: `${Date.now() - startTime}ms`,
                        currentPosition: currentPosition ? currentPosition.netQuantity : '0'
                    });
                }
                
            } catch (error) {
                this.log('ERROR', '监控限价订单失败', { error: error.message });
            }
        }, 1000); // 每秒检查一次
    }
    
    /**
     * 获取初始持仓状态
     * @returns {Promise<object|null>} 持仓信息
     */
    async getInitialPosition() {
        try {
            const positions = await this.client.getPositions();
            return positions.find(p => p.symbol === this.config.symbol) || null;
        } catch (error) {
            this.log('ERROR', '获取初始持仓失败', { error: error.message });
            return null;
        }
    }
    
    /**
     * 获取当前持仓状态
     * @returns {Promise<object|null>} 持仓信息
     */
    async getCurrentPosition() {
        try {
            const positions = await this.client.getPositions();
            return positions.find(p => p.symbol === this.config.symbol) || null;
        } catch (error) {
            this.log('ERROR', '获取当前持仓失败', { error: error.message });
            return null;
        }
    }
    
    /**
     * 检测持仓是否发生变化
     * @param {object|null} initialPosition - 初始持仓
     * @param {object|null} currentPosition - 当前持仓
     * @returns {boolean} 是否发生变化
     */
    hasPositionChanged(initialPosition, currentPosition) {
        const initialQuantity = initialPosition ? parseFloat(initialPosition.netQuantity) : 0;
        const currentQuantity = currentPosition ? parseFloat(currentPosition.netQuantity) : 0;
        
        // 检测数量是否发生变化（考虑浮点精度）
        const quantityChanged = Math.abs(currentQuantity - initialQuantity) > 0.0001;
        
        this.log('DEBUG', '持仓变化检测', {
            initialQuantity: initialQuantity,
            currentQuantity: currentQuantity,
            difference: currentQuantity - initialQuantity,
            changed: quantityChanged
        });
        
        return quantityChanged;
    }
    
    /**
     * 下市价关仓订单
     * @param {object} limitOrderInfo - 限价订单信息
     */
    async placeMarketCloseOrder(limitOrderInfo) {
        try {
            if (!limitOrderInfo) {
                this.log('ERROR', '没有限价订单信息，无法平仓');
                this.isClosingPosition = false;
                return;
            }
            
            const limitOrder = limitOrderInfo;
            
            // 确定关仓方向（与开仓相反）
            const closeSide = limitOrder.side === 'buy' ? 'sell' : 'buy';
            
            this.log('INFO', '下市价关仓订单', {
                side: closeSide,
                quantity: limitOrder.quantity
            });
            
            // 下市价订单
            const order = await this.client.placeOrder(
                this.config.symbol,
                closeSide === 'buy' ? 'Bid' : 'Ask',
                'Market',
                limitOrder.quantity.toString()
            );
            
            // 检查市价订单是否创建成功
            if (!order || !Array.isArray(order) || !order[0] || !order[0].id || order[0].operation !== 'Ok') {
                throw new Error('市价订单创建失败');
            }
            
            const marketOrderInfo = order[0];
            this.log('INFO', '✅ 市价关仓订单创建成功', {
                orderId: marketOrderInfo.id,
                side: closeSide,
                quantity: limitOrder.quantity,
                status: marketOrderInfo.status
            });
            
            // 等待市价订单成交
            await this.waitForMarketOrderFill(marketOrderInfo.id, limitOrder, marketOrderInfo.status);
            
        } catch (error) {
            this.log('ERROR', '下市价关仓订单失败', { error: error.message });
            
            // 测试模式下遇到错误立即停止
            if (this.config.stopOnError) {
                this.log('ERROR', '测试模式：市价平仓失败，立即停止');
                process.exit(1);
            }
            
            // 记录失败到CSV
            this.logTradeToCsv({
                tradeNumber: this.completedTrades + 1,
                limitOrderId: limitOrderInfo?.orderId,
                status: 'market_failed',
                notes: `市价关仓失败: ${error.message}`
            });
            
            // 重置状态，允许开始新的交易
            this.isClosingPosition = false;
            this.isProcessingTrade = false;
        }
    }
    
    /**
     * 等待市价订单成交
     * @param {string} marketOrderId - 市价订单ID
     * @param {object} limitOrder - 限价订单信息
     * @param {string} initialStatus - 订单初始状态
     */
    async waitForMarketOrderFill(marketOrderId, limitOrder, initialStatus = null) {
        // 如果订单创建时状态已经是 'Filled'，直接处理
        if (initialStatus === 'Filled') {
            this.handleMarketOrderFilled(marketOrderId, limitOrder);
            return;
        }
        
        let attempts = 0;
        const maxAttempts = 30; // 最多等待30秒
        
        while (attempts < maxAttempts) {
            try {
                const order = await this.client.getOrder(marketOrderId, this.config.symbol);
                
                if (order.status === 'Filled') {
                    this.handleMarketOrderFilled(marketOrderId, limitOrder);
                    return;
                }
                
                // 等待1秒后重试
                await new Promise(resolve => setTimeout(resolve, 1000));
                attempts++;
                
            } catch (error) {
                // 如果是404错误，说明订单已经不在订单簿中（可能已成交）
                if (error.message.includes('404')) {
                    this.log('INFO', '订单已从订单簿移除，可能已成交', { 
                        marketOrderId: marketOrderId 
                    });
                    
                    // 尝试通过历史订单查询确认状态
                    try {
                        const historyOrders = await this.client.getOrderHistory({
                            orderId: marketOrderId,
                            symbol: this.config.symbol
                        });
                        
                        if (historyOrders && historyOrders.length > 0) {
                            const historyOrder = historyOrders[0];
                            if (historyOrder.status === 'Filled') {
                                this.handleMarketOrderFilled(marketOrderId, limitOrder);
                                return;
                            }
                        }
                    } catch (historyError) {
                        this.log('WARN', '查询历史订单失败', { 
                            error: historyError.message 
                        });
                    }
                    
                    // 如果无法确认状态，假设已成交
                    this.handleMarketOrderFilled(marketOrderId, limitOrder);
                    return;
                }
                
                this.log('ERROR', '查询市价订单状态失败', { error: error.message });
                
                // 等待1秒后重试
                await new Promise(resolve => setTimeout(resolve, 1000));
                attempts++;
            }
        }
        
        // 超时处理
        this.log('WARN', '市价订单成交超时', { 
            marketOrderId: marketOrderId,
            attempts: attempts 
        });
        
        // 重置状态，允许开始新的交易
        this.isClosingPosition = false;
        this.isProcessingTrade = false;
    }
    
    /**
     * 处理市价订单成交
     * @param {string} marketOrderId - 市价订单ID
     * @param {object} limitOrder - 限价订单信息
     */
    handleMarketOrderFilled(marketOrderId, limitOrder) {
        // 市价订单已成交，完成一次完整交易
        this.completedTrades++;
        
        // 计算盈亏
        const profitLoss = this.calculateProfitLoss(limitOrder, { orderId: marketOrderId });
        
        this.log('INFO', `✅ 第 ${this.completedTrades} 次交易完成`, {
            limitOrderId: limitOrder.orderId,
            marketOrderId: marketOrderId,
            profitLoss: profitLoss,
            totalTrades: this.completedTrades,
            remaining: this.config.maxTrades - this.completedTrades
        });
        
        // 记录到CSV
        this.logTradeToCsv({
            tradeNumber: this.completedTrades,
            limitOrderId: limitOrder.orderId,
            marketOrderId: marketOrderId,
            side: `${limitOrder.side}→${limitOrder.side === 'buy' ? 'sell' : 'buy'}`,
            price: `${limitOrder.price}→market`,
            quantity: limitOrder.quantity,
            status: 'completed',
            profitLoss: profitLoss,
            notes: '完整交易完成'
        });
        
        // 重置状态，允许开始新的交易
        this.isClosingPosition = false;
        this.isProcessingTrade = false;
    }
    
    /**
     * 计算盈亏
     * @param {object} limitOrder - 限价订单
     * @param {object} marketOrder - 市价订单
     * @returns {number} 盈亏金额
     */
    calculateProfitLoss(limitOrder, marketOrder) {
        // 简化计算：主要是手续费损失
        const limitOrderFee = limitOrder.price * limitOrder.quantity * this.config.makerFee;
        const marketOrderFee = (marketOrder.price || limitOrder.price) * limitOrder.quantity * this.config.takerFee;
        
        return -(limitOrderFee + marketOrderFee); // 负数表示损失
    }
    
    /**
     * 取消当前限价订单
     * @param {string} reason - 取消原因
     */
    async cancelCurrentLimitOrder(reason) {
        if (!this.currentLimitOrder) return;
        
        try {
            await this.client.cancelOrder(this.currentLimitOrder.orderId);
            this.log('INFO', '取消限价订单', { 
                orderId: this.currentLimitOrder.orderId,
                reason: reason 
            });
            
            this.currentLimitOrder = null;
            this.isProcessingTrade = false;
            
        } catch (error) {
            this.log('ERROR', '取消限价订单失败', { error: error.message });
        }
    }
    
    /**
     * 调整数量精度
     * @param {number} quantity - 原始数量
     * @param {string} increment - 数量增量
     * @returns {number} 调整后的数量
     */
    adjustQuantityPrecision(quantity, increment) {
        const step = parseFloat(increment);
        return Math.floor(quantity / step) * step;
    }
    
    /**
     * 调整价格精度
     * @param {number} price - 原始价格
     * @param {string} tickSize - 价格增量
     * @returns {number} 调整后的价格
     */
    adjustPricePrecision(price, tickSize) {
        const step = parseFloat(tickSize);
        const adjusted = Math.round(price / step) * step;
        
        // 根据tickSize确定小数位数，避免浮点精度问题
        const tickSizeStr = tickSize.toString();
        const decimalPlaces = tickSizeStr.includes('.') ? tickSizeStr.split('.')[1].length : 0;
        return parseFloat(adjusted.toFixed(decimalPlaces));
    }
    
    /**
     * 安全关闭机器人
     */
    async shutdown() {
        this.log('INFO', '正在关闭速刷交易机器人...');
        
        this.isRunning = false;
        
        // 取消当前限价订单
        if (this.currentLimitOrder) {
            await this.cancelCurrentLimitOrder('机器人关闭');
        }
        
        // 关闭WebSocket连接
        if (this.ws) {
            this.ws.close();
        }
        
        this.log('INFO', `✅ 机器人已安全关闭，共完成 ${this.completedTrades} 次交易`);
        process.exit(0);
    }
}

module.exports = VolumeBot;
