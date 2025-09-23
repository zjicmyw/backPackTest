#!/usr/bin/env node

/**
 * 多账户查询脚本
 * 功能：一键查询多个账户的USD余额和最近一周的交易统计
 * 
 * 使用方法：
 * node multi-account-query.js
 * 
 * 环境变量配置：
 * 在 .env 文件中配置多个账户的API密钥
 * ACCOUNT_1_API_KEY=your_api_key_1
 * ACCOUNT_1_PRIVATE_KEY=your_private_key_1
 * ACCOUNT_1_NAME=账户1名称
 * ACCOUNT_2_API_KEY=your_api_key_2
 * ACCOUNT_2_PRIVATE_KEY=your_private_key_2
 * ACCOUNT_2_NAME=账户2名称
 * ... 以此类推
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

// 导入现有的客户端
const BackpackClient = require('./backpack-client.js');

class MultiAccountQuery {
    constructor() {
        this.accounts = [];
        this.loadAccounts();
    }

    /**
     * 从环境变量加载账户配置
     */
    loadAccounts() {
        const envVars = Object.keys(process.env);
        const accountNumbers = new Set();
        
        // 查找所有账户编号
        envVars.forEach(key => {
            const match = key.match(/^ACCOUNT_(\d+)_/);
            if (match) {
                accountNumbers.add(match[1]);
            }
        });

        // 为每个账户创建配置
        accountNumbers.forEach(num => {
            const apiKey = process.env[`ACCOUNT_${num}_API_KEY`];
            const privateKey = process.env[`ACCOUNT_${num}_PRIVATE_KEY`];
            const name = process.env[`ACCOUNT_${num}_NAME`] || `账户${num}`;

            if (apiKey && privateKey) {
                this.accounts.push({
                    number: num,
                    name: name,
                    apiKey: apiKey,
                    privateKey: privateKey,
                    client: new BackpackClient(apiKey, privateKey)
                });
            } else {
                console.warn(`⚠️  账户${num}配置不完整，跳过`);
            }
        });

        // 如果没有找到多账户配置，尝试使用单账户配置
        if (this.accounts.length === 0) {
            const singleApiKey = process.env.API_KEY;
            const singlePrivateKey = process.env.PRIVATE_KEY;
            const singleName = process.env.ACCOUNT_NAME || 'my账户';

            if (singleApiKey && singlePrivateKey) {
                this.accounts.push({
                    number: '1',
                    name: singleName,
                    apiKey: singleApiKey,
                    privateKey: singlePrivateKey,
                    client: new BackpackClient(singleApiKey, singlePrivateKey)
                });
                console.log('✅ 使用单账户配置');
            } else {
                console.error('❌ 未找到有效的账户配置');
                console.log('请在 .env 文件中配置账户信息，格式如下：');
                console.log('ACCOUNT_1_API_KEY=your_api_key_1');
                console.log('ACCOUNT_1_PRIVATE_KEY=your_private_key_1');
                console.log('ACCOUNT_1_NAME=账户1名称');
                console.log('或者使用单账户配置：');
                console.log('API_KEY=your_api_key');
                console.log('PRIVATE_KEY=your_private_key');
                console.log('ACCOUNT_NAME=账户名称');
                process.exit(1);
            }
        }

        console.log(`✅ 加载了 ${this.accounts.length} 个账户配置`);
    }

    /**
     * 获取账户余额
     */
    async getAccountBalance(account) {
        try {
            const balances = await account.client.getBalances();
            
            // 计算所有余额的USD估值
            let totalUsdValue = 0;
            let balanceDetails = {};
            let hasUsdcBalance = false;

            balances.forEach(balance => {
                const symbol = balance.symbol;
                const totalQuantity = parseFloat(balance.totalQuantity);
                const availableQuantity = parseFloat(balance.availableQuantity);
                const lockedQuantity = parseFloat(balance.lockedQuantity);

                // 如果是USDC，直接使用数量作为USD价值
                if (symbol === 'USDC') {
                    balanceDetails[symbol] = {
                        total: totalQuantity,
                        available: availableQuantity,
                        locked: lockedQuantity,
                        usdValue: totalQuantity
                    };
                    totalUsdValue += totalQuantity;
                    hasUsdcBalance = true;
                } else if (totalQuantity > 0) {
                    // 对于其他资产，如果有USD估值字段则使用，否则显示数量
                    const usdValue = balance.balanceNotional ? parseFloat(balance.balanceNotional) : 0;
                    balanceDetails[symbol] = {
                        total: totalQuantity,
                        available: availableQuantity,
                        locked: lockedQuantity,
                        usdValue: usdValue
                    };
                    totalUsdValue += usdValue;
                }
            });

            return {
                balanceDetails,
                totalUsdValue,
                hasUsdcBalance,
                allBalances: balances
            };
        } catch (error) {
            console.error(`❌ 获取账户 ${account.name} 余额失败:`, error.message);
            return null;
        }
    }

    /**
     * 获取最近24小时的交易统计
     */
    async getTradingStats(account) {
        try {
            const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
            
            // 分页获取所有成交记录
            let allFills = [];
            let offset = 0;
            const limit = 1000; // 每次最多1000条
            let hasMore = true;

            while (hasMore) {
                const fills = await account.client.getFillHistory({
                    from: oneDayAgo,
                    to: Date.now(),
                    limit: limit,
                    offset: offset
                });


                if (fills && fills.length > 0) {
                    allFills = allFills.concat(fills);
                    offset += fills.length;
                    
                    // 如果返回的记录数少于limit，说明已经获取完所有记录
                    if (fills.length < limit) {
                        hasMore = false;
                    }
                } else {
                    hasMore = false;
                }

                // 添加延迟避免API限制
                if (hasMore) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }

            let totalVolume = 0;
            let totalFees = 0;
            let tradeCount = 0;
            const symbolStats = {};

            allFills.forEach(fill => {
                const quantity = parseFloat(fill.quantity);
                const price = parseFloat(fill.price);
                const fee = parseFloat(fill.fee);
                const symbol = fill.symbol;

                totalVolume += quantity * price;
                totalFees += fee;
                tradeCount++;

                if (!symbolStats[symbol]) {
                    symbolStats[symbol] = {
                        volume: 0,
                        fees: 0,
                        trades: 0
                    };
                }
                symbolStats[symbol].volume += quantity * price;
                symbolStats[symbol].fees += fee;
                symbolStats[symbol].trades++;
            });

            return {
                totalVolume,
                totalFees,
                tradeCount,
                symbolStats,
                fills: allFills
            };
        } catch (error) {
            console.error(`❌ 获取账户 ${account.name} 交易统计失败:`, error.message);
            return null;
        }
    }

    /**
     * 格式化数字显示
     */
    formatNumber(num, decimals = 2) {
        if (num >= 1000000) {
            return (num / 1000000).toFixed(decimals) + 'M';
        } else if (num >= 1000) {
            return (num / 1000).toFixed(decimals) + 'K';
        } else {
            return num.toFixed(decimals);
        }
    }

    /**
     * 格式化时间显示
     */
    formatTime(timestamp) {
        return new Date(timestamp).toLocaleString('zh-CN');
    }

    /**
     * 查询所有账户信息
     */
    async queryAllAccounts() {
        console.log('\n🚀 开始查询多账户信息...\n');
        
        const results = [];
        
        for (const account of this.accounts) {
            console.log(`📊 正在查询 ${account.name}...`);
            
            const balanceResult = await this.getAccountBalance(account);
            const tradingResult = await this.getTradingStats(account);
            
            if (balanceResult && tradingResult) {
                results.push({
                    account: account,
                    balance: balanceResult,
                    trading: tradingResult
                });
                console.log(`✅ ${account.name} 查询完成`);
            } else {
                console.log(`❌ ${account.name} 查询失败`);
            }
            
            // 添加延迟避免API限制
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        return results;
    }

    /**
     * 显示查询结果
     */
    displayResults(results) {
        console.log('\n' + '='.repeat(80));
        console.log('📈 多账户查询结果汇总');
        console.log('='.repeat(80));

        let totalUsdValue = 0;
        let totalVolume = 0;
        let totalFees = 0;
        let totalTrades = 0;

        results.forEach((result, index) => {
            const { account, balance, trading } = result;
            
            console.log(`\n🏦 ${account.name} (账户${account.number})`);
            console.log('-'.repeat(50));
            
            // 显示账户余额
            console.log('💰 账户余额:');
            if (Object.keys(balance.balanceDetails).length > 0) {
                Object.entries(balance.balanceDetails).forEach(([symbol, amounts]) => {
                    const usdValueText = amounts.usdValue > 0 ? ` (≈$${amounts.usdValue.toFixed(2)})` : '';
                    console.log(`   ${symbol}: ${amounts.total.toFixed(6)} (可用: ${amounts.available.toFixed(6)}, 锁定: ${amounts.locked.toFixed(6)})${usdValueText}`);
                });
            } else {
                console.log('   无余额');
            }
            console.log(`   总USD估值: $${balance.totalUsdValue.toFixed(2)}`);
            
            // 显示交易统计
            console.log('\n📊 最近24小时交易统计:');
            console.log(`   交易次数: ${trading.tradeCount} (已获取所有记录)`);
            console.log(`   总交易量: $${this.formatNumber(trading.totalVolume)}`);
            console.log(`   总手续费: $${trading.totalFees.toFixed(4)}`);
            
            if (Object.keys(trading.symbolStats).length > 0) {
                console.log('\n   按交易对统计:');
                Object.entries(trading.symbolStats)
                    .sort((a, b) => b[1].volume - a[1].volume)
                    .slice(0, 5) // 只显示前5个
                    .forEach(([symbol, stats]) => {
                        console.log(`     ${symbol}: $${this.formatNumber(stats.volume)} (${stats.trades}笔, 手续费: $${stats.fees.toFixed(4)})`);
                    });
            } else {
                console.log('   无交易记录');
            }
            
            // 累计统计
            totalUsdValue += balance.totalUsdValue;
            totalVolume += trading.totalVolume;
            totalFees += trading.totalFees;
            totalTrades += trading.tradeCount;
        });

        // 显示汇总统计
        console.log('\n' + '='.repeat(80));
        console.log('📊 汇总统计');
        console.log('='.repeat(80));
        console.log(`总账户数: ${results.length}`);
        console.log(`总USD价值: $${totalUsdValue.toFixed(2)}`);
        console.log(`总交易量: $${this.formatNumber(totalVolume)}`);
        console.log(`总手续费: $${totalFees.toFixed(4)}`);
        console.log(`总交易次数: ${totalTrades}`);
        console.log(`平均每账户USD价值: $${(totalUsdValue / results.length).toFixed(2)}`);
        console.log(`平均每账户交易量: $${this.formatNumber(totalVolume / results.length)}`);
        console.log(`平均每账户手续费: $${(totalFees / results.length).toFixed(4)}`);
        
        console.log('\n✅ 查询完成！');
    }


    /**
     * 运行查询
     */
    async run() {
        try {
            const results = await this.queryAllAccounts();
            
            if (results.length === 0) {
                console.log('❌ 没有成功查询到任何账户信息');
                return;
            }

            this.displayResults(results);
            
        } catch (error) {
            console.error('❌ 查询过程中发生错误:', error.message);
        }
    }
}

// 主函数
async function main() {
    const query = new MultiAccountQuery();
    await query.run();
}

// 如果直接运行此脚本
if (require.main === module) {
    main().catch(console.error);
}

module.exports = MultiAccountQuery;
