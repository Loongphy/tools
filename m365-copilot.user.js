// ==UserScript==
// @name         m365-copilot-gpt-deep-thinking
// @description  打开 Microsoft 365 Copilot 聊天页时，自动通过模型选择器多级菜单将模型设为「GPT 5.6 深度思考」
// @namespace    https://loongphy.com
// @author       Loongphy
// @license      PolyForm-Noncommercial-1.0.0; https://polyformproject.org/licenses/noncommercial/1.0.0/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=m365.cloud.microsoft
// @version      1.0.1
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
    // 菜单项匹配超时
    const MENU_TIMEOUT = 5000;
    // 点击后等待菜单关闭的时间
    const CLOSE_DELAY = 800;

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
            setTimeout(() => { obs.disconnect(); resolve(null); }, timeout || 15000);
        });
    }

    // 轮询查找匹配的菜单项（role + 文本包含，texts 可为字符串或数组）
    async function waitMenuItem(role, texts, timeout) {
        const list = Array.isArray(texts) ? texts : [texts];
        const deadline = Date.now() + (timeout || 5000);
        while (Date.now() < deadline) {
            const items = document.querySelectorAll('[role="' + role + '"]');
            for (const el of items) {
                const text = norm(el.textContent);
                if (list.some(t => text.includes(t)) && el.getBoundingClientRect().width > 0) {
                    return el;
                }
            }
            await new Promise(r => setTimeout(r, 150));
        }
        return null;
    }

    // 判断当前是否已经选中目标模型（按钮文本含 "GPT 5.6" 即已选中，
    // 因为 GPT 5.6 只有「深度思考」一个模式）
    function alreadySelected(btn) {
        return norm(btn.textContent).includes(BTN_MARK);
    }

    async function setModel() {
        // 1. 等待模型选择按钮（顶部「自动」/当前模型）出现
        const btn = await waitFor(BTN_SELECTOR);
        if (!btn) { console.log('[M365-GPT56] 未找到模型选择按钮'); return; }

        // 2. 已经是目标模型则跳过
        if (alreadySelected(btn)) {
            console.log('[M365-GPT56] 已是 ' + norm(btn.textContent));
            return;
        }

        // 3. 点击展开主菜单（自动 / 快速响应 / 深度思考 / GPT…）
        btn.click();

        // 4. 等待主菜单中的 GPT 子菜单项出现并展开它
        //    注意：初始状态文本为「GPT OpenAI」；选中过模型后为「GPT 5.6 深度思考 OpenAI」
        const gptItem = await waitMenuItem('menuitem', 'OpenAI', MENU_TIMEOUT);
        if (!gptItem) { console.log('[M365-GPT56] 未找到 GPT 子菜单'); return; }
        if (gptItem.getAttribute('aria-expanded') !== 'true') {
            gptItem.click(); // 展开子菜单
        }

        // 5. 在子菜单中选择目标模型（menuitemradio「GPT 5.6 深度思考 / GPT 5.6 Think deeper」）
        const target = await waitMenuItem('menuitemradio', TARGETS, MENU_TIMEOUT);
        if (!target) { console.log('[M365-GPT56] 未找到目标项: ' + TARGETS.join(' / ')); return; }
        target.click();

        // 6. 等菜单关闭，确认结果
        await new Promise(r => setTimeout(r, CLOSE_DELAY));
        const finalText = norm(btn.textContent);
        console.log(finalText.includes(BTN_MARK)
            ? '[M365-GPT56] 已设为 ' + finalText
            : '[M365-GPT56] 设置可能失败，当前: ' + finalText);
    }

    // 页面加载完成后执行；SPA 路由变化导致按钮重建时也检查一次
    function start() {
        setModel();
        // 监听按钮节点重建（SPA 内部导航），重建后若仍是「自动」则重新设置
        const obs = new MutationObserver(() => {
            const btn = document.getElementById('gptModeSwitcher');
            if (btn && !alreadySelected(btn)) setModel();
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
        // 页面卸载时清理
        window.addEventListener('pagehide', () => obs.disconnect());
    }

    if (document.readyState === 'complete') {
        start();
    } else {
        window.addEventListener('load', start);
    }
})();
