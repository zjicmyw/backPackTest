const crypto = require('crypto');
const fetch = require('node-fetch');
const ed25519 = require('ed25519');

/**
 * Backpack Exchange API 客户端
 */
class BackpackClient {
    constructor(apiKey, privateKey) {
        this.apiKey = apiKey;
        this.privateKey = privateKey;
        this.baseUrl = 'https://api.backpack.exchange';
    }

    /**
     * 生成 ED25519 签名
     * @param {string} message - 要签名的消息
     * @returns {string} Base64 编码的签名
     */
    generateSignature(message) {
        try {
            // 将私钥从 base64 转换为 Buffer
            const privateKeyBuffer = Buffer.from(this.privateKey, 'base64');
            
            // 使用 ed25519 库进行签名
            const messageBuffer = Buffer.from(message, 'utf8');
            const signature = ed25519.Sign(messageBuffer, privateKeyBuffer);
            
            return signature.toString('base64');
        } catch (error) {
            console.error('签名生成失败:', error);
            throw error;
        }
    }

    /**
     * 构建签名消息
     * @param {string} instruction - 指令类型
     * @param {object} params - 请求参数
     * @param {number} timestamp - 时间戳
     * @param {number} window - 时间窗口
     * @returns {string} 签名消息
     */
    buildSignatureMessage(instruction, params = {}, timestamp, window = 5000) {
        // 将参数按字母顺序排序
        const sortedParams = Object.keys(params)
            .sort()
            .map(key => `${key}=${params[key]}`)
            .join('&');

        // 构建完整的签名消息
        let message = `instruction=${instruction}`;
        if (sortedParams) {
            message += `&${sortedParams}`;
        }
        message += `&timestamp=${timestamp}&window=${window}`;

        return message;
    }

    /**
     * 发送签名请求
     * @param {string} method - HTTP 方法
     * @param {string} endpoint - API 端点
     * @param {string} instruction - 指令类型
     * @param {object} params - 请求参数
     * @param {object} body - 请求体（POST 请求）
     * @returns {Promise<object>} API 响应
     */
    async signedRequest(method, endpoint, instruction, params = {}, body = null) {
        const timestamp = Date.now();
        const window = 5000;

        // 构建签名消息
        let message;
        if (method === 'POST' && body && Array.isArray(body)) {
            // 批量订单使用特殊的签名格式
            message = this.buildBatchOrderSignatureMessage(body, timestamp, window);
        } else {
            // 其他请求使用标准签名格式
            let signatureParams = params;
            if ((method === 'POST' || method === 'DELETE') && body) {
                signatureParams = body;
            }
            message = this.buildSignatureMessage(instruction, signatureParams, timestamp, window);
        }

        const signature = this.generateSignature(message);

        // 构建请求头
        const headers = {
            'X-API-KEY': this.apiKey,
            'X-SIGNATURE': signature,
            'X-TIMESTAMP': timestamp.toString(),
            'X-WINDOW': window.toString(),
            'Content-Type': 'application/json'
        };

        // 构建 URL
        let url = `${this.baseUrl}${endpoint}`;
        if (method === 'GET' && Object.keys(params).length > 0) {
            const queryString = new URLSearchParams(params).toString();
            url += `?${queryString}`;
        }

        // 发送请求
        const options = {
            method,
            headers,
        };

        if ((method === 'POST' || method === 'DELETE') && body) {
            options.body = JSON.stringify(body);
        }

        try {
            const response = await fetch(url, options);
            
            // 先获取响应文本
            const responseText = await response.text();
            
            // 检查响应状态
            if (!response.ok) {
                // 对 /api/v1/position 特殊处理，404 代表没有持仓，不抛出错误
                if (
                    endpoint === '/api/v1/position' &&
                    response.status === 404
                ) {
                    // 返回空数组，表示没有持仓
                    return [];
                }
                let errorMessage = `API 错误 (${response.status})`;
                try {
                    const errorData = JSON.parse(responseText);
                    errorMessage += `: ${errorData.message || JSON.stringify(errorData)}`;
                } catch (jsonError) {
                    errorMessage += `: ${responseText}`;
                }
                throw new Error(errorMessage);
            }

            // 尝试解析JSON响应
            try {
                const data = JSON.parse(responseText);
                return data;
            } catch (jsonError) {
                // 如果不是JSON响应，返回文本响应
                return { message: responseText, status: 'success' };
            }
        } catch (error) {
            console.error(`请求失败 ${method} ${endpoint}:`, error);
            throw error;
        }
    }

    /**
     * 构建批量订单的签名消息
     * @param {Array} orders - 订单数组
     * @param {number} timestamp - 时间戳
     * @param {number} window - 时间窗口
     * @returns {string} 签名消息
     */
    buildBatchOrderSignatureMessage(orders, timestamp, window = 5000) {
        // 根据 Backpack API 文档，批量订单的签名格式为：
        // instruction=orderExecute&orderType=Limit&price=141&quantity=12&side=Bid&symbol=SOL_USDC_PERP&instruction=orderExecute&orderType=Limit&price=140&quantity=11&side=Bid&symbol=SOL_USDC_PERP&timestamp=1750793021519&window=5000
        
        let message = 'instruction=orderExecute';
        
        // 为每个订单添加参数
        orders.forEach(order => {
            // 将订单参数按字母顺序排序
            const sortedOrder = Object.keys(order)
                .sort()
                .map(key => `${key}=${order[key]}`)
                .join('&');
            
            message += `&${sortedOrder}`;
        });
        
        // 添加时间戳和窗口
        message += `&timestamp=${timestamp}&window=${window}`;
        
        return message;
    }

    /**
     * 发送公开请求（不需要签名）
     * @param {string} endpoint - API 端点
     * @param {object} params - 查询参数
     * @returns {Promise<object>} API 响应
     */
    async publicRequest(endpoint, params = {}) {
        let url = `${this.baseUrl}${endpoint}`;
        if (Object.keys(params).length > 0) {
            const queryString = new URLSearchParams(params).toString();
            url += `?${queryString}`;
        }

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(`API 错误 (${response.status}): ${data.message || JSON.stringify(data)}`);
            }

            return data;
        } catch (error) {
            console.error(`公开请求失败 ${endpoint}:`, error);
            throw error;
        }
    }

    // ================ 账户相关方法 ================

    /**
     * 获取账户信息和余额
     * @returns {Promise<object>} 账户信息
     */
    async getAccount() {
        return await this.signedRequest('GET', '/api/v1/account', 'accountQuery');
    }

    // ================ 市场数据方法 ================

    /**
     * 获取代币价格（Ticker）
     * @param {string} symbol - 交易对符号，如 'BTC_USDT'
     * @param {string} interval - 时间间隔（可选）
     * @returns {Promise<object>} 价格信息
     */
    async getTicker(symbol, interval = null) {
        const params = { symbol };
        if (interval) {
            params.interval = interval;
        }
        return await this.publicRequest('/api/v1/ticker', params);
    }

    /**
     * 获取订单簿深度
     * @param {string} symbol - 交易对符号
     * @returns {Promise<object>} 订单簿深度
     */
    async getDepth(symbol) {
        return await this.publicRequest('/api/v1/depth', { symbol });
    }

    // ================ 订单相关方法 ================

    /**
     * 查询所有订单
     * @param {string} symbol - 交易对符号（可选）
     * @returns {Promise<Array>} 订单列表
     */
    async getOrders(symbol = null) {
        const params = {};
        if (symbol) {
            params.symbol = symbol;
        }
        return await this.signedRequest('GET', '/api/v1/orders', 'orderQueryAll', params);
    }

    /**
     * 查询单个订单
     * @param {string} orderId - 订单ID
     * @param {string} symbol - 交易对符号
     * @returns {Promise<object>} 订单信息
     */
    async getOrder(orderId, symbol) {
        return await this.signedRequest('GET', '/api/v1/order', 'orderQuery', { orderId, symbol });
    }

    /**
     * 执行订单（下单）
     * @param {Array} orders - 订单数组
     * @returns {Promise<object>} 执行结果
     */
    async executeOrders(orders) {
        return await this.signedRequest('POST', '/api/v1/orders', 'orderExecute', {}, orders);
    }

    /**
     * 下单（单个订单的便捷方法）
     * @param {string} symbol - 交易对符号
     * @param {string} side - 'Bid' 或 'Ask'
     * @param {string} orderType - 'Limit' 或 'Market'
     * @param {string} quantity - 数量
     * @param {string} price - 价格（限价单必需）
     * @param {boolean} reduceOnly - 是否仅平仓（期货专用）
     * @param {boolean} postOnly - 是否仅挂单（只做 maker，不做 taker）
     * @returns {Promise<object>} 执行结果
     */
    async placeOrder(symbol, side, orderType, quantity, price = null, reduceOnly = false, postOnly = false) {
        const order = {
            symbol,
            side,
            orderType,
            quantity
        };

        if (orderType === 'Limit' && price) {
            order.price = price;
        }

        // 添加 reduceOnly 参数（仅期货合约）
        if (reduceOnly) {
            order.reduceOnly = true;
        }

        // 添加 postOnly 参数（仅挂单）
        if (postOnly) {
            order.postOnly = true;
        }

        return await this.executeOrders([order]);
    }

    /**
     * 取消订单
     * @param {string} orderId - 订单ID
     * @param {string} symbol - 交易对符号
     * @returns {Promise<object>} 取消结果
     */
    async cancelOrder(orderId, symbol) {
        // 根据API文档，取消订单需要在请求体中包含 orderId 和 symbol
        const cancelPayload = { 
            orderId: orderId, 
            symbol: symbol 
        };
        return await this.signedRequest('DELETE', '/api/v1/order', 'orderCancel', {}, cancelPayload);
    }

    // ================ 便捷方法 ================

    /**
     * 获取账户余额（使用专用的余额API）
     * @returns {Promise<Array>} 余额列表
     */
    async getBalances() {
        const endpoint = '/api/v1/capital';
        const method = 'GET';
        const instruction = 'balanceQuery';
        
        const response = await this.signedRequest(method, endpoint, instruction);
        
        // 转换响应格式为数组
        if (response && typeof response === 'object') {
            return Object.entries(response).map(([token, balance]) => ({
                token: token,
                available: balance.available,
                locked: balance.locked,
                staked: balance.staked || '0'
            }));
        }
        
        return [];
    }

    /**
     * 获取特定代币的余额
     * @param {string} mint - 代币地址或符号
     * @returns {Promise<object|null>} 余额信息
     */
    async getBalance(mint) {
        const balances = await this.getBalances();
        return balances.find(balance => balance.mint === mint) || null;
    }

    /**
     * 获取买1卖1价格
     * @param {string} symbol - 交易对符号
     * @returns {Promise<object>} 买1卖1价格
     */
    async getBestPrices(symbol) {
        const depth = await this.getDepth(symbol);
        return {
            // 买1：出价最高的买单（bids数组最后一个元素）
            bestBid: depth.bids && depth.bids.length > 0 ? depth.bids[depth.bids.length - 1] : null,
            // 卖1：要价最低的卖单（asks数组第一个元素）
            bestAsk: depth.asks && depth.asks.length > 0 ? depth.asks[0] : null,
            symbol,
            timestamp: depth.timestamp
        };
    }

    /**
     * 获取持仓信息
     * @param {string} symbol - 可选的交易对符号，用于过滤特定持仓
     * @returns {Promise<Array>} 持仓列表
     */
    /**
     * 获取持仓信息
     * @param {string|null} symbol - 可选，指定交易对符号
     * @returns {Promise<Array>} 持仓列表
     */
    async getPositions(symbol = null) {
        // 兼容 symbol 为空时查询所有持仓
        const params = {};
        if (symbol) params.symbol = symbol;
        try {
            const result = await this.signedRequest('GET', '/api/v1/position', 'positionQuery', params);
            // 兼容返回值为单个对象或数组
            if (!result) return [];
            if (Array.isArray(result)) return result;
            // 如果返回单个对象，封装为数组
            return [result];
        } catch (error) {
            // 404 代表当前symbol无持仓，不抛出错误，返回空数组
            if (
                (error.response && error.response.status === 404) ||
                (error.message && error.message.includes('404'))
            ) {
                return [];
            }
            // 其他错误正常抛出
            throw error;
        }
    }

    /**
     * 获取订单历史记录
     * @param {object} params - 查询参数
     * @param {string} params.orderId - 可选的订单ID过滤
     * @param {string} params.symbol - 可选的交易对过滤
     * @param {number} params.from - 可选的开始时间（毫秒时间戳）
     * @param {number} params.to - 可选的结束时间（毫秒时间戳）
     * @returns {Promise<Array>} 订单历史列表
     */
    async getOrderHistory(params = {}) {
        try {
            const queryParams = {};
            if (params.orderId) queryParams.orderId = params.orderId;
            if (params.symbol) queryParams.symbol = params.symbol;
            if (params.from) queryParams.from = params.from;
            if (params.to) queryParams.to = params.to;

            const result = await this.signedRequest('GET', '/wapi/v1/history/orders', 'orderHistoryQueryAll', queryParams);
            return result || [];
        } catch (error) {
            console.error('获取订单历史失败:', error.message);
            throw error;
        }
    }

    /**
     * 获取市场信息
     * @returns {Promise<Array>} 市场信息列表
     */
    async getMarkets() {
        try {
            const response = await fetch(`https://api.backpack.exchange/api/v1/markets`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            return result || [];
        } catch (error) {
            console.error('获取市场信息失败:', error.message);
            throw error;
        }
    }

    /**
     * 获取特定市场信息
     * @param {string} symbol - 交易对符号
     * @returns {Promise<Object>} 市场信息
     */
    async getMarket(symbol) {
        try {
            const response = await fetch(`https://api.backpack.exchange/api/v1/market?symbol=${symbol}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const result = await response.json();
            return result;
        } catch (error) {
            console.error(`获取市场 ${symbol} 信息失败:`, error.message);
            throw error;
        }
    }
}

module.exports = BackpackClient;
