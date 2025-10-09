/**
 * Backpack 限价刷交易量机器人
 * 
 * 功能特性：
 * - 纯限价交易，禁止市价单
 * - 智能持仓管理：无持仓时维护买1卖1订单，有持仓时维护平仓订单
 * - 实时价格跟踪：确保订单始终在1档位
 * - WebSocket 实时价格监控
 * - 沿用波动风控配置
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
 * 限价刷交易量机器人
 */
class LimitVolumeBot {
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
            
            // 限价刷量模式配置
            limitVolumeMode: config.volumeTrading?.limitVolumeMode || {
                enabled: false,
                priceCheckInterval: 1000,
                orderTimeout: 30,
                maxPriceAdjustments: 100,
                orderQuantity: 0.001
            },
            
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
        this.priceDataReady = false;
        
        // 持仓状态
        this.hasPosition = false;
        this.positionSide = null; // 'long' | 'short'
        this.positionQuantity = 0;
        
        // 订单管理
        this.activeOrders = new Map(); // orderId -> orderInfo
        this.buyOrderId = null;
        this.sellOrderId = null;
        this.closeOrderId = null;
        
        // 价格监控
        this.priceCheckTimer = null;
        this.lastBestPrices = null;
        this.priceAdjustmentCount = 0;
        
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
        this.csvLogPath = path.join('logs', `limit_volume_trades_${today}.csv`);
        this.debugLogPath = path.join('logs', `limit_volume_debug_${today}.log`);
        
        // 确保日志目录存在
        if (!fs.existsSync('logs')) {
            fs.mkdirSync('logs', { recursive: true });
        }
        
        // 创建CSV日志头部
        if (this.config.enableCsvLog && !fs.existsSync(this.csvLogPath)) {
            const csvHeader = 'timestamp,trade_number,order_id,side,price,quantity,status,profit_loss,notes\n';
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
            orderId,
            side,
            price,
            quantity,
            status,
            profitLoss,
            notes
        } = tradeData;
        
        const timestamp = new Date().toISOString();
        const csvLine = `${timestamp},${tradeNumber},${orderId || ''},${side},${price || ''},${quantity || ''},${status},${profitLoss || ''},${notes || ''}\n`;
        
        fs.appendFileSync(this.csvLogPath, csvLine);
    }
    
    /**
     * 启动机器人
     */
    async start() {
        try {
            this.log('INFO', '🚀 启动限价刷交易量机器人');
            this.log('INFO', '配置信息', {
                symbol: this.config.symbol,
                orderAmount: this.config.orderAmount,
                limitVolumeMode: this.config.limitVolumeMode.enabled,
                orderQuantity: this.config.limitVolumeMode.orderQuantity,
                priceCheckInterval: this.config.limitVolumeMode.priceCheckInterval,
                maxPositionValue: this.config.limitVolumeMode.maxPositionValue,
                volatility1Threshold: this.config.volatility1.priceChangeThreshold,
                volatility2Threshold: this.config.volatility2.priceChangeThreshold
            });
            
            // 验证API连接
            await this.validateApiConnection();
            
            // 连接WebSocket
            await this.connectWebSocket();
            
            // 检查当前持仓状态
            await this.checkInitialPosition();
            
            // 开始价格监控循环
            this.startPriceMonitoring();
            
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
                    this.log('INFO', '💡 提示: 请向账户充值USDC后再启动限价刷量机器人');
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
        
        // 取消所有当前订单
        this.cancelAllOrders('波动风控暂停');
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
     * 检查初始持仓状态
     */
    async checkInitialPosition() {
        try {
            this.log('INFO', '检查初始持仓状态...');
            
            const positions = await this.client.getPositions(this.config.symbol);
            const currentPosition = positions.find(p => p.symbol === this.config.symbol);
            
            if (currentPosition && parseFloat(currentPosition.netQuantity) !== 0) {
                const netQuantity = parseFloat(currentPosition.netQuantity);
                this.hasPosition = true;
                this.positionSide = netQuantity > 0 ? 'long' : 'short';
                this.positionQuantity = Math.abs(netQuantity);
                
                this.log('INFO', '检测到现有持仓', {
                    side: this.positionSide,
                    quantity: this.positionQuantity,
                    netQuantity: netQuantity
                });
            } else {
                this.log('INFO', '当前无持仓，准备创建开仓订单');
            }
            
        } catch (error) {
            this.log('ERROR', '检查初始持仓状态失败', { error: error.message });
            throw error;
        }
    }
    
    /**
     * 开始价格监控循环
     */
    startPriceMonitoring() {
        this.priceCheckTimer = setInterval(async () => {
            try {
                if (!this.priceDataReady) return;
                
                const bestPrices = await this.client.getBestPrices(this.config.symbol);
                
                if (this.hasPosition) {
                    await this.adjustCloseOrderPrice(bestPrices);
                } else {
                    await this.adjustOpenOrderPrices(bestPrices);
                }
                
                // 定期清理过期订单记录（每10次价格检查清理一次）
                if (this.priceAdjustmentCount % 10 === 0) {
                    await this.cleanupExpiredOrders();
                }
                
                this.lastBestPrices = bestPrices;
            } catch (error) {
                this.log('ERROR', '价格监控失败', { error: error.message });
            }
        }, this.config.limitVolumeMode.priceCheckInterval);
    }
    
    /**
     * 调整开仓订单价格（无持仓状态）
     * @param {object} bestPrices - 1档位价格
     */
    async adjustOpenOrderPrices(bestPrices) {
        try {
            // 检查当前持仓状态
            const positions = await this.client.getPositions(this.config.symbol);
            const currentPosition = positions.find(p => p.symbol === this.config.symbol);
            const netQuantity = currentPosition ? parseFloat(currentPosition.netQuantity) : 0;
            
            // 检查持仓金额限制
            const currentPrice = (bestPrices.bestBid[0] + bestPrices.bestAsk[0]) / 2; // 使用中间价
            const positionValue = this.calculatePositionValue(netQuantity, currentPrice);
            
            this.log('DEBUG', '持仓金额检查', {
                netQuantity: netQuantity,
                currentPrice: currentPrice,
                positionValue: positionValue.toFixed(2),
                maxPositionValue: this.config.limitVolumeMode.maxPositionValue
            });
            
            // 检查持仓方向限制 - 严格限制同方向开仓
            // 多头持仓：禁止任何买单（开多）
            if (netQuantity > 0) {
                this.log('WARN', '持有多头持仓，禁止开多', { 
                    netQuantity: netQuantity,
                    positionType: '多头',
                    restriction: '禁止买单（开多）',
                    note: '只允许卖单（平多）'
                });
                // 取消现有的买单
                if (this.buyOrderId) {
                    await this.cancelOrder(this.buyOrderId);
                    this.buyOrderId = null;
                }
                // 只允许卖单（平多）
                await this.adjustSellOrderOnly(bestPrices);
                return;
            }
            
            // 空头持仓：禁止任何卖单（开空）
            if (netQuantity < 0) {
                this.log('WARN', '持有空头持仓，禁止开空', { 
                    netQuantity: netQuantity,
                    positionType: '空头',
                    restriction: '禁止卖单（开空）',
                    note: '只允许买单（平空）'
                });
                // 取消现有的卖单
                if (this.sellOrderId) {
                    await this.cancelOrder(this.sellOrderId);
                    this.sellOrderId = null;
                }
                // 只允许买单（平空）
                await this.adjustBuyOrderOnly(bestPrices);
                return;
            }
            
            // 检查持仓金额限制 - 如果超过限制，禁止同方向开仓
            if (positionValue >= this.config.limitVolumeMode.maxPositionValue) {
                this.log('WARN', '持仓金额超过限制', { 
                    positionValue: positionValue.toFixed(2),
                    maxPositionValue: this.config.limitVolumeMode.maxPositionValue,
                    netQuantity: netQuantity,
                    restriction: '持仓金额限制'
                });
                // 持仓金额超过限制时，不创建任何新订单
                return;
            }
            
            // 确保同时最多只有一个买单和一个卖单
            let buyOrderExists = false;
            let sellOrderExists = false;
            
            // 检查买单状态
            if (this.buyOrderId) {
                try {
                    const currentOrder = await this.client.getOrder(this.buyOrderId, this.config.symbol);
                    if (currentOrder) {
                        if (currentOrder.status === 'New' || currentOrder.status === 'PartiallyFilled') {
                            buyOrderExists = true;
                            // 检查价格是否需要调整
                            if (parseFloat(currentOrder.price) !== bestPrices.bestBid[0]) {
                                await this.replaceOrder(this.buyOrderId, 'buy', bestPrices.bestBid[0]);
                            }
                        } else if (currentOrder.status === 'Filled') {
                            this.log('INFO', '买单已成交', { orderId: this.buyOrderId });
                            await this.handleOrderFilled(this.buyOrderId, currentOrder);
                            this.buyOrderId = null;
                        } else if (currentOrder.status === 'Cancelled') {
                            this.log('INFO', '买单已取消', { orderId: this.buyOrderId });
                            this.buyOrderId = null;
                        }
                    }
                } catch (orderError) {
                    if (orderError.message.includes('404')) {
                        this.log('INFO', '买单已从订单簿移除，检查是否已成交', { orderId: this.buyOrderId });
                        await this.checkOrderFilled(this.buyOrderId);
                        this.buyOrderId = null;
                    } else {
                        throw orderError;
                    }
                }
            }
            
            // 检查卖单状态
            if (this.sellOrderId) {
                try {
                    const currentOrder = await this.client.getOrder(this.sellOrderId, this.config.symbol);
                    if (currentOrder) {
                        if (currentOrder.status === 'New' || currentOrder.status === 'PartiallyFilled') {
                            sellOrderExists = true;
                            // 检查价格是否需要调整
                            if (parseFloat(currentOrder.price) !== bestPrices.bestAsk[0]) {
                                await this.replaceOrder(this.sellOrderId, 'sell', bestPrices.bestAsk[0]);
                            }
                        } else if (currentOrder.status === 'Filled') {
                            this.log('INFO', '卖单已成交', { orderId: this.sellOrderId });
                            await this.handleOrderFilled(this.sellOrderId, currentOrder);
                            this.sellOrderId = null;
                        } else if (currentOrder.status === 'Cancelled') {
                            this.log('INFO', '卖单已取消', { orderId: this.sellOrderId });
                            this.sellOrderId = null;
                        }
                    }
                } catch (orderError) {
                    if (orderError.message.includes('404')) {
                        this.log('INFO', '卖单已从订单簿移除，检查是否已成交', { orderId: this.sellOrderId });
                        await this.checkOrderFilled(this.sellOrderId);
                        this.sellOrderId = null;
                    } else {
                        throw orderError;
                    }
                }
            }
            
            // 创建缺失的订单（确保同时最多只有一个买单和一个卖单）
            if (!buyOrderExists && !this.buyOrderId) {
                this.log('INFO', '创建买单', { price: bestPrices.bestBid[0] });
                this.buyOrderId = await this.placeLimitOrder('buy', bestPrices.bestBid[0]);
            }
            
            if (!sellOrderExists && !this.sellOrderId) {
                this.log('INFO', '创建卖单', { price: bestPrices.bestAsk[0] });
                this.sellOrderId = await this.placeLimitOrder('sell', bestPrices.bestAsk[0]);
            }
            
        } catch (error) {
            this.log('ERROR', '调整开仓订单价格失败', { error: error.message });
        }
    }
    
    /**
     * 只调整买单（用于空头持仓时平空）
     * @param {object} bestPrices - 1档位价格
     */
    async adjustBuyOrderOnly(bestPrices) {
        try {
            // 检查买单状态
            if (this.buyOrderId) {
                try {
                    const currentOrder = await this.client.getOrder(this.buyOrderId, this.config.symbol);
                    if (currentOrder) {
                        if (currentOrder.status === 'New' || currentOrder.status === 'PartiallyFilled') {
                            // 检查价格是否需要调整
                            if (parseFloat(currentOrder.price) !== bestPrices.bestBid[0]) {
                                await this.replaceOrder(this.buyOrderId, 'buy', bestPrices.bestBid[0]);
                            }
                        } else if (currentOrder.status === 'Filled') {
                            this.log('INFO', '买单已成交', { orderId: this.buyOrderId });
                            await this.handleOrderFilled(this.buyOrderId, currentOrder);
                            this.buyOrderId = null;
                        } else if (currentOrder.status === 'Cancelled') {
                            this.log('INFO', '买单已取消', { orderId: this.buyOrderId });
                            this.buyOrderId = null;
                        }
                    }
                } catch (orderError) {
                    if (orderError.message.includes('404')) {
                        this.log('INFO', '买单已从订单簿移除，检查是否已成交', { orderId: this.buyOrderId });
                        await this.checkOrderFilled(this.buyOrderId);
                        this.buyOrderId = null;
                    } else {
                        throw orderError;
                    }
                }
            } else {
                // 创建买单
                this.log('INFO', '创建买单（空头持仓平空）', { price: bestPrices.bestBid[0] });
                this.buyOrderId = await this.placeLimitOrder('buy', bestPrices.bestBid[0]);
            }
        } catch (error) {
            this.log('ERROR', '调整买单失败', { error: error.message });
        }
    }
    
    /**
     * 只调整卖单（用于多头持仓时平多）
     * @param {object} bestPrices - 1档位价格
     */
    async adjustSellOrderOnly(bestPrices) {
        try {
            // 检查卖单状态
            if (this.sellOrderId) {
                try {
                    const currentOrder = await this.client.getOrder(this.sellOrderId, this.config.symbol);
                    if (currentOrder) {
                        if (currentOrder.status === 'New' || currentOrder.status === 'PartiallyFilled') {
                            // 检查价格是否需要调整
                            if (parseFloat(currentOrder.price) !== bestPrices.bestAsk[0]) {
                                await this.replaceOrder(this.sellOrderId, 'sell', bestPrices.bestAsk[0]);
                            }
                        } else if (currentOrder.status === 'Filled') {
                            this.log('INFO', '卖单已成交', { orderId: this.sellOrderId });
                            await this.handleOrderFilled(this.sellOrderId, currentOrder);
                            this.sellOrderId = null;
                        } else if (currentOrder.status === 'Cancelled') {
                            this.log('INFO', '卖单已取消', { orderId: this.sellOrderId });
                            this.sellOrderId = null;
                        }
                    }
                } catch (orderError) {
                    if (orderError.message.includes('404')) {
                        this.log('INFO', '卖单已从订单簿移除，检查是否已成交', { orderId: this.sellOrderId });
                        await this.checkOrderFilled(this.sellOrderId);
                        this.sellOrderId = null;
                    } else {
                        throw orderError;
                    }
                }
            } else {
                // 创建卖单
                this.log('INFO', '创建卖单（多头持仓平多）', { price: bestPrices.bestAsk[0] });
                this.sellOrderId = await this.placeLimitOrder('sell', bestPrices.bestAsk[0]);
            }
        } catch (error) {
            this.log('ERROR', '调整卖单失败', { error: error.message });
        }
    }
    
    /**
     * 调整平仓订单价格（有持仓状态）
     * @param {object} bestPrices - 1档位价格
     */
    async adjustCloseOrderPrice(bestPrices) {
        try {
            // 检查当前持仓状态
            const positions = await this.client.getPositions(this.config.symbol);
            const currentPosition = positions.find(p => p.symbol === this.config.symbol);
            const netQuantity = currentPosition ? parseFloat(currentPosition.netQuantity) : 0;
            
            // 检查持仓方向和平仓条件
            // 多头持仓：需要卖单平仓
            if (netQuantity >= this.config.orderQuantity) {
                this.log('INFO', '检测到多头持仓，需要卖单平仓', { 
                    netQuantity: netQuantity,
                    orderQuantity: this.config.orderQuantity,
                    positionType: '多头',
                    closeAction: '卖单平仓'
                });
                await this.adjustSellOrderOnly(bestPrices);
                return;
            }
            
            // 空头持仓：需要买单平仓
            if (netQuantity <= -this.config.orderQuantity) {
                this.log('INFO', '检测到空头持仓，需要买单平仓', { 
                    netQuantity: netQuantity,
                    orderQuantity: this.config.orderQuantity,
                    positionType: '空头',
                    closeAction: '买单平仓'
                });
                await this.adjustBuyOrderOnly(bestPrices);
                return;
            }
            
            // 如果没有持仓或持仓数量小于订单数量，不允许平仓
            this.log('WARN', '持仓数量不足，不允许平仓', { 
                netQuantity: netQuantity,
                orderQuantity: this.config.orderQuantity,
                threshold: this.config.orderQuantity
            });
            // 清除平仓订单ID
            if (this.closeOrderId) {
                await this.cancelOrder(this.closeOrderId);
                this.closeOrderId = null;
            }
            return;
            
        } catch (error) {
            this.log('ERROR', '调整平仓订单价格失败', { error: error.message });
        }
    }
    
    /**
     * 下限价订单
     * @param {string} side - 订单方向 'buy' | 'sell'
     * @param {number} price - 订单价格
     * @returns {Promise<string>} 订单ID
     */
    async placeLimitOrder(side, price) {
        try {
            const quantity = this.config.limitVolumeMode.orderQuantity;
            
            this.log('INFO', '下限价订单', {
                side: side,
                price: price,
                quantity: quantity
            });
            
            const order = await this.client.placeOrder(
                this.config.symbol,
                side === 'buy' ? 'Bid' : 'Ask',
                'Limit',
                quantity.toString(),
                price.toString(),
                false, // reduceOnly = false
                true   // postOnly = true
            );
            
            if (!order || !Array.isArray(order) || !order[0] || !order[0].id || order[0].operation !== 'Ok') {
                throw new Error('限价订单创建失败');
            }
            
            const orderInfo = order[0];
            this.activeOrders.set(orderInfo.id, {
                id: orderInfo.id,
                side: side,
                price: price,
                quantity: quantity,
                timestamp: Date.now()
            });
            
            this.log('INFO', '✅ 限价订单创建成功', {
                orderId: orderInfo.id,
                side: side,
                price: price,
                quantity: quantity,
                status: orderInfo.status
            });
            
            // 记录到CSV
            this.logTradeToCsv({
                tradeNumber: this.completedTrades + 1,
                orderId: orderInfo.id,
                side: side,
                price: price,
                quantity: quantity,
                status: 'placed',
                notes: '限价订单已下达'
            });
            
            return orderInfo.id;
            
        } catch (error) {
            this.log('ERROR', '下限价订单失败', { error: error.message });
            throw error;
        }
    }
    
    /**
     * 下平仓订单
     * @param {number} price - 平仓价格
     * @returns {Promise<string>} 订单ID
     */
    async placeCloseOrder(price) {
        try {
            const quantity = this.positionQuantity;
            const side = this.positionSide === 'long' ? 'sell' : 'buy';
            
            this.log('INFO', '下平仓订单', {
                side: side,
                price: price,
                quantity: quantity,
                positionSide: this.positionSide
            });
            
            const order = await this.client.placeOrder(
                this.config.symbol,
                side === 'buy' ? 'Bid' : 'Ask',
                'Limit',
                quantity.toString(),
                price.toString(),
                true,  // reduceOnly = true
                true   // postOnly = true
            );
            
            if (!order || !Array.isArray(order) || !order[0] || !order[0].id || order[0].operation !== 'Ok') {
                throw new Error('平仓订单创建失败');
            }
            
            const orderInfo = order[0];
            this.activeOrders.set(orderInfo.id, {
                id: orderInfo.id,
                side: 'close',
                price: price,
                quantity: quantity,
                timestamp: Date.now()
            });
            
            this.log('INFO', '✅ 平仓订单创建成功', {
                orderId: orderInfo.id,
                side: side,
                price: price,
                quantity: quantity,
                status: orderInfo.status
            });
            
            // 记录到CSV
            this.logTradeToCsv({
                tradeNumber: this.completedTrades + 1,
                orderId: orderInfo.id,
                side: side,
                price: price,
                quantity: quantity,
                status: 'close_placed',
                notes: '平仓订单已下达'
            });
            
            return orderInfo.id;
            
        } catch (error) {
            this.log('ERROR', '下平仓订单失败', { error: error.message });
            throw error;
        }
    }
    
    /**
     * 替换订单（取消旧订单，创建新订单）
     * @param {string} oldOrderId - 旧订单ID
     * @param {string} side - 订单方向
     * @param {number} newPrice - 新价格
     */
    async replaceOrder(oldOrderId, side, newPrice) {
        try {
            this.log('INFO', '替换订单', {
                oldOrderId: oldOrderId,
                side: side,
                newPrice: newPrice,
                adjustmentCount: this.priceAdjustmentCount + 1
            });
            
            // 如果有旧订单ID，必须先撤销原订单
            if (oldOrderId) {
                this.log('INFO', '开始撤销原订单', { orderId: oldOrderId });
                
                try {
                    // 尝试撤销原订单
                    await this.client.cancelOrder(oldOrderId, this.config.symbol);
                    this.log('INFO', '✅ 原订单撤销成功', { orderId: oldOrderId });
                    
                    // 等待确保撤销操作完成
                    await new Promise(resolve => setTimeout(resolve, 500));
                    
                    // 验证订单是否真的被撤销
                    try {
                        const cancelledOrder = await this.client.getOrder(oldOrderId, this.config.symbol);
                        if (cancelledOrder && cancelledOrder.status === 'Cancelled') {
                            this.log('INFO', '订单撤销状态确认', { 
                                orderId: oldOrderId, 
                                status: cancelledOrder.status 
                            });
                        }
                    } catch (verifyError) {
                        // 如果查询失败，可能订单已经被撤销
                        this.log('INFO', '订单撤销验证失败，可能已成功撤销', { 
                            orderId: oldOrderId,
                            error: verifyError.message 
                        });
                    }
                    
                } catch (cancelError) {
                    if (cancelError.message.includes('Order not found')) {
                        this.log('INFO', '订单已不存在，可能已成交或撤销', { orderId: oldOrderId });
                        // 检查是否已成交
                        await this.checkOrderFilled(oldOrderId);
                        return;
                    } else if (cancelError.message.includes('Order already cancelled')) {
                        this.log('INFO', '订单已被撤销', { orderId: oldOrderId });
                    } else {
                        this.log('ERROR', '撤销原订单失败', { 
                            orderId: oldOrderId, 
                            error: cancelError.message 
                        });
                        throw cancelError;
                    }
                }
                
                // 从活跃订单映射中移除旧订单
                this.activeOrders.delete(oldOrderId);
                this.log('INFO', '已从活跃订单映射中移除旧订单', { orderId: oldOrderId });
            }
            
            // 检查是否已存在相同价格的订单
            let existingOrderId = null;
            for (const [orderId, orderData] of this.activeOrders) {
                if (orderData.side === side && Math.abs(orderData.price - newPrice) < 0.0000001) {
                    existingOrderId = orderId;
                    break;
                }
            }
            
            if (existingOrderId) {
                this.log('INFO', '已存在相同价格的订单，跳过创建', {
                    existingOrderId: existingOrderId,
                    side: side,
                    price: newPrice
                });
                return;
            }
            
            // 创建新订单
            let newOrderId;
            if (side === 'close') {
                // 平仓订单需要重新获取当前持仓数量
                const positions = await this.client.getPositions(this.config.symbol);
                const currentPosition = positions.find(p => p.symbol === this.config.symbol);
                const netQuantity = currentPosition ? parseFloat(currentPosition.netQuantity) : 0;
                
                if (Math.abs(netQuantity) < this.config.orderQuantity) {
                    this.log('WARN', '持仓数量不足，无法创建平仓订单', { 
                        netQuantity: netQuantity,
                        orderQuantity: this.config.orderQuantity
                    });
                    return;
                }
                
                newOrderId = await this.placeCloseOrder(newPrice);
                this.closeOrderId = newOrderId;
            } else {
                newOrderId = await this.placeLimitOrder(side, newPrice);
                if (side === 'buy') {
                    this.buyOrderId = newOrderId;
                } else {
                    this.sellOrderId = newOrderId;
                }
            }
            
            // 更新活跃订单映射（旧订单已在撤销时移除）
            if (newOrderId) {
                this.activeOrders.set(newOrderId, {
                    side: side,
                    price: newPrice,
                    timestamp: Date.now()
                });
                this.log('INFO', '新订单已添加到活跃订单映射', { 
                    orderId: newOrderId,
                    side: side,
                    price: newPrice
                });
            }
            
            this.priceAdjustmentCount++;
            
            this.log('INFO', '✅ 订单替换成功', {
                oldOrderId: oldOrderId,
                newOrderId: newOrderId,
                side: side,
                newPrice: newPrice,
                adjustmentCount: this.priceAdjustmentCount,
                activeOrdersCount: this.activeOrders.size
            });
            
        } catch (error) {
            this.log('ERROR', '替换订单失败', { 
                error: error.message,
                oldOrderId: oldOrderId,
                side: side,
                newPrice: newPrice
            });
            
            // 替换失败时，清理可能不一致的状态
            if (oldOrderId) {
                // 如果旧订单被撤销了但新订单创建失败，需要清理状态
                if (side === 'buy') {
                    this.buyOrderId = null;
                } else if (side === 'sell') {
                    this.sellOrderId = null;
                } else if (side === 'close') {
                    this.closeOrderId = null;
                }
                
                // 确保从活跃订单映射中移除（如果还在的话）
                this.activeOrders.delete(oldOrderId);
                
                this.log('WARN', '订单替换失败，已清理状态', {
                    oldOrderId: oldOrderId,
                    side: side,
                    activeOrdersCount: this.activeOrders.size,
                    note: '原订单已撤销，但新订单创建失败'
                });
            }
        }
    }
    
    /**
     * 检查订单是否已成交
     * @param {string} orderId - 订单ID
     */
    async checkOrderFilled(orderId) {
        try {
            // 尝试查询订单历史
            const historyOrders = await this.client.getOrderHistory({
                orderId: orderId,
                symbol: this.config.symbol
            });
            
            if (historyOrders && historyOrders.length > 0) {
                const historyOrder = historyOrders[0];
                this.log('INFO', '从历史订单中找到订单', { 
                    orderId: orderId, 
                    status: historyOrder.status,
                    price: historyOrder.price,
                    quantity: historyOrder.quantity
                });
                
                if (historyOrder.status === 'Filled') {
                    this.log('INFO', '订单已成交', { orderId: orderId });
                    await this.handleOrderFilled(orderId, historyOrder);
                } else if (historyOrder.status === 'Cancelled') {
                    this.log('INFO', '订单已取消', { orderId: orderId });
                    // 清除订单ID，但不处理成交逻辑
                }
            } else {
                this.log('WARN', '未在历史订单中找到订单', { orderId: orderId });
            }
        } catch (error) {
            this.log('WARN', '检查订单成交状态失败', { error: error.message });
        }
    }
    
    /**
     * 处理订单成交
     * @param {string} orderId - 订单ID
     * @param {object} orderInfo - 订单信息
     */
    async handleOrderFilled(orderId, orderInfo) {
        try {
            const order = this.activeOrders.get(orderId);
            if (!order) return;
            
            this.log('INFO', '🎉 订单已成交', {
                orderId: orderId,
                side: order.side,
                price: orderInfo.price || order.price,
                quantity: orderInfo.quantity || order.quantity
            });
            
            if (order.side === 'close') {
                // 平仓订单成交
                await this.handleCloseOrderFilled(orderId, orderInfo);
            } else {
                // 开仓订单成交
                await this.handleOpenOrderFilled(orderId, orderInfo);
            }
            
            // 从活跃订单中移除
            this.activeOrders.delete(orderId);
            
        } catch (error) {
            this.log('ERROR', '处理订单成交失败', { error: error.message });
        }
    }
    
    /**
     * 处理开仓订单成交
     * @param {string} orderId - 订单ID
     * @param {object} orderInfo - 订单信息
     */
    async handleOpenOrderFilled(orderId, orderInfo) {
        try {
            const order = this.activeOrders.get(orderId);
            if (!order) return;
            
            // 更新持仓状态
            this.hasPosition = true;
            this.positionSide = order.side === 'buy' ? 'long' : 'short';
            this.positionQuantity = parseFloat(orderInfo.quantity || order.quantity);
            
            this.log('INFO', '持仓状态更新', {
                side: this.positionSide,
                quantity: this.positionQuantity
            });
            
            // 取消另一个开仓订单
            if (order.side === 'buy' && this.sellOrderId) {
                await this.cancelOrder(this.sellOrderId);
                this.sellOrderId = null;
            } else if (order.side === 'sell' && this.buyOrderId) {
                await this.cancelOrder(this.buyOrderId);
                this.buyOrderId = null;
            }
            
            // 创建平仓订单
            const bestPrices = await this.client.getBestPrices(this.config.symbol);
            const closePrice = this.positionSide === 'long' 
                ? bestPrices.bestBid[0]  // 多头平仓用买1
                : bestPrices.bestAsk[0]; // 空头平仓用卖1
            
            this.closeOrderId = await this.placeCloseOrder(closePrice);
            
        } catch (error) {
            this.log('ERROR', '处理开仓订单成交失败', { error: error.message });
        }
    }
    
    /**
     * 处理平仓订单成交
     * @param {string} orderId - 订单ID
     * @param {object} orderInfo - 订单信息
     */
    async handleCloseOrderFilled(orderId, orderInfo) {
        try {
            // 完成一次完整交易
            this.completedTrades++;
            
            this.log('INFO', `✅ 第 ${this.completedTrades} 次交易完成`, {
                closeOrderId: orderId,
                positionSide: this.positionSide,
                quantity: this.positionQuantity,
                totalTrades: this.completedTrades,
                remaining: this.config.maxTrades - this.completedTrades
            });
            
            // 记录到CSV
            this.logTradeToCsv({
                tradeNumber: this.completedTrades,
                orderId: orderId,
                side: this.positionSide === 'long' ? 'sell' : 'buy',
                price: orderInfo.price,
                quantity: this.positionQuantity,
                status: 'completed',
                notes: '完整交易完成'
            });
            
            // 清除持仓状态
            this.hasPosition = false;
            this.positionSide = null;
            this.positionQuantity = 0;
            this.closeOrderId = null;
            
            // 重新创建开仓订单
            const bestPrices = await this.client.getBestPrices(this.config.symbol);
            this.buyOrderId = await this.placeLimitOrder('buy', bestPrices.bestBid[0]);
            this.sellOrderId = await this.placeLimitOrder('sell', bestPrices.bestAsk[0]);
            
        } catch (error) {
            this.log('ERROR', '处理平仓订单成交失败', { error: error.message });
        }
    }
    
    /**
     * 取消订单
     * @param {string} orderId - 订单ID
     */
    async cancelOrder(orderId) {
        try {
            if (!orderId) return;
            
            await this.client.cancelOrder(orderId, this.config.symbol);
            this.activeOrders.delete(orderId);
            
            this.log('INFO', '订单已取消', { orderId: orderId });
            
        } catch (error) {
            this.log('ERROR', '取消订单失败', { error: error.message });
        }
    }
    
    /**
     * 取消所有订单
     * @param {string} reason - 取消原因
     */
    async cancelAllOrders(reason) {
        try {
            this.log('INFO', '取消所有订单', { reason: reason });
            
            // 取消所有活跃订单
            for (const [orderId, order] of this.activeOrders) {
                await this.cancelOrder(orderId);
            }
            
            // 重置订单ID
            this.buyOrderId = null;
            this.sellOrderId = null;
            this.closeOrderId = null;
            
        } catch (error) {
            this.log('ERROR', '取消所有订单失败', { error: error.message });
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
                
                // 检查价格调整次数限制
                if (this.priceAdjustmentCount >= this.config.limitVolumeMode.maxPriceAdjustments) {
                    this.log('WARN', `价格调整次数达到上限 ${this.config.limitVolumeMode.maxPriceAdjustments}，停止交易`);
                    this.shutdown();
                    return;
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
     * 安全关闭机器人
     */
    async shutdown() {
        this.log('INFO', '正在关闭限价刷交易量机器人...');
        
        this.isRunning = false;
        
        // 清理定时器
        if (this.priceCheckTimer) {
            clearInterval(this.priceCheckTimer);
            this.priceCheckTimer = null;
        }
        
        // 取消所有订单
        await this.cancelAllOrders('机器人关闭');
        
        // 关闭WebSocket连接
        if (this.ws) {
            this.ws.close();
        }
        
        this.log('INFO', `✅ 机器人已安全关闭，共完成 ${this.completedTrades} 次交易，价格调整 ${this.priceAdjustmentCount} 次`);
        process.exit(0);
    }
    
    /**
     * 清理过期的订单记录
     * 移除已成交、已取消或超过一定时间的订单记录
     */
    async cleanupExpiredOrders() {
        try {
            const now = Date.now();
            const maxAge = 20 * 60 * 1000; // 20分钟
            const ordersToRemove = [];
            
            for (const [orderId, orderData] of this.activeOrders) {
                // 检查订单是否过期
                if (now - orderData.timestamp > maxAge) {
                    ordersToRemove.push(orderId);
                    continue;
                }
                
                // 检查订单是否仍然存在
                try {
                    const currentOrder = await this.client.getOrder(orderId, this.config.symbol);
                    if (!currentOrder || currentOrder.status === 'Filled' || currentOrder.status === 'Cancelled') {
                        ordersToRemove.push(orderId);
                    }
                } catch (error) {
                    if (error.message.includes('404')) {
                        // 订单不存在，可能已成交
                        ordersToRemove.push(orderId);
                    }
                }
            }
            
            // 移除过期订单
            for (const orderId of ordersToRemove) {
                this.activeOrders.delete(orderId);
                this.log('DEBUG', '清理过期订单记录', { orderId: orderId });
            }
            
            if (ordersToRemove.length > 0) {
                this.log('INFO', '清理过期订单记录完成', {
                    removedCount: ordersToRemove.length,
                    remainingCount: this.activeOrders.size
                });
            }
            
        } catch (error) {
            this.log('ERROR', '清理过期订单记录失败', { error: error.message });
        }
    }
    
    /**
     * 计算持仓金额（USDC）
     * @param {number} netQuantity - 净持仓数量
     * @param {number} currentPrice - 当前价格
     * @returns {number} 持仓金额
     */
    calculatePositionValue(netQuantity, currentPrice) {
        return Math.abs(netQuantity) * currentPrice;
    }
    
    /**
     * 检查持仓金额限制
     * @param {number} netQuantity - 净持仓数量
     * @param {number} currentPrice - 当前价格
     * @param {string} orderSide - 订单方向 'buy' | 'sell'
     * @returns {boolean} 是否允许下单
     */
    checkPositionValueLimit(netQuantity, currentPrice, orderSide) {
        const positionValue = this.calculatePositionValue(netQuantity, currentPrice);
        const maxPositionValue = this.config.limitVolumeMode.maxPositionValue;
        
        // 如果持仓金额超过限制
        if (positionValue >= maxPositionValue) {
            // 检查是否为同方向订单
            const isSameDirection = (netQuantity > 0 && orderSide === 'buy') || 
                                   (netQuantity < 0 && orderSide === 'sell');
            
            if (isSameDirection) {
                this.log('WARN', '持仓金额超过限制，禁止同方向开仓', {
                    positionValue: positionValue.toFixed(2),
                    maxPositionValue: maxPositionValue,
                    netQuantity: netQuantity,
                    orderSide: orderSide,
                    currentPrice: currentPrice,
                    restriction: '同方向开仓被禁止'
                });
                return false;
            }
        }
        
        return true;
    }
}

module.exports = LimitVolumeBot;
