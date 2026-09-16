// ==UserScript==
// @name         m365-copilot-gpt-deep-thinking
// @description  打开 Microsoft 365 Copilot 聊天页或点击「新建聊天」时，自动通过模型选择器多级菜单将模型设为「GPT 5.6 深度思考」
// @namespace    https://loongphy.com
// @author       Loongphy
// @license      PolyForm-Noncommercial-1.0.0; https://polyformproject.org/licenses/noncommercial/1.0.0/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=m365.cloud.microsoft
// @version      1.1.0
// @match        https://m365.cloud.microsoft/chat*
// @match        https://m365.cloud.microsoft/*
// @match        https://copilot.cloud.microsoft/chat*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    // ==================== 配置 ====================
    // 目标模型（页面实际显示文本；注意是空格 "GPT 5.6"，不是连字符。中英文界面各一份）
    // 实测：中文界面「GPT 5.6 深度思考」，英文界面「GPT 5.6 Think deeper」
    const TARGETS = ['GPT 5.6 深度思考', 'GPT 5.6 Think deeper'];
    // 按钮上显示的缩写文本（选中后按钮显示 "GPT 5.6 思考" / "GPT 5.6 Think"，取模型名共有的前缀）
    const BTN_MARK = 'GPT 5.6';
    // 模型选择按钮（顶部「自动」/当前模型）
    const BTN_SELECTOR = '#gptModeSwitcher';
    // 菜单项匹配超时（原 5000，实测菜单 200ms 内出现，缩短以提速）
    const MENU_TIMEOUT = 3000;
    // 点击后等待菜单关闭的时间（原 800，缩短）
    const CLOSE_DELAY = 350;
    // 点击「新建聊天」/路由变化后，等 SPA 把按钮文本重置为「自动」再检查
    const NAV_DELAY = 500;
    // 兜底轮询间隔（一次 getElementById + 文本比较，开销极小）
    const POLL_INTERVAL = 2000;
    // applyModel 单次触发内的最大尝试次数（点击可能被 SPA 重渲染吞掉）
    const MAX_ATTEMPTS = 3;

    // 归一化文本：合并空白
    function norm(t) {
        return (t || '').replace(/\s+/g, ' ').trim();
    }

    // 等待选择器出现（SPA 动态渲染，按钮可能延迟出现）
    function waitFor(selector, timeout) {
        return new Promise((resolve) => {
            const el = document.querySelector(selector);
            if (el) return resolve(el);
            const obs = new MutationObserver(() => {
                const found = document.querySelector(selector);
                if (found) { obs.disconnect(); resolve(found); }
            });
            obs.observe(document.documentElement, { childList: true, subtree: true });
            setTimeout(() => { obs.disconnect(); resolve(null); }, timeout || 8000);
        });
    }

    // 同步查找匹配的可见菜单项（role + 文本包含，texts 可为字符串或数组）
    function findMenuItem(role, texts) {
        const list = Array.isArray(texts) ? texts : [texts];
        const items = document.querySelectorAll('[role="' + role + '"]');
        for (const el of items) {
            const text = norm(el.textContent);
            if (list.some(t => text.includes(t)) && el.getBoundingClientRect().width > 0) {
                return el;
            }
        }
        return null;
    }

    // 轮询等待匹配的菜单项出现
    async function waitMenuItem(role, texts, timeout) {
        const deadline = Date.now() + (timeout || 3000);
        while (Date.now() < deadline) {
            const el = findMenuItem(role, texts);
            if (el) return el;
            await new Promise(r => setTimeout(r, 50));
        }
        return null;
    }

    // 判断当前是否已经选中目标模型（按钮文本含 "GPT 5.6" 即已选中）
    function alreadySelected(btn) {
        return norm(btn.textContent).includes(BTN_MARK);
    }

    // 菜单是否正处于打开状态（用户手动打开时不要打断）
    function menuOpen() {
        const btn = document.getElementById('gptModeSwitcher');
        return (btn && btn.getAttribute('aria-expanded') === 'true') ||
            !!document.querySelector('[role="menu"]');
    }

    // ==================== 触发调度 ====================
    // running/queued 保证不会重入：执行期间又有新触发时，结束后再补跑一次
    let running = false;
    let queued = false;
    let timer = null;

    function scheduleCheck(delay) {
        clearTimeout(timer);
        timer = setTimeout(setModel, delay == null ? 300 : delay);
    }

    async function setModel() {
        if (running) { queued = true; return; }
        running = true;
        try {
            do {
                queued = false;
                await applyModel();
            } while (queued);
        } finally {
            running = false;
        }
    }

    // ==================== 模型切换主流程 ====================
    // 点击「新建聊天」后 SPA 正在重渲染，第一次点击可能被吞/菜单被关，
    // 因此带重试：每轮重新查询按钮与菜单项（旧元素可能已失效）。
    async function applyModel() {
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            if (attempt > 0) await new Promise(r => setTimeout(r, 500));

            // 0. 菜单已打开说明可能是用户在手动选择，不打断
            if (menuOpen()) return;

            // 1. 等待模型选择按钮（顶部「自动」/当前模型）出现
            const btn = await waitFor(BTN_SELECTOR);
            if (!btn) return;
            watchButton(btn); // 按钮可能刚被重建，确保观察的是最新元素

            // 2. 已经是目标模型则跳过
            if (alreadySelected(btn)) return;

            // 3. 点击展开主菜单（自动 / 快速响应 / 深度思考 / GPT…）
            btn.click();

            // 4. 等待主菜单中的 GPT 子菜单项出现并展开它
            //    注意：初始状态文本为「GPT OpenAI」；选中过模型后为「GPT 5.6 深度思考 OpenAI」
            const gptItem = await waitMenuItem('menuitem', 'OpenAI', MENU_TIMEOUT);
            if (!gptItem) { pressEscape(); continue; }
            if (gptItem.getAttribute('aria-expanded') !== 'true') {
                gptItem.click(); // 展开子菜单
            }

            // 5. 在子菜单中选择目标模型（menuitemradio「GPT 5.6 深度思考 / GPT 5.6 Think deeper」）
            //    子菜单可能因第一次点击被吞而未展开：先等一小段，没有再点一次
            let target = await waitMenuItem('menuitemradio', TARGETS, 800);
            if (!target) {
                const retry = findMenuItem('menuitem', 'OpenAI');
                if (retry) retry.click();
                target = await waitMenuItem('menuitemradio', TARGETS, MENU_TIMEOUT);
            }
            if (!target) { pressEscape(); continue; }
            target.click();

            // 6. 等菜单关闭
            await new Promise(r => setTimeout(r, CLOSE_DELAY));
            return;
        }
    }

    // 菜单没找到目标项时按 Esc 收起，避免菜单一直挂着
    function pressEscape() {
        document.activeElement && document.activeElement.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        document.body.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }

    // ==================== 三类触发源 ====================
    // 1) 观察按钮自身文本变化：点「新建聊天」时按钮不重建、URL 不变，
    //    只有文本从「GPT 5.6 思考」变回「自动」（characterData/childList）
    let watchedBtn = null;
    let btnObs = null;
    function watchButton(btn) {
        if (btn === watchedBtn) return;
        if (btnObs) btnObs.disconnect();
        watchedBtn = btn;
        if (!btn) return;
        btnObs = new MutationObserver(() => {
            if (!alreadySelected(btn)) scheduleCheck(300);
        });
        btnObs.observe(btn, { childList: true, subtree: true, characterData: true });
    }

    // 2) 捕获阶段监听点击：命中指向 /chat 的链接（「新建聊天」「聊天」tab 等）时主动检查。
    //    同 URL 点击不会触发 history 事件，必须靠这个兜底。
    document.addEventListener('click', (e) => {
        const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
        if (!a) return;
        try {
            if (/\/chat\/?$/.test(new URL(a.href, location.href).pathname)) {
                scheduleCheck(NAV_DELAY);
            }
        } catch (_) { /* 忽略异常 href */ }
    }, true);

    // 3) SPA 路由变化：首页发消息跳 /chat、点历史会话等
    ['pushState', 'replaceState'].forEach((m) => {
        const orig = history[m];
        history[m] = function () {
            const r = orig.apply(this, arguments);
            scheduleCheck(NAV_DELAY);
            return r;
        };
    });
    window.addEventListener('popstate', () => scheduleCheck(NAV_DELAY));
    window.addEventListener('hashchange', () => scheduleCheck(NAV_DELAY));

    // 4) 轻量轮询兜底：按钮被整体重建（观察器挂在旧元素上）或漏网时仍能纠回
    setInterval(() => {
        const btn = document.getElementById('gptModeSwitcher');
        if (!btn) return;
        if (btn !== watchedBtn) watchButton(btn);
        if (!menuOpen() && !alreadySelected(btn)) scheduleCheck(0);
    }, POLL_INTERVAL);

    // ==================== 启动 ====================
    async function start() {
        watchButton(await waitFor(BTN_SELECTOR));
        setModel();
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(start, 300);
    } else {
        window.addEventListener('DOMContentLoaded', start);
    }
    window.addEventListener('pagehide', () => { clearTimeout(timer); if (btnObs) btnObs.disconnect(); });
})();
