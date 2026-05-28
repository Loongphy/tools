// ==UserScript==
// @name         x.com 批量屏蔽
// @namespace    https://loongphy.com
// @version      2.0
// @description  基于黑名单csv屏蔽，持久化存储进度
// @author       Loongphy
// @license      PolyForm-Noncommercial-1.0.0; https://polyformproject.org/licenses/noncommercial/1.0.0/
// @match        https://x.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_notification
// @grant        GM_setClipboard
// @connect      x.com
// @connect      twitter.com
// @connect      gist.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ==================== 配置 ====================
    const CONFIG = {
        CSV_URL: 'https://gist.githubusercontent.com/rxliuli/bdd193e4f826ea2bb185e4bf9d6032f7/raw/fa9b4d71862d459d15b470a6828c1eebb412058a/Twitter-Mentions-%25E8%25BE%25BE%25E8%258A%25AC%25E4%25B8%2583%25E5%25A4%25A7%25E5%25B8%2588%25E5%2590%258D%25E5%258D%2595-2057336887400951949-2026-05-26.csv',

        // 存储键
        STATE_KEY: 'x_block_v2_state',

        // API
        BLOCK_API: '/i/api/1.1/blocks/create.json',
        USER_API: '/i/api/graphql/xmU6X_CKVnQ5lSrCbAmJsg/UserByScreenName',

        DEBUG: true
    };

    // ==================== 状态 ====================
    let state = {
        queue: [],             // 待屏蔽队列 [{screen_name, user_id, added_at}]
        blocked: [],           // 已屏蔽 [{screen_name, user_id, blocked_at}]
        errors: [],            // 错误记录 [{screen_name, error, error_at, error_detail}]
        skipped: 0,            // 已跳过（已在黑名单）
        isRunning: false       // 是否正在运行
    };

    // ==================== 速率限制追踪 ====================
    let rateLimit = {
        remaining: 999,
        reset: 0,
        limit: 999
    };

    function updateRateLimit(resp) {
        const h = resp.responseHeaders;
        if (!h) return;
        // 响应头格式："header: value\r\nheader: value\r\n..."
        const get = (name) => {
            const lines = h.split(/\r?\n/);
            for (const line of lines) {
                const idx = line.indexOf(':');
                if (idx === -1) continue;
                const key = line.substring(0, idx).trim().toLowerCase();
                if (key === name) {
                    return parseInt(line.substring(idx + 1).trim());
                }
            }
            return null;
        };
        const rem = get('x-rate-limit-remaining');
        const rst = get('x-rate-limit-reset');
        const lim = get('x-rate-limit-limit');
        if (rem !== null) rateLimit.remaining = rem;
        if (rst !== null) rateLimit.reset = rst;
        if (lim !== null) rateLimit.limit = lim;
    }

    function getDynamicWait() {
        const now = Math.floor(Date.now() / 1000);
        const timeToReset = rateLimit.reset - now;

        if (rateLimit.remaining <= 1 && timeToReset > 0) {
            // 额度即将耗尽，等到重置
            const waitMs = (timeToReset * 1000) + 3000;
            addLog(`⏳ 速率限额用尽，等待 ${Math.ceil(timeToReset)} 秒后重置`, 'info');
            return Math.max(waitMs, 5000);
        }

        if (rateLimit.remaining <= 3 && timeToReset > 0) {
            // 额度很低，保守等待
            return 15000 + Math.floor(Math.random() * 15000); // 15~30s
        }

        if (timeToReset > 0 && rateLimit.remaining > 0) {
            // 计算最优间隔：把剩余额度均匀分布到窗口剩余时间
            const optimalMs = Math.max(500, (timeToReset / rateLimit.remaining) * 1000);
            // 加 ±30% 随机抖动，避免节律性
            const variance = 0.7 + Math.random() * 0.6;
            return Math.round(optimalMs * variance);
        }

        // 首次运行（还未获取到 reset），用 2~5 秒兜底
        return 2000 + Math.floor(Math.random() * 3000);
    }

    function getETA() {
        if (state.queue.length === 0) return null;
        const now = Math.floor(Date.now() / 1000);
        const timeToReset = rateLimit.reset - now;
        if (timeToReset <= 0 || rateLimit.remaining <= 0) return null;

        let totalSec = 0;
        let remain = state.queue.length;
        let quota = rateLimit.remaining;
        let windowEnd = rateLimit.reset;

        while (remain > 0) {
            const batch = Math.min(remain, quota);
            const windowLeft = Math.max(1, windowEnd - Math.floor(Date.now() / 1000) - totalSec);
            if (quota > 0 && windowLeft > 0) {
                const avgSec = windowLeft / quota;
                totalSec += avgSec * batch * 1.2;
                remain -= batch;
            }
            if (remain > 0) {
                // 等下一个窗口
                const waitForReset = Math.max(1, windowEnd - Math.floor(Date.now() / 1000) - totalSec);
                totalSec += waitForReset + 5;
                windowEnd += 900; // 假设 15 分钟窗口
                quota = rateLimit.limit;
            }
        }

        return new Date(Date.now() + totalSec * 1000);
    }

    function formatETA(date) {
        if (!date) return '';
        const diff = Math.ceil((date - new Date()) / 1000);
        if (diff <= 0) return '';
        if (diff < 60) return `预计 ${diff} 秒后完成`;
        if (diff < 3600) return `预计 ${Math.ceil(diff / 60)} 分钟后完成（${date.toLocaleTimeString('zh-CN')}）`;
        const h = Math.floor(diff / 3600);
        const m = Math.ceil((diff % 3600) / 60);
        return `预计 ${h} 小时 ${m} 分钟后完成（${date.toLocaleTimeString('zh-CN')}）`;
    }

    // ==================== 日志 ====================
    function log(...args) {
        if (CONFIG.DEBUG) {
            console.log('[x.com 屏蔽 v2]', ...args);
        }
    }

    // ==================== 持久化存储 ====================
    function saveState() {
        try {
            GM_setValue(CONFIG.STATE_KEY, JSON.stringify({
                queue: state.queue,
                blocked: state.blocked,
                errors: state.errors,
                skipped: state.skipped,
                isRunning: state.isRunning,
                lastSave: new Date().toISOString()
            }));
        } catch (e) {
            log('保存状态失败:', e);
        }
    }

    function loadState() {
        try {
            const raw = GM_getValue(CONFIG.STATE_KEY, null);
            if (!raw) return;

            const saved = JSON.parse(raw);
            state.queue = saved.queue || [];
            state.blocked = saved.blocked || [];
            state.errors = saved.errors || [];
            state.skipped = saved.skipped || 0;
            // isRunning 不恢复，页面刷新后默认停止
            state.isRunning = false;

            log('已恢复状态:', {
                队列: state.queue.length,
                已屏蔽: state.blocked.length,
                错误: state.errors.length,
                已跳过: state.skipped
            });
        } catch (e) {
            log('加载状态失败:', e);
        }
    }

    function resetState() {
        state.queue = [];
        state.blocked = [];
        state.errors = [];
        state.skipped = 0;
        state.isRunning = false;
        saveState();
        log('状态已重置');
    }

    // ==================== 工具函数 ====================
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function formatTime(iso) {
        if (!iso) return '-';
        return new Date(iso).toLocaleString('zh-CN', {
            month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
    }


    function getProgressPercent() {
        const total = state.queue.length + state.blocked.length;
        if (total === 0) return 0;
        return Math.round((state.blocked.length / total) * 100);
    }

    function getProgressText() {
        const total = state.queue.length + state.blocked.length;
        if (total === 0) return '';
        return `已处理 ${state.blocked.length}/${total}（${getProgressPercent()}%）`;
    }

    // ==================== CSV 解析 ====================
    function parseCSV(csvText) {
        const lines = csvText.split('\n');
        const users = [];

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const fields = [];
            let currentField = '';
            let inQuotes = false;

            for (let j = 0; j < line.length; j++) {
                const char = line[j];
                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    fields.push(currentField.trim());
                    currentField = '';
                } else {
                    currentField += char;
                }
            }
            fields.push(currentField.trim());

            if (fields.length >= 3 && fields[2]) {
                users.push({
                    id: fields[0],
                    name: fields[1],
                    screen_name: fields[2].toLowerCase().replace(/^@/, '')
                });
            }
        }
        return users;
    }

    // ==================== 认证 ====================
    function getAuthHeaders() {
        const cookies = document.cookie;
        const ct0 = cookies.match(/ct0=([^;]+)/)?.[1] || '';
        const bearerToken = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

        return {
            'authorization': `Bearer ${bearerToken}`,
            'x-csrf-token': ct0,
            'x-twitter-auth-type': 'OAuth2Session',
            'x-twitter-active-user': 'yes',
            'x-twitter-client-language': 'zh-cn',
            'content-type': 'application/x-www-form-urlencoded',
            'cookie': cookies
        };
    }

    // ==================== API 调用 ====================
    function getUserInfo(screenName) {
        return new Promise((resolve, reject) => {
            const headers = getAuthHeaders();
            const variables = JSON.stringify({
                screen_name: screenName,
                withSafetyModeUserFields: true
            });
            const features = JSON.stringify({
                hidden_profile_subscriptions_enabled: true,
                rweb_tipjar_consumption_enabled: true,
                responsive_web_graphql_exclude_directive_enabled: true,
                verified_phone_label_enabled: false,
                subscriptions_verification_info_is_identity_verified_enabled: true,
                subscriptions_verification_info_verified_since_enabled: true,
                highlights_tweets_tab_ui_enabled: true,
                responsive_web_twitter_article_notes_tab_enabled: true,
                subscriptions_feature_can_gift_premium: true,
                creator_subscriptions_tweet_preview_api_enabled: true,
                responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
                responsive_web_graphql_timeline_navigation_enabled: true
            });

            const url = `https://x.com${CONFIG.USER_API}?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(features)}`;

            GM_xmlhttpRequest({
                method: 'GET',
                url,
                headers,
                onload(resp) {
                    if (resp.status === 200) {
                        try {
                            const result = JSON.parse(resp.responseText);
                            const user = result?.data?.user?.result;
                            if (user?.rest_id) {
                                resolve(user);
                            } else {
                                reject(new Error(`用户 @${screenName} 不存在或已被删除`));
                            }
                        } catch (e) {
                            reject(new Error(`解析用户信息失败: ${e.message}`));
                        }
                    } else if (resp.status === 429) {
                        reject(new Error(`查询限流 (HTTP 429)，请稍后再试`));
                    } else {
                        reject(new Error(`查询用户失败: HTTP ${resp.status}`));
                    }
                },
                onerror(err) {
                    reject(new Error(`网络错误（查询用户）: ${err.error || '未知'}`));
                }
            });
        });
    }

    function blockUser(userId, screenName) {
        return new Promise((resolve, reject) => {
            const headers = getAuthHeaders();
            GM_xmlhttpRequest({
                method: 'POST',
                url: `https://x.com${CONFIG.BLOCK_API}`,
                headers,
                data: `user_id=${userId}`,
                onload(resp) {
                    updateRateLimit(resp);
                    if (resp.status === 200) {
                        try {
                            const result = JSON.parse(resp.responseText);
                            // 成功时返回被屏蔽用户的对象（含 id）
                            if (result && (result.id_str == userId || result.id == userId)) {
                                resolve(true);
                            } else {
                                reject(new Error(`屏蔽返回异常: ${resp.responseText.substring(0, 120)}`));
                            }
                        } catch (e) {
                            reject(new Error(`解析屏蔽响应失败: ${e.message}`));
                        }
                    } else if (resp.status === 429) {
                        reject(new Error(`屏蔽限流 (HTTP 429)，请稍后再试`));
                    } else {
                        reject(new Error(`屏蔽失败: HTTP ${resp.status} - ${resp.responseText.substring(0, 200)}`));
                    }
                },
                onerror(err) {
                    reject(new Error(`网络错误（屏蔽）: ${err.error || '未知'}`));
                }
            });
        });
    }

    // ==================== 核心：单个屏蔽流程 ====================
    async function blockOne(screenName, userId) {
        let displayName = screenName;

        if (userId) {
            // 已有 ID，直接屏蔽（来自 CSV 或之前已解析）
            addLog(`屏蔽 @${screenName} (ID: ${userId}) ...`, 'info');
        } else {
            // 没有 ID，先查询用户信息（粘贴数据等场景）
            addLog(`查询 @${screenName} ...`, 'info');
            const userInfo = await getUserInfo(screenName);
            userId = userInfo.rest_id;
            displayName = userInfo.legacy?.name || screenName;
            addLog(`找到 @${screenName} (${displayName}, ID: ${userId})`, 'info');
        }

        // 执行屏蔽
        await blockUser(userId, screenName);

        // 记录成功
        state.blocked.push({
            screen_name: screenName,
            user_id: userId,
            display_name: displayName,
            blocked_at: new Date().toISOString()
        });
        saveState();
        addLog(`✅ 已屏蔽 @${screenName}${displayName !== screenName ? ` (${displayName})` : ''}`, 'success');
    }

    // ==================== 核心：队列处理 ====================
    async function processQueue() {
        while (state.isRunning && state.queue.length > 0) {
            const item = state.queue[0];
            const screenName = item.screen_name;
            const userId = item.user_id;

            try {
                updateUI(`正在屏蔽 @${screenName}（队列 ${state.queue.length} 个）`);
                await blockOne(screenName, userId);

                // 从队列移除
                state.queue.shift();
                saveState();
                updateUI();

                // 间隔等待（根据速率限制动态调整）
                if (state.isRunning && state.queue.length > 0) {
                    const wait = getDynamicWait();
                    const waitSec = (wait / 1000).toFixed(0);
                    addLog(`⏱️ 等待 ${waitSec} 秒（剩余额度 ${rateLimit.remaining}/${rateLimit.limit}）`, 'info');
                    updateUI(`等待 ${waitSec} 秒后继续...`);
                    await sleep(wait);
                }

            } catch (error) {
                // === 遇错即停 ===
                state.isRunning = false;

                const errorRecord = {
                    screen_name: screenName,
                    error: error.message,
                    error_at: new Date().toISOString(),
                    queue_position: 0
                };
                state.errors.push(errorRecord);

                // 不从队列移除，下次可以继续
                saveState();

                const errorMsg = `❌ 屏蔽 @${screenName} 失败，已停止！\n\n错误：${error.message}`;
                addLog(errorMsg, 'error');

                GM_notification({
                    title: '屏蔽出错，已停止',
                    text: `@${screenName}: ${error.message}`,
                    timeout: 10000
                });

                updateUI(`❌ 错误：${error.message}`);
                return;
            }
        }

        // 队列清空
        if (!state.isRunning) return; // 手动停止
        state.isRunning = false;
        addLog('🎉 全部完成！', 'success');
        GM_notification({ title: '全部完成', text: `共屏蔽 ${state.blocked.length} 个账号`, timeout: 5000 });
        saveState();
        updateUI('全部完成！');
    }

    // ==================== UI ====================
    let panelEl = null;
    let logEntries = [];

    function createStyles() {
        GM_addStyle(`
            #xb-panel {
                position: fixed; bottom: 20px; right: 20px; width: 400px;
                background: #0f1419; border: 1px solid #2f3336; border-radius: 16px;
                color: #e7e9ea; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                font-size: 13px; z-index: 99999;
                box-shadow: 0 8px 32px rgba(0,0,0,0.6);
                max-height: 85vh; display: flex; flex-direction: column;
            }
            #xb-panel * { box-sizing: border-box; }
            .xb-hdr {
                display: flex; align-items: center; justify-content: space-between;
                padding: 14px 16px; background: #1d9bf0; border-radius: 16px 16px 0 0;
                cursor: move; user-select: none; flex-shrink: 0;
            }
            .xb-hdr h3 { margin: 0; font-size: 14px; font-weight: 700; color: #fff; }
            .xb-hdr-btns { display: flex; gap: 6px; }
            .xb-hdr-btn {
                background: rgba(255,255,255,0.15); border: none; color: #fff;
                cursor: pointer; padding: 4px 10px; border-radius: 6px; font-size: 12px;
            }
            .xb-hdr-btn:hover { background: rgba(255,255,255,0.3); }
            .xb-body { padding: 16px; overflow-y: auto; flex: 1; }

            .xb-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
            .xb-stat { text-align: center; padding: 10px 4px; background: #16202a; border-radius: 10px; }
            .xb-stat-num { font-size: 22px; font-weight: 700; color: #1d9bf0; }
            .xb-stat-lbl { font-size: 10px; color: #71767b; margin-top: 2px; }

            .xb-eta {
                padding: 6px 14px; margin-bottom: 4px;
                color: #1d9bf0; font-size: 11px; text-align: center;
                font-variant-numeric: tabular-nums;
            }

            .xb-status {
                padding: 10px 14px; background: #16202a; border-radius: 10px;
                margin-bottom: 14px; color: #71767b; font-size: 12px;
                word-break: break-all; white-space: pre-wrap;
            }
            .xb-status.error { color: #f4212e; background: #2a1014; }
            .xb-status.success { color: #00ba7c; }

            .xb-btns { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
            .xb-btn {
                flex: 1; min-width: 70px; padding: 9px 12px; border: none;
                border-radius: 20px; font-size: 12px; font-weight: 600;
                cursor: pointer; transition: all 0.15s;
            }
            .xb-btn:disabled { opacity: 0.4; cursor: not-allowed; }
            .xb-btn.pri { background: #1d9bf0; color: #fff; }
            .xb-btn.pri:hover:not(:disabled) { background: #1a8cd8; }
            .xb-btn.sec { background: #2f3336; color: #e7e9ea; }
            .xb-btn.sec:hover:not(:disabled) { background: #3e4144; }
            .xb-btn.dan { background: #f4212e; color: #fff; }
            .xb-btn.dan:hover:not(:disabled) { background: #dc1d27; }
            .xb-btn.wrn { background: #ffd400; color: #0f1419; }

            .xb-section { margin-bottom: 14px; }
            .xb-section-hdr {
                display: flex; justify-content: space-between; align-items: center;
                margin-bottom: 6px; cursor: pointer; user-select: none;
            }
            .xb-section-hdr h4 { margin: 0; font-size: 12px; color: #71767b; }
            .xb-section-hdr .arrow { color: #71767b; font-size: 10px; transition: transform 0.2s; }
            .xb-section-hdr .arrow.open { transform: rotate(90deg); }

            .xb-list {
                max-height: 200px; overflow-y: auto; background: #16202a;
                border-radius: 8px; font-size: 11px;
            }
            .xb-list:empty { display: none; }
            .xb-list-item {
                padding: 6px 10px; border-bottom: 1px solid #1e2732;
                display: flex; justify-content: space-between; align-items: center;
            }
            .xb-list-item:last-child { border-bottom: none; }
            .xb-list-item .name { color: #1d9bf0; }
            .xb-list-item .time { color: #71767b; font-size: 10px; }
            .xb-list-item .err { color: #f4212e; font-size: 10px; max-width: 200px; word-break: break-all; }

            .xb-log {
                max-height: 160px; overflow-y: auto; background: #16202a;
                border-radius: 8px; padding: 8px 10px; font-size: 11px;
                color: #71767b; font-family: 'SF Mono', Menlo, monospace;
            }
            .xb-log:empty::after { content: '暂无日志'; }
            .xb-log-line { padding: 2px 0; }
            .xb-log-line.error { color: #f4212e; }
            .xb-log-line.success { color: #00ba7c; }
            .xb-log-line.info { color: #71767b; }

            /* 滚动条 */
            .xb-list::-webkit-scrollbar, .xb-log::-webkit-scrollbar { width: 4px; }
            .xb-list::-webkit-scrollbar-thumb, .xb-log::-webkit-scrollbar-thumb {
                background: #2f3336; border-radius: 2px;
            }

            #xb-badge {
                position: fixed; bottom: 20px; right: 20px;
                background: #1d9bf0; color: #fff;
                width: 50px; height: 50px; border-radius: 50%;
                display: flex; align-items: center; justify-content: center;
                cursor: pointer; z-index: 99999; font-size: 20px;
                box-shadow: 0 4px 16px rgba(29,155,240,0.4);
            }

            /* 进度条 */
            .xb-progress { margin-bottom: 14px; }
            .xb-progress-bar {
                height: 6px; background: #2f3336; border-radius: 3px;
                overflow: hidden; margin-bottom: 4px;
            }
            .xb-progress-fill {
                height: 100%; background: #1d9bf0; border-radius: 3px;
                transition: width 0.3s ease;
            }
            .xb-progress-text {
                font-size: 11px; color: #71767b; text-align: right;
                font-variant-numeric: tabular-nums;
            }

        `);
    }

    function createUI() {
        panelEl = document.createElement('div');
        panelEl.id = 'xb-panel';
        document.body.appendChild(panelEl);
        renderPanel();
    }

    function renderPanel() {
        panelEl.innerHTML = `
            <div class="xb-hdr">
                <h3>🛡️ 批量屏蔽 v2</h3>
                <div class="xb-hdr-btns">
                    <button class="xb-hdr-btn" id="xb-min">最小化</button>
                </div>
            </div>
            <div class="xb-body">
                <div class="xb-stats">
                    <div class="xb-stat">
                        <div class="xb-stat-num" id="xb-s-queue">${state.queue.length}</div>
                        <div class="xb-stat-lbl">队列</div>
                    </div>
                    <div class="xb-stat">
                        <div class="xb-stat-num" id="xb-s-done">${state.blocked.length}</div>
                        <div class="xb-stat-lbl">已屏蔽</div>
                    </div>
                    <div class="xb-stat">
                        <div class="xb-stat-num" id="xb-s-err">${state.errors.length}</div>
                        <div class="xb-stat-lbl">错误</div>
                    </div>
                    <div class="xb-stat">
                        <div class="xb-stat-num" id="xb-s-skip">${state.skipped}</div>
                        <div class="xb-stat-lbl">已跳过</div>
                    </div>
                </div>

                <div class="xb-progress" id="xb-progress" style="${state.queue.length > 0 || state.blocked.length > 0 ? '' : 'display:none'}">
                    <div class="xb-progress-bar">
                        <div class="xb-progress-fill" id="xb-progress-fill" style="width:${getProgressPercent()}%"></div>
                    </div>
                    <div class="xb-progress-text" id="xb-progress-text">${getProgressText()}</div>
                </div>

                <div class="xb-eta" id="xb-eta"></div>

                <div class="xb-status" id="xb-status">${getStatusText()}</div>

                <div class="xb-btns">
                    <button class="xb-btn pri" id="xb-start">${state.isRunning ? '运行中...' : '▶ 开始'}</button>
                    <button class="xb-btn sec" id="xb-stop" ${!state.isRunning ? 'disabled' : ''}>⏹ 停止</button>
                    <button class="xb-btn sec" id="xb-export">📤 导出</button>
                    <button class="xb-btn dan" id="xb-reset">🗑 重置</button>
                </div>

                <!-- 错误记录 -->
                <div class="xb-section">
                    <div class="xb-section-hdr" id="xb-err-hdr">
                        <h4>❌ 错误记录 (${state.errors.length})</h4>
                        <span class="arrow">▶</span>
                    </div>
                    <div class="xb-list" id="xb-err-list" style="display:none">
                        ${state.errors.slice(-50).reverse().map(e => `
                            <div class="xb-list-item">
                                <span class="name">@${e.screen_name}</span>
                                <span class="err">${e.error}</span>
                                <span class="time">${formatTime(e.error_at)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- 已屏蔽记录 -->
                <div class="xb-section">
                    <div class="xb-section-hdr" id="xb-done-hdr">
                        <h4>✅ 已屏蔽 (${state.blocked.length})</h4>
                        <span class="arrow">▶</span>
                    </div>
                    <div class="xb-list" id="xb-done-list" style="display:none">
                        ${state.blocked.slice(-50).reverse().map(b => `
                            <div class="xb-list-item">
                                <span class="name">@${b.screen_name}</span>
                                <span class="time">${formatTime(b.blocked_at)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- 运行日志 -->
                <div class="xb-section">
                    <div class="xb-section-hdr" id="xb-log-hdr">
                        <h4>📋 运行日志</h4>
                        <span class="arrow open">▶</span>
                    </div>
                    <div class="xb-log" id="xb-log">
                        ${logEntries.slice(-80).map(l =>
                            `<div class="xb-log-line ${l.type}">[${l.time}] ${l.msg}</div>`
                        ).join('')}
                    </div>
                </div>
            </div>
        `;

        // 绑定事件
        document.getElementById('xb-min').addEventListener('click', minimizePanel);
        document.getElementById('xb-start').addEventListener('click', startBlocking);
        document.getElementById('xb-stop').addEventListener('click', stopBlocking);
        document.getElementById('xb-export').addEventListener('click', exportData);
        document.getElementById('xb-reset').addEventListener('click', resetAll);

        // 折叠
        setupToggle('xb-err-hdr', 'xb-err-list');
        setupToggle('xb-done-hdr', 'xb-done-list');
        setupToggle('xb-log-hdr', 'xb-log');
    }

    function setupToggle(hdrId, listId) {
        const hdr = document.getElementById(hdrId);
        const list = document.getElementById(listId);
        if (!hdr || !list) return;
        hdr.addEventListener('click', () => {
            const arrow = hdr.querySelector('.arrow');
            if (list.style.display === 'none') {
                list.style.display = 'block';
                arrow.classList.add('open');
            } else {
                list.style.display = 'none';
                arrow.classList.remove('open');
            }
        });
    }

    function getStatusText() {
        if (state.isRunning) return '⏳ 运行中...';
        if (state.queue.length === 0 && state.blocked.length > 0) return '🎉 全部完成';
        if (state.queue.length > 0) return `就绪，队列 ${state.queue.length} 个`;
        return '等待导入清单';
    }

    function addLog(msg, type = 'info') {
        const time = new Date().toLocaleTimeString('zh-CN');
        logEntries.push({ time, msg, type });
        log(`[${type}] ${msg}`);

        const logEl = document.getElementById('xb-log');
        if (logEl) {
            const line = document.createElement('div');
            line.className = `xb-log-line ${type}`;
            line.textContent = `[${time}] ${msg}`;
            logEl.appendChild(line);
            logEl.scrollTop = logEl.scrollHeight;
            // 限制日志数量
            while (logEl.children.length > 100) logEl.removeChild(logEl.firstChild);
        }
    }

    function updateUI(statusMsg) {
        const el = (id) => document.getElementById(id);
        if (el('xb-s-queue')) el('xb-s-queue').textContent = state.queue.length;
        if (el('xb-s-done')) el('xb-s-done').textContent = state.blocked.length;
        if (el('xb-s-err')) el('xb-s-err').textContent = state.errors.length;
        if (el('xb-s-skip')) el('xb-s-skip').textContent = state.skipped;

        // 进度条
        const progressEl = el('xb-progress');
        if (progressEl) {
            const total = state.queue.length + state.blocked.length;
            if (total > 0) {
                progressEl.style.display = 'block';
                const fill = el('xb-progress-fill');
                if (fill) fill.style.width = `${getProgressPercent()}%`;
                const text = el('xb-progress-text');
                if (text) text.textContent = getProgressText();
            } else {
                progressEl.style.display = 'none';
            }
        }

        // ETA
        const etaEl = el('xb-eta');
        if (etaEl) {
            if (state.isRunning && state.queue.length > 0) {
                const eta = getETA();
                etaEl.textContent = formatETA(eta) || '';
                etaEl.style.display = eta ? '' : 'none';
            } else {
                etaEl.style.display = 'none';
            }
        }

        const statusEl = el('xb-status');
        if (statusEl) {
            statusEl.textContent = statusMsg || getStatusText();
            statusEl.className = 'xb-status';
            if (statusMsg?.startsWith('❌')) statusEl.classList.add('error');
            else if (statusMsg?.startsWith('🎉') || statusMsg?.startsWith('✅')) statusEl.classList.add('success');
        }

        const startBtn = el('xb-start');
        const stopBtn = el('xb-stop');
        if (startBtn) {
            startBtn.disabled = state.isRunning || state.queue.length === 0;
            startBtn.textContent = state.isRunning ? '运行中...' : '▶ 开始';
        }
        if (stopBtn) stopBtn.disabled = !state.isRunning;

        // 更新错误计数
        const errHdr = el('xb-err-hdr');
        if (errHdr) errHdr.querySelector('h4').textContent = `❌ 错误记录 (${state.errors.length})`;
    }

    // ==================== 操作函数 ====================
    async function startBlocking() {
        if (state.isRunning) return;
        if (state.queue.length === 0) {
            addLog('队列为空，请先导入清单', 'error');
            return;
        }
        state.isRunning = true;
        saveState();
        addLog('▶ 开始执行', 'success');
        updateUI();
        await processQueue();
    }

    function stopBlocking() {
        state.isRunning = false;
        saveState();
        addLog('⏹ 已手动停止', 'info');
        updateUI('已停止');
    }

    async function loadCSV(url) {
        const targetUrl = url || CONFIG.CSV_URL;
        addLog(`📥 加载清单: ${targetUrl.substring(0, 60)}...`, 'info');

        try {
            const resp = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: targetUrl,
                    onload: resolve,
                    onerror: () => reject(new Error('网络请求失败'))
                });
            });

            if (resp.status !== 200) {
                throw new Error(`HTTP ${resp.status}`);
            }

            const users = parseCSV(resp.responseText);
            const blockedNames = new Set(state.blocked.map(b => b.screen_name));
            const queuedNames = new Set(state.queue.map(q => q.screen_name));

            let newCount = 0;
            let skippedBlocked = 0;
            for (const u of users) {
                if (blockedNames.has(u.screen_name)) {
                    skippedBlocked++;
                    continue;
                }
                if (queuedNames.has(u.screen_name)) {
                    continue;
                }
                state.queue.push({
                    screen_name: u.screen_name,
                    user_id: u.id || null,
                    added_at: new Date().toISOString()
                });
                queuedNames.add(u.screen_name);
                newCount++;
            }

            state.skipped += skippedBlocked;
            saveState();
            let msg = `✅ 导入完成: 新增 ${newCount} 个`;
            if (skippedBlocked > 0) msg += `，已跳过 ${skippedBlocked} 个已屏蔽用户`;
            msg += `，队列共 ${state.queue.length} 个`;
            addLog(msg, 'success');
            updateUI();
        } catch (e) {
            addLog(`❌ 导入失败: ${e.message}`, 'error');
        }
    }

    function exportData() {
        const data = {
            exported_at: new Date().toISOString(),
            queue: state.queue,
            blocked: state.blocked,
            errors: state.errors,
            summary: {
                total_queued: state.queue.length,
                total_blocked: state.blocked.length,
                total_errors: state.errors.length
            }
        };
        const json = JSON.stringify(data, null, 2);

        // 复制到剪贴板
        try {
            GM_setClipboard(json, 'text');
            addLog('📤 数据已复制到剪贴板', 'success');
        } catch {
            // 回退：下载文件
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `x-block-export-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            addLog('📤 数据已下载为文件', 'success');
        }
    }

    function resetAll() {
        if (!confirm('确定要重置所有数据？\n\n将清空：队列、已屏蔽记录、错误记录\n\n此操作不可撤销。')) return;
        resetState();
        logEntries = [];
        addLog('🗑 已重置所有数据', 'info');
        updateUI('已重置');
        renderPanel();
    }

    function minimizePanel() {
        if (!panelEl) return;
        panelEl.style.display = 'none';

        let badge = document.getElementById('xb-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'xb-badge';
            badge.textContent = '🛡️';
            badge.addEventListener('click', () => {
                badge.remove();
                panelEl.style.display = 'flex';
                updateUI();
            });
            document.body.appendChild(badge);
        }
    }

    // ==================== 启动 ====================
    function main() {
        log('脚本 v2.0 启动');
        loadState();
        createStyles();
        createUI();
        addLog('脚本已加载', 'info');
        if (state.queue.length > 0) {
            addLog(`恢复队列 ${state.queue.length} 个，点击"开始"继续`, 'info');
        } else {
            // 首次运行，自动加载默认 Gist
            addLog('🔄 自动加载默认清单...', 'info');
            loadCSV(CONFIG.CSV_URL);
        }
        if (state.errors.length > 0) {
            addLog(`上次有 ${state.errors.length} 个错误，请检查后重试`, 'error');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main);
    } else {
        main();
    }
})();
