// ==UserScript==
// @name         m365-copilot-gpt-deep-thinking
// @description  打开 Microsoft 365 Copilot 聊天页时，自动通过模型选择器多级菜单将模型设为「GPT 5.6 深度思考」
// @namespace    https://loongphy.com
// @author       Loongphy
// @license      PolyForm-Noncommercial-1.0.0; https://polyformproject.org/licenses/noncommercial/1.0.0/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=m365.cloud.microsoft
// @version      1.0.3
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

    // 轮询查找匹配的菜单项（role + 文本包含，texts 可为字符串或数组）
    async function waitMenuItem(role, texts, timeout) {
        const list = Array.isArray(texts) ? texts : [texts];
        const deadline = Date.now() + (timeout || 3000);
        while (Date.now() < deadline) {
            const items = document.querySelectorAll('[role="' + role + '"]');
            for (const el of items) {
                const text = norm(el.textContent);
                if (list.some(t => text.includes(t)) && el.getBoundingClientRect().width > 0) {
                    return el;
                }
            }
            await new Promise(r => setTimeout(r, 50));
        }
        return null;
    }

    // 判断当前是否已经选中目标模型（按钮文本含 "GPT 5.6" 即已选中）
    function alreadySelected(btn) {
        return norm(btn.textContent).includes(BTN_MARK);
    }

    async function setModel() {
        // 1. 等待模型选择按钮（顶部「自动」/当前模型）出现
        const btn = await waitFor(BTN_SELECTOR);
        if (!btn) return;

        // 2. 已经是目标模型则跳过
        if (alreadySelected(btn)) return;

        // 3. 点击展开主菜单（自动 / 快速响应 / 深度思考 / GPT…）
        btn.click();

        // 4. 等待主菜单中的 GPT 子菜单项出现并展开它
        //    注意：初始状态文本为「GPT OpenAI」；选中过模型后为「GPT 5.6 深度思考 OpenAI」
        const gptItem = await waitMenuItem('menuitem', 'OpenAI', MENU_TIMEOUT);
        if (!gptItem) return;
        if (gptItem.getAttribute('aria-expanded') !== 'true') {
            gptItem.click(); // 展开子菜单
        }

        // 5. 在子菜单中选择目标模型（menuitemradio「GPT 5.6 深度思考 / GPT 5.6 Think deeper」）
        const target = await waitMenuItem('menuitemradio', TARGETS, MENU_TIMEOUT);
        if (!target) return;
        target.click();

        // 6. 等菜单关闭
        await new Promise(r => setTimeout(r, CLOSE_DELAY));
    }

    // 页面加载完成后执行；SPA 路由变化导致按钮重建时也检查一次（仅观察顶栏，避免全树监听的性能开销）
    function start() {
        setModel();
        let timer = null;
        const header = document.querySelector('header') || document.body;
        const obs = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                const btn = document.getElementById('gptModeSwitcher');
                if (btn && !alreadySelected(btn)) setModel();
            }, 300);
        });
        obs.observe(header, { childList: true, subtree: true });
        window.addEventListener('pagehide', () => { clearTimeout(timer); obs.disconnect(); });
    }

    if (document.readyState === 'complete') {
        start();
    } else if (document.readyState === 'interactive') {
        // DOM 已就绪 즉시 시도, 不必等 window.load（原 load 要等所有资源，慢 1-2s）
        setTimeout(start, 300);
        window.addEventListener('load', start);
    } else {
        window.addEventListener('DOMContentLoaded', start);
        window.addEventListener('load', start);
    }
})();
