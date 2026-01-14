#!/usr/bin/env node

/**
 * 两账户 USDC 自动平衡脚本
 * 每 30s 检测一次两账户 USDC 余额：
 * - 若任一账户 < 总额的 43%，从高余额账户转至低余额账户，使其达到 46%
 * - 转账时自动赎回借贷资金（autoLendRedeem: true）
 *
 * 使用：
 *   node balance-rebalancer.js
 *
 * 环境变量（.env）：
 *   ACCOUNT_1_API_KEY
 *   ACCOUNT_1_PRIVATE_KEY
 *   ACCOUNT_1_NAME   (可选)
 *   ACCOUNT_2_API_KEY
 *   ACCOUNT_2_PRIVATE_KEY
 *   ACCOUNT_2_NAME   (可选)
 *
 * 可选：
 *   BLOCKCHAIN  默认 'Solana'
 *   MIN_TRANSFER_USDC  默认 0.01
 */

require('dotenv').config();
const BackpackClient = require('./backpack-client');

const INTERVAL_MS = 30_000;
const LOW_THRESHOLD = 0.43;
const TARGET_RATIO = 0.46;
const DEFAULT_BLOCKCHAIN = process.env.BLOCKCHAIN || 'Solana';
const MIN_TRANSFER = parseFloat(process.env.MIN_TRANSFER_USDC || '0.01');

function loadTwoAccounts() {
    const accounts = [];
    [1, 2].forEach(num => {
        const apiKey = process.env[`ACCOUNT_${num}_API_KEY`];
        const privateKey = process.env[`ACCOUNT_${num}_PRIVATE_KEY`];
        const name = process.env[`ACCOUNT_${num}_NAME`] || `账户${num}`;
        if (apiKey && privateKey) {
            accounts.push({
                number: num.toString(),
                name,
                client: new BackpackClient(apiKey, privateKey)
            });
        }
    });
    if (accounts.length !== 2) {
        console.error('❌ 需要正好两个账户 (ACCOUNT_1_*, ACCOUNT_2_*)');
        process.exit(1);
    }
    // 基础校验
    accounts.forEach(acc => {
        const t = typeof acc.client.getBalances;
        console.log(`ℹ️ 账户 ${acc.name} getBalances 类型: ${t}`);
        if (t !== 'function') {
            console.error(`❌ 账户 ${acc.name} client.getBalances 不可用`);
            process.exit(1);
        }
    });
    console.log(`✅ 已加载账户: ${accounts.map(a => a.name).join(' , ')}`);
    return accounts;
}

async function fetchUsdcBalance(account) {
    const client = account.client;
    if (!client || typeof client.getBalances !== 'function') {
        throw new Error(`${account.name} client.getBalances 不可用`);
    }
    const balances = await client.getBalances();
    const usdc = balances.find(b => b.token === 'USDC');
    const available = usdc ? parseFloat(usdc.available || '0') : 0;
    const locked = usdc ? parseFloat(usdc.locked || '0') : 0;
    return { available, locked, total: available + locked };
}

async function transfer(source, target, amount, blockchain) {
    const targetAddr = await target.client.getDepositAddress(blockchain);
    if (!targetAddr || !targetAddr.address) {
        throw new Error('无法获取目标账户存款地址');
    }
    const res = await source.client.requestWithdrawal({
        address: targetAddr.address,
        blockchain,
        quantity: amount.toString(),
        symbol: 'USDC',
        autoLendRedeem: true
    });
    return res;
}

async function rebalanceLoop() {
    const [a, b] = loadTwoAccounts();
    while (true) {
        try {
            const [balA, balB] = await Promise.all([
                fetchUsdcBalance(a),
                fetchUsdcBalance(b)
            ]);

            const total = balA.available + balB.available;
            if (total <= 0) {
                console.log('ℹ️ 可用 USDC 总额为 0，跳过本轮');
                await sleep(INTERVAL_MS);
                continue;
            }

            const ratioA = balA.available / total;
            const ratioB = balB.available / total;
            console.log(`📊 余额：${a.name} 可用 ${balA.available} | ${b.name} 可用 ${balB.available} | 总 ${total.toFixed(6)}`);
            console.log(`📊 占比：${a.name} ${(ratioA * 100).toFixed(2)}% | ${b.name} ${(ratioB * 100).toFixed(2)}%`);

            let low = { account: a, bal: balA };
            let high = { account: b, bal: balB };
            if (balA.available > balB.available) {
                low = { account: b, bal: balB };
                high = { account: a, bal: balA };
            }

            const lowRatio = low.bal.available / total;
            if (lowRatio >= LOW_THRESHOLD) {
                await sleep(INTERVAL_MS);
                continue;
            }

            const targetAmount = TARGET_RATIO * total;
            let need = targetAmount - low.bal.available;
            if (need <= 0) {
                await sleep(INTERVAL_MS);
                continue;
            }

            // 不能超过高账户可用
            need = Math.min(need, high.bal.available);
            if (need < MIN_TRANSFER) {
                console.log(`ℹ️ 需转账 ${need.toFixed(6)} 小于最小阈值 ${MIN_TRANSFER}, 跳过`);
                await sleep(INTERVAL_MS);
                continue;
            }

            console.log(`🚚 转账 ${need.toFixed(6)} USDC: ${high.account.name} -> ${low.account.name} (目标占比 46%)`);
            try {
                const res = await transfer(high.account, low.account, need, DEFAULT_BLOCKCHAIN);
                console.log('✅ 转账完成', { isInternal: res.isInternal, status: res.status });
            } catch (err) {
                console.error('❌ 转账失败', err.message || err);
            }
        } catch (err) {
            console.error('❌ 本轮执行出错:', err.message || err);
        }

        await sleep(INTERVAL_MS);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

if (require.main === module) {
    rebalanceLoop().catch(err => {
        console.error('❌ 程序异常退出:', err);
        process.exit(1);
    });
}

module.exports = { rebalanceLoop };
