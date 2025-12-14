// ==UserScript==
// @name         X Cleaner
// @description  Hide Annoying left sidebar links and remove right sidebar clutter on X.com.
// @namespace    https://loongphy.com
// @author       Loongphy
// @license      PolyForm-Noncommercial-1.0.0; https://polyformproject.org/licenses/noncommercial/1.0.0/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=x.com
// @version      1.0.0
// @match        https://x.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  if (window.__xCleanerInstalled) return;
  window.__xCleanerInstalled = true;

  const CONFIG = {
    demoMode: false,
    demoBlurPx: 12,
  };

  const DEMO_STYLE_ID = 'x-cleaner-demo-style';

  const STORE_KEY_DEMO_MODE = 'x-cleaner-demo-mode';

  function gmGetValue(key, defaultValue) {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(key, defaultValue);
    } catch (e) { }
    try {
      if (typeof GM !== 'undefined' && typeof GM.getValue === 'function') return GM.getValue(key, defaultValue);
    } catch (e) { }
    return defaultValue;
  }

  function gmSetValue(key, value) {
    try {
      if (typeof GM_setValue === 'function') return GM_setValue(key, value);
    } catch (e) { }
    try {
      if (typeof GM !== 'undefined' && typeof GM.setValue === 'function') return GM.setValue(key, value);
    } catch (e) { }
  }

  function gmRegisterMenuCommand(label, handler) {
    try {
      if (typeof GM_registerMenuCommand === 'function') return GM_registerMenuCommand(label, handler);
    } catch (e) { }
    try {
      if (typeof GM !== 'undefined' && typeof GM.registerMenuCommand === 'function') return GM.registerMenuCommand(label, handler);
    } catch (e) { }
  }

  function initDemoModeOption() {
    const v = gmGetValue(STORE_KEY_DEMO_MODE, CONFIG.demoMode);
    if (v && typeof v.then === 'function') {
      v.then((val) => {
        CONFIG.demoMode = !!val;
        scheduleCleanup();
      });
    } else {
      CONFIG.demoMode = !!v;
    }

    gmRegisterMenuCommand('DEMO 模式', () => {
      CONFIG.demoMode = !CONFIG.demoMode;
      gmSetValue(STORE_KEY_DEMO_MODE, CONFIG.demoMode);
      scheduleCleanup();
    });
  }

  function ensureDemoStyle() {
    if (document.getElementById(DEMO_STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = DEMO_STYLE_ID;
    s.textContent = `
/* 头像模糊 */
html[data-x-cleaner-demo="1"] header[role="banner"] button[data-testid="SideNav_AccountSwitcher_Button"] [data-testid^="UserAvatar-Container-"] {
  filter: blur(var(--x-cleaner-demo-blur, 12px)) !important;
}

/* 用户名（显示名）模糊 */
html[data-x-cleaner-demo="1"] header[role="banner"] button[data-testid="SideNav_AccountSwitcher_Button"] > div:nth-child(2) div[dir="ltr"] > span {
  filter: blur(var(--x-cleaner-demo-blur, 12px)) !important;
}

/* @用户名模糊 */
html[data-x-cleaner-demo="1"] header[role="banner"] button[data-testid="SideNav_AccountSwitcher_Button"] > div:nth-child(2) div[dir="ltr"] > span[class*="r-poiln3"] {
  filter: blur(var(--x-cleaner-demo-blur, 12px)) !important;
}
`;
    (document.head || document.documentElement).appendChild(s);
  }

  function applyDemoMode() {
    ensureDemoStyle();
    const root = document.documentElement;
    root.style.setProperty('--x-cleaner-demo-blur', `${CONFIG.demoBlurPx}px`);
    if (CONFIG.demoMode) {
      root.setAttribute('data-x-cleaner-demo', '1');
    } else {
      root.removeAttribute('data-x-cleaner-demo');
    }
  }

  const rxLists = /^\/[A-Za-z0-9_]{1,20}\/lists\/?$/;
  const rxCommunities = /^\/[A-Za-z0-9_]{1,20}\/communities\/?$/;

  function hide(el) {
    if (!el || el.nodeType !== 1) return;
    if (el.getAttribute('data-x-cleaner-hidden') === '1') return;
    el.setAttribute('data-x-cleaner-hidden', '1');
    el.style.setProperty('display', 'none', 'important');
  }

  function cleanLeftSidebar(banner) {
    const links = banner.querySelectorAll('a[href]');
    for (const a of links) {
      const href = a.getAttribute('href');
      if (!href) continue;
      if (href === '/explore' || href === '/i/premium_sign_up' || rxLists.test(href) || rxCommunities.test(href)) {
        hide(a);
      }
    }
  }

  function cleanRightSidebar() {
    const sidebar = document.querySelector('div[data-testid="sidebarColumn"]');
    if (!sidebar) return;

    const hideGrandparent = (el) => {
      if (!el) return;
      const parent = el.parentElement;
      const grandparent = parent ? parent.parentElement : null;
      if (grandparent) hide(grandparent);
    };

    for (const h1 of sidebar.querySelectorAll('h1[id^="accessible-list-"]')) {
      if (!/^accessible-list-\d+$/.test(h1.id)) continue;
      hideGrandparent(h1);
    }
    hideGrandparent(sidebar.querySelector('[data-testid="super-upsell-UpsellCardRenderProperties"]'));
    hideGrandparent(sidebar.querySelector('aside[role="complementary"]'));
  }

  function cleanup() {
    applyDemoMode();
    const banner = document.querySelector('header[role="banner"]');
    if (banner) cleanLeftSidebar(banner);
    cleanRightSidebar();
  }

  let scheduled = false;
  function scheduleCleanup() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      cleanup();
    });
  }

  initDemoModeOption();

  const mo = new MutationObserver(() => scheduleCleanup());
  mo.observe(document.documentElement, { childList: true, subtree: true });

  const originalPushState = history.pushState;
  history.pushState = function () {
    const ret = originalPushState.apply(this, arguments);
    scheduleCleanup();
    return ret;
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function () {
    const ret = originalReplaceState.apply(this, arguments);
    scheduleCleanup();
    return ret;
  };

  window.addEventListener('popstate', () => scheduleCleanup());
  scheduleCleanup();
})();
