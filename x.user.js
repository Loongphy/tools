// ==UserScript==
// @name         X Cleaner
// @description  Hide Annoying left sidebar links and remove right sidebar clutter on X.com.
// @namespace    https://x.com/
// @version      1.0.0
// @match        https://x.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  if (window.__xCleanerInstalled) return;
  window.__xCleanerInstalled = true;

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
