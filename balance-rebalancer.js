#!/usr/bin/env node

/**
 * 两账户 USDC 自动平衡脚本
 * 每 30s 检测一次两账户 USDC 余额：
 * - 若任一账户 < 总额的 45%，从高余额账户转至低余额账户，使其达到 50%
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
 *   CHAT_ID          (Telegram chat id)
 *   API_KEY          (本地 3000 端口 Telegram API Key)
 *
 * 可选：
 *   BLOCKCHAIN  默认 'Solana'
 *   MIN_TRANSFER_USDC  默认 0.01
 */

// quiet: true 关闭 dotenv 17 的提示信息（如 "injecting env from .env"）
require('dotenv').config({ quiet: true });
const BackpackClient = require('./backpack-client');
const fetch = require('node-fetch');

const INTERVAL_MS = 30_000;
const LOW_THRESHOLD = 0.45;
const TARGET_RATIO = 0.50;
const DEFAULT_BLOCKCHAIN = process.env.BLOCKCHAIN || 'Solana';
const MIN_TRANSFER = parseFloat(process.env.MIN_TRANSFER_USDC || '0.01');
const TELEGRAM_ENDPOINT = 'http://localhost:3000/send-message';
const ERROR_COOLDOWN_MS = 30 * 60 * 1000;
const BJ_OFFSET_MS = 8 * 60 * 60 * 1000;
const STATS_INTERVAL_MS = 2 * 60 * 60 * 1000;

const errorLastSentAt = new Map();
let warnedMissingTelegramConfig = false;

function formatBeijingTimestamp(nowMs = Date.now()) {
    const bj = new Date(nowMs + BJ_OFFSET_MS);
    const y = bj.getUTCFullYear();
    const m = String(bj.getUTCMonth() + 1).padStart(2, '0');
    const d = String(bj.getUTCDate()).padStart(2, '0');
    const hh = String(bj.getUTCHours()).padStart(2, '0');
    const mm = String(bj.getUTCMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm}`;
}

function getNextStatsAtMs(nowMs = Date.now()) {
    const bj = new Date(nowMs + BJ_OFFSET_MS);
    const year = bj.getUTCFullYear();
    const month = bj.getUTCMonth();
    const day = bj.getUTCDate();
    const hour = bj.getUTCHours();
    let nextHour = hour;
    if (nextHour % 2 !== 0) {
        nextHour += 1;
    }
    let nextBjUtcMs = Date.UTC(year, month, day, nextHour, 1, 0);
    const candidateMs = nextBjUtcMs - BJ_OFFSET_MS;
    if (nowMs > candidateMs) {
        nextBjUtcMs += 2 * 60 * 60 * 1000;
    }
    return nextBjUtcMs - BJ_OFFSET_MS;
}

function buildPrefix(text) {
    return `[${text}]`;
}

function shouldSendError(key, nowMs = Date.now()) {
    const last = errorLastSentAt.get(key);
    if (last && nowMs - last < ERROR_COOLDOWN_MS) {
        return false;
    }
    return true;
}

function markErrorSent(key, nowMs = Date.now()) {
    errorLastSentAt.set(key, nowMs);
    // 简单清理，避免 map 无限制增长
    for (const [k, t] of errorLastSentAt.entries()) {
        if (nowMs - t > ERROR_COOLDOWN_MS * 2) {
            errorLastSentAt.delete(k);
        }
    }
}

async function sendTelegramMessage(prefix, message) {
    const chatId = process.env.CHAT_ID;
    const apiKey = process.env.API_KEY;
    if (!chatId || !apiKey) {
        if (!warnedMissingTelegramConfig) {
            console.warn('⚠️ 缺少 CHAT_ID 或 API_KEY，已跳过 Telegram 消息发送');
            warnedMissingTelegramConfig = true;
        }
        return false;
    }
    const fullMessage = `${prefix} ${message}`;
    const maxRetries = 3;
    const baseDelayMs = 500;
    let lastErr = null;
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        const canAbort = typeof AbortController !== 'undefined';
        const controller = canAbort ? new AbortController() : null;
        const timeout = controller ? setTimeout(() => controller.abort(), 5000) : null;
        try {
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': apiKey
                },
                body: JSON.stringify({ chatId, message: fullMessage })
            };
            if (controller) {
                options.signal = controller.signal;
            }
            const res = await fetch(TELEGRAM_ENDPOINT, {
                ...options
            });
            if (!res.ok) {
                const err = new Error(`Telegram 响应错误: ${res.status} ${res.statusText}`);
                if (res.status < 500 && res.status !== 429) {
                    err.nonRetryable = true;
                }
                throw err;
            }
            return true;
        } catch (err) {
            lastErr = err;
            if (err && err.nonRetryable) {
                console.error('❌ 发送 Telegram 消息失败（不重试）', err.message || err);
                return false;
            }
            if (attempt >= maxRetries) {
                break;
            }
            const backoffMs = Math.min(5_000, baseDelayMs * 2 ** (attempt - 1));
            await sleep(backoffMs);
        } finally {
            if (timeout) {
                clearTimeout(timeout);
            }
        }
    }
    console.error('❌ 发送 Telegram 消息失败（已重试）', lastErr && (lastErr.message || lastErr));
    return false;
}

async function sendErrorOnce(prefix, context, err) {
    const msg = err && err.message ? err.message : String(err);
    const key = `${prefix}|${context}|${msg}`;
    if (!shouldSendError(key)) {
        return;
    }
    const ok = await sendTelegramMessage(prefix, `❌ ${context}: ${msg}`);
    if (ok) {
        markErrorSent(key);
    }
}

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
    let nextStatsAtMs = getNextStatsAtMs();
    while (true) {
        try {
            const [balA, balB] = await Promise.all([
                fetchUsdcBalance(a),
                fetchUsdcBalance(b)
            ]);
            const nowMs = Date.now();
            const totalAvailable = balA.available + balB.available;
            const totalLocked = balA.locked + balB.locked;
            const totalAll = balA.total + balB.total;
            if (nowMs >= nextStatsAtMs) {
                const timeStr = formatBeijingTimestamp(nowMs);
                await sendTelegramMessage(
                    buildPrefix(`${a.name} | ${b.name}`),
                    `📊 余额统计 (${timeStr} 北京时间)\n` +
                    `${a.name} 可用: ${balA.available.toFixed(2)} | 锁定: ${balA.locked.toFixed(2)} | 总计: ${balA.total.toFixed(2)}\n` +
                    `${b.name} 可用: ${balB.available.toFixed(2)} | 锁定: ${balB.locked.toFixed(2)} | 总计: ${balB.total.toFixed(2)}\n` +
                    `🧮 所有账户余额总结\n` +
                    `总可用: ${totalAvailable.toFixed(2)} | 锁定: ${totalLocked.toFixed(2)} | 总计: ${totalAll.toFixed(2)}`
                );
                do {
                    nextStatsAtMs += STATS_INTERVAL_MS;
                } while (nextStatsAtMs <= nowMs);
            }

            const total = totalAvailable;
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

            console.log(`🚚 转账 ${need.toFixed(6)} USDC: ${high.account.name} -> ${low.account.name} (目标占比 50%)`);
            try {
                const res = await transfer(high.account, low.account, need, DEFAULT_BLOCKCHAIN);
                console.log('✅ 转账完成', { isInternal: res.isInternal, status: res.status });
                const prefix = buildPrefix(`${high.account.name} -> ${low.account.name}`);
                await sendTelegramMessage(
                    prefix,
                    `✅ 转账完成 ${need.toFixed(6)} USDC (${DEFAULT_BLOCKCHAIN})\n状态: ${res.status || 'unknown'}\n内部转账: ${res.isInternal === undefined ? 'unknown' : res.isInternal}`
                );
            } catch (err) {
                console.error('❌ 转账失败', err.message || err);
                const prefix = buildPrefix(`${high.account.name} -> ${low.account.name}`);
                await sendErrorOnce(prefix, '转账失败', err);
            }
        } catch (err) {
            console.error('❌ 本轮执行出错:', err.message || err);
            const prefix = buildPrefix(`${a.name}, ${b.name}`);
            await sendErrorOnce(prefix, '本轮执行出错', err);
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
