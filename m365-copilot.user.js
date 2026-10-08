// ==UserScript==
// @name         m365-copilot-gpt-deep-thinking
// @description  打开 Microsoft 365 Copilot 聊天页或点击「新建聊天」时，自动通过模型选择器菜单将模型设为「GPT-5.6 Sol 深度思考」
// @namespace    https://loongphy.com
// @author       Loongphy
// @license      PolyForm-Noncommercial-1.0.0; https://polyformproject.org/licenses/noncommercial/1.0.0/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=m365.cloud.microsoft
// @version      1.2.1
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
    // 目标模型：「GPT-5.6 Sol」系列的「深度思考」（同组还有「快速思考」，勿混淆）。
    // 兼容两种菜单结构：扁平（菜单项直接叫「GPT-5.6 Sol 深度思考」）
    // 或子菜单（「GPT-5.6 Sol / GPT OpenAI」下含「快速思考」「深度思考」两项）。
    // Sol 系列识别：匹配 "Sol"/"5.6"/"5-6"（兼容 "GPT-5.6" 连字符写法）
    const SOL_RE = /Sol|5[.\-]6/;
    // 「深度思考」菜单项可能出现的文本（中英文界面各一份）
    const DEEP_MARKS = ['深度思考', '深入思考', 'Think deeper', 'Deep thinking', 'Deeper'];
    // 「快速思考」干扰项：命中即排除（必须先于 DEEP 判断，"快速思考" 本身含 "思考"）
    const QUICK_MARKS = ['快速', 'Quick', 'Fast', 'Rapid', '即时'];
    // 按钮缩写文本里代表已选中深度思考的标记（如旧版「GPT 5.6 思考」、可能的「Sol Think」）
    const BTN_DEEP_EXTRA = ['思考', 'Think'];
    // 子菜单触发项（带孙菜单的 menuitem）文本标记：旧版「GPT OpenAI」，新版或为「GPT-5.6 Sol …」
    const SUBMENU_MARKS = ['Sol', '5.6', '5-6', 'OpenAI'];
    // 模型选择按钮（顶部「自动」/当前模型）
    const BTN_SELECTOR = '#gptModeSwitcher';
    // 菜单项匹配超时
    const MENU_TIMEOUT = 3000;
    // 点击后等待菜单关闭的时间
    const CLOSE_DELAY = 350;
    // 点击「新建聊天」/路由变化后，等 SPA 把按钮文本重置为「自动」再检查
    const NAV_DELAY = 500;
    // 兜底轮询间隔（一次 getElementById + 文本比较，开销极小）
    const POLL_INTERVAL = 2000;
    // applyModel 单次触发内的最大尝试次数（点击可能被 SPA 重渲染吞掉）
    const MAX_ATTEMPTS = 3;
    // 展开子菜单的点击被吞后，隔多久补点一次
    const SUBMENU_CLICK_GAP = 700;
    // 可选中项的 role（一般是 menuitemradio；扁平结构兜底含 menuitem/option/checkbox）
    const ITEM_SELECTOR = '[role="menuitemradio"],[role="menuitemcheckbox"],[role="option"],[role="menuitem"]';

    // 归一化文本：合并空白
    function norm(t) {
        return (t || '').replace(/\s+/g, ' ').trim();
    }

    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    function visible(el) {
        return el.getBoundingClientRect().width > 0;
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

    // ==================== 菜单项查找 ====================
    // 查找带子菜单的菜单项（有 aria-haspopup / aria-expanded），文本需命中 Sol/GPT 系列标记
    function findSubmenu() {
        const items = document.querySelectorAll('[role="menuitem"]');
        for (const el of items) {
            if (!el.hasAttribute('aria-haspopup') && !el.hasAttribute('aria-expanded')) continue;
            if (!visible(el)) continue;
            const t = norm(el.textContent);
            if (SUBMENU_MARKS.some(m => t.includes(m))) return el;
        }
        return null;
    }

    // 候选项是否位于 Sol 系列子菜单/分组内：沿祖先链查 menu/listbox/group 的
    // aria-label、aria-labelledby 及首元素文本。
    // 注意：aria-labelledby 的源元素必须带 aria-haspopup（即子菜单触发项）才采信——
    // 主菜单的 labelledby 指向模型按钮本身，选中后按钮文本带 "Sol"，不排掉会误判。
    // group 分组头不是触发项，放宽此限制。
    const MARK_RE = /Sol|5[.\-]6|OpenAI/;
    function inSolMenu(el) {
        let node = el.parentElement;
        while (node && node !== document.body) {
            const role = node.getAttribute && node.getAttribute('role');
            if (role === 'menu' || role === 'listbox' || role === 'group') {
                if (MARK_RE.test(norm(node.getAttribute('aria-label')))) return true;
                const ids = (node.getAttribute('aria-labelledby') || '').split(/\s+/);
                for (const id of ids) {
                    const src = id && document.getElementById(id);
                    if (!src || src.id === 'gptModeSwitcher' || src.closest('#gptModeSwitcher')) continue;
                    if (src.hasAttribute('aria-haspopup') || role === 'group') {
                        if (MARK_RE.test(norm(src.textContent))) return true;
                    }
                }
                const head = node.firstElementChild;
                if (head && head !== el && MARK_RE.test(norm(head.textContent))) return true;
            }
            node = node.parentElement;
        }
        return false;
    }

    // 收集菜单中所有「深度思考」候选项，按与 Sol 的关联度打分排序：
    // 3 = 文本自带 Sol/5.6（如「GPT-5.6 Sol 深度思考」）
    // 2 = 文本只有「深度思考」但位于 Sol 子菜单/分组内
    // 1 = 裸「深度思考」（主菜单默认模型项之类），仅作兜底
    function findTargets() {
        const cands = [];
        for (const el of document.querySelectorAll(ITEM_SELECTOR)) {
            if (el.hasAttribute('aria-haspopup') || !visible(el)) continue;
            const t = norm(el.textContent);
            if (!DEEP_MARKS.some(m => t.includes(m))) continue;
            if (QUICK_MARKS.some(m => t.includes(m))) continue;
            const score = SOL_RE.test(t) ? 3 : (inSolMenu(el) ? 2 : 1);
            cands.push({ el, score });
        }
        return cands.sort((a, b) => b.score - a.score);
    }

    // 在已打开的菜单里定位目标项：发现 Sol 子菜单就先展开（点击被吞按间隔补点），
    // 出现 Sol 关联项立即返回；裸「深度思考」留作兜底。
    // 超时时：存在子菜单说明是嵌套结构，兜底项只认子菜单面板内的项——
    // 主菜单的裸「深度思考」属于默认模型，点它会选错，宁可返回 null 让外层重试。
    async function resolveTarget() {
        const deadline = Date.now() + MENU_TIMEOUT;
        let cands = [];
        let sub = null;
        let subClickAt = 0;
        while (Date.now() < deadline) {
            cands = findTargets();
            if (cands.length && cands[0].score >= 2) return cands[0].el;
            sub = findSubmenu() || sub;
            if (sub && sub.getAttribute('aria-expanded') !== 'true' &&
                Date.now() - subClickAt > SUBMENU_CLICK_GAP) {
                subClickAt = Date.now();
                sub.click();
            }
            await sleep(50);
        }
        if (!cands.length) return null;
        const lastSub = findSubmenu() || sub;
        if (lastSub) {
            const parentMenu = lastSub.closest('[role="menu"],[role="listbox"]');
            const nested = cands.find(c => {
                const cm = c.el.closest('[role="menu"],[role="listbox"]');
                return cm && cm !== parentMenu;
            });
            return nested ? nested.el : null;
        }
        return cands[0].el;
    }

    // 判断当前是否已经选中目标模型。按钮文案四种情况：
    // 不含 Sol 标记（如「自动」）→ 未选中，同时清空 confirmed；
    // 含快速思考标记 → 未选中（同组选错了，需要纠正）；
    // 含深度思考标记 → 已选中；
    // 只显示「GPT-5.6 Sol」无子型号 → 以本会话是否点过目标项（confirmed）为准，
    // 否则会每 POLL_INTERVAL 闪开一次菜单。
    let confirmed = false;
    function alreadySelected(btn) {
        const t = norm(btn.textContent + ' ' +
            (btn.getAttribute('aria-label') || '') + ' ' + (btn.getAttribute('title') || ''));
        if (!SOL_RE.test(t) || QUICK_MARKS.some(m => t.includes(m))) {
            confirmed = false;
            return false;
        }
        if (DEEP_MARKS.concat(BTN_DEEP_EXTRA).some(m => t.includes(m))) return true;
        return confirmed;
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
            if (attempt > 0) await sleep(500);

            // 0. 菜单已打开说明可能是用户在手动选择，不打断
            if (menuOpen()) return;

            // 1. 等待模型选择按钮（顶部「自动」/当前模型）出现
            const btn = await waitFor(BTN_SELECTOR);
            if (!btn) return;
            watchButton(btn); // 按钮可能刚被重建，确保观察的是最新元素

            // 2. 已经是目标模型则跳过
            if (alreadySelected(btn)) return;

            // 3. 点击展开菜单，定位并点击「深度思考」（扁平/子菜单结构自适应，
            //    Sol 子菜单存在时 resolveTarget 会自动展开并补点）
            btn.click();
            const target = await resolveTarget();
            if (!target) { pressEscape(); continue; }
            target.click();
            confirmed = true;

            // 4. 等菜单关闭
            await sleep(CLOSE_DELAY);
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
    //    只有文本从「Sol 思考」变回「自动」（characterData/childList）
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
