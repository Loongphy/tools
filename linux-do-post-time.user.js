// ==UserScript==
// @name         linux.do 发帖时间列
// @namespace    https://loongphy.com
// @version      1.3.3
// @description  为 linux.do 话题列表增加发帖时间列
// @author       loongphy
// @license      MIT
// @icon64       https://www.google.com/s2/favicons?sz=64&domain=linux.do
// @match        https://linux.do/*
// @grant        none
// @noframes
// @run-at       document-start
// @downloadURL  https://github.com/Loongphy/tools/raw/refs/heads/main/linux-do-post-time.user.js
// ==/UserScript==
//
// Discourse 的话题列表（linux.do 首页、/tag/*、/c/* 等）只有"活动"列（最后回复时间），
// 主题的创建时间只存在于列表 JSON 里（/latest.json、/tag/*.json 的 topic_list.topics[].created_at）。
//   - document-start 拦截页面的 fetch / XHR，收集 id -> created_at：.json 列表/单帖响应 +
//     message-bus 长轮询（实时插入列表的新主题只出现在轮询载荷里），并写 localStorage 缓存兜底。
//   - 给每张 .topic-list 表在"活动"列前注入"发帖"列；表头与单元格都补。
//   - 移动端是单格行布局（标题/分类/活动挤在一个 td 里），独立列太占宽：改以内联小字挂进
//     活动时间节点，借其 margin-left:auto 与其成对贴右；html.mobile-view 或窄窗口（媒体
//     查询兜底）时由 CSS 自动切换。
//   - 主题按 <meta name="discourse_theme_id"> 白名单分流（-2=内置 Horizon 走内联卡片且
//     活动格右对齐到行尾；105=默认 / 106=MOYU 走经典列），未收录的新主题统一回退经典列。
//   - 数据四路来源：列表/单帖 .json 响应、message-bus 长轮询（实时新话题）、HTML 内嵌
//     #data-preloaded（首屏兜底，不依赖注入时机）、localStorage 缓存（上限 4000 条）。
//   - SPA 路由切换、无限滚动、Ember 重渲染导致的行增删，由 MutationObserver + 低频轮询兜底补齐。
//
(function () {
  'use strict';

  /* ---------------------------------------------------------------- 配置 */

  var LS_KEY = 'linuxdo-topic-created-at'; // localStorage 缓存键
  var MAX_CACHE = 4000;                    // 缓存条数上限，超出按写入顺序丢最旧的
  var COL_CLASS = 'topic-created-at';      // 注入列的类名（兼作去重标记）
  var COL_LABEL = '发帖';
  // 主题 → 渲染模式白名单，id 取自 <meta name="discourse_theme_id">。只对已适配的主题套
  // 专门规则，防止未来新增主题时通用嗅探误判：未收录的主题一律回退 classic（独立列），
  // 要适配新主题在这里加一行即可。
  var THEME_MODES = {
    '-2': 'horizon',  // Discourse 内置 Horizon：网格卡片行
    '105': 'classic', // linux.do 默认主题
    '106': 'classic'  // MOYU
  };

  /* ---------------------------------------------------------------- 数据 */

  var createdMap = new Map(); // topicId(字符串) -> created_at（ISO 字符串）

  try {
    var saved = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    for (var i = 0; i < saved.length; i++) createdMap.set(saved[i][0], saved[i][1]);
    while (createdMap.size > MAX_CACHE) createdMap.delete(createdMap.keys().next().value);
  } catch (e) { /* 缓存损坏就当没有 */ }

  var saveTimer = 0;
  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = 0;
      try { localStorage.setItem(LS_KEY, JSON.stringify(Array.from(createdMap))); } catch (e) { /* 写不进就算了 */ }
    }, 2000);
  }

  function putCreated(id, iso) {
    var key = String(id);
    if (createdMap.has(key)) return;
    createdMap.set(key, iso);
    while (createdMap.size > MAX_CACHE) createdMap.delete(createdMap.keys().next().value);
    scheduleSave();
    scheduleSweep();
  }

  // 从任意 Discourse JSON 响应里捞创建时间：
  //   列表响应取 topic_list.topics[]；单帖响应（/t/{id}.json）顶层有 id + created_at；
  //   message-bus 长轮询是 [["/latest", topicJSON], ...] 数组，新主题实时插入列表时数据只在这里。
  function harvest(data) {
    if (!data || typeof data !== 'object') return;
    var topics = data.topic_list && data.topic_list.topics;
    if (Array.isArray(topics)) {
      for (var i = 0; i < topics.length; i++) {
        var t = topics[i];
        if (t && t.id != null && t.created_at) putCreated(t.id, t.created_at);
      }
      return;
    }
    if (Array.isArray(data)) {
      for (var k = 0; k < data.length; k++) {
        var msg = data[k];
        if (Array.isArray(msg) && msg[1] && typeof msg[1] === 'object') harvest(msg[1]);
      }
      return;
    }
    // post_stream（单帖响应）或 posters（列表序列化）作主题特征，避免误收其他带 id/created_at 的对象
    if (data.id != null && data.created_at && data.slug &&
        (data.post_stream || Array.isArray(data.posters))) putCreated(data.id, data.created_at);
  }

  /* ----------------------------------------------------- 拦截 fetch / XHR */

  // .json 覆盖 Discourse API；message-bus 长轮询（跨域 CDN 域名）承载实时插入的新主题
  function isApiUrl(url) {
    return typeof url === 'string' && (/\.json(\?|#|$)/.test(url) || /message-bus\/.+\/poll/.test(url));
  }

  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input) {
      var promise = origFetch.apply(this, arguments);
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (isApiUrl(url)) {
          promise.then(function (res) {
            try { res.clone().json().then(harvest, function () {}); } catch (e) { /* ignore */ }
          }, function () {});
        }
      } catch (e) { /* 拦截绝不影响页面本身 */ }
      return promise;
    };
  }

  var XHR = XMLHttpRequest.prototype;
  var origOpen = XHR.open;
  var origSend = XHR.send;
  XHR.open = function (method, url) {
    this.__ldApiUrl = isApiUrl(url);
    return origOpen.apply(this, arguments);
  };
  XHR.send = function () {
    var xhr = this;
    if (xhr.__ldApiUrl) {
      xhr.addEventListener('load', function () {
        try {
          if (xhr.responseType === 'json') harvest(xhr.response);
          else if (xhr.responseType === '' || xhr.responseType === 'text') harvest(JSON.parse(xhr.responseText));
        } catch (e) { /* ignore */ }
      });
    }
    return origSend.apply(this, arguments);
  };

  /* ---------------------------------------------------------------- 渲染 */

  // 首屏话题列表数据常内嵌在 #data-preloaded（首屏渲染不发 .json 请求），脚本注入晚于
  // 首屏请求的设备（部分手机浏览器不支持 document-start）会整屏漏采，只能靠这里兜底；
  // key 形如 topic_list_latest / topic，值是二次 JSON.stringify 的字符串
  function harvestPreloaded() {
    var el = document.getElementById('data-preloaded');
    if (!el || !el.dataset.preloaded) return;
    var data;
    try { data = JSON.parse(el.dataset.preloaded); } catch (e) { return; }
    for (var key in data) {
      if (!/^topic/.test(key)) continue;
      var v = data[key];
      if (typeof v === 'string') {
        try { v = JSON.parse(v); } catch (e) { continue; }
      }
      harvest(v);
    }
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // 与"活动"列同风格的紧凑显示：今天只给时刻，昨天/前天/一周内给相对天数，更早给日期
  function fmtShort(d) {
    var now = new Date();
    var dayMs = 86400000;
    var dayOf = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    var diffDays = Math.round((dayOf(now) - dayOf(d)) / dayMs); // 按自然日计算，跨月/跨年也对
    if (diffDays <= 0) return pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (diffDays === 1) return '昨天';
    if (diffDays === 2) return '前天';
    if (diffDays < 7) return diffDays + '天前';
    if (d.getFullYear() === now.getFullYear()) return pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function fmtFull(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function injectStyle() {
    var style = document.createElement('style');
    var INLINE_SEL = '.' + COL_CLASS + '-inline';
    // 字号/行高必须和"最近活跃时间"（.num.activity，.87rem/1.2）一致：
    // linux.do 的 .topic-item-stats 是 flex + align-items:baseline，两组字号行高一旦
    // 不同，基线虽对齐但盒高不同，视觉上会差出约 1px 的上下错位
    var inlineCss =
      INLINE_SEL + '{display:inline-block;font-size:.87rem;line-height:1.2;color:var(--primary-medium,#919191);' +
      'margin:0 8px;white-space:nowrap;}';
    // 活动时间（.num.activity，margin-left:auto）盒子禁止收缩换行，保证两个时间单行成对贴右
    var actCss = '.topic-list .topic-item-stats .num.activity{white-space:nowrap;flex-shrink:0;}';
    // Horizon 主题：内联时间放进 .topic-activity__time（网格卡片行，桌面/窄屏同一套结构）
    var hzCss = '.topic-list .topic-activity__time ' + inlineCss;
    // Horizon：活动格（用户名 + 成对时间）跨到网格行尾右对齐（宽窄屏一致）；
    // overflow:hidden 保证内容再长也只在自己的格子里裁剪，绝不会压到相邻的用户名/回复列；
    // 发帖时间颜色继承活动时间（两时间同色）；__time 为 flex 居中 + column-gap 提供时间间距
    var hzAlignCss =
      'html.ldc-horizon table.topic-list tr.topic-list-item td.topic-activity-data' +
      '{grid-column:activity/-1;text-align:right;white-space:nowrap;overflow:hidden;}' +
      'html.ldc-horizon .topic-list .topic-activity__time .' + COL_CLASS + '-inline{margin-right:0;color:inherit;}' +
      'html.ldc-horizon .topic-list .topic-activity__time{display:flex;align-items:center;justify-content:flex-end;column-gap:8px;}';
    // 桌面端用独立列；移动端藏列、改内联显示。两套环境选择器任一命中即可：
    // Discourse 移动视图有 html.mobile-view 类，窄窗口（桌面 UA）走媒体查询兜底。
    style.textContent =
      'table.topic-list th.' + COL_CLASS + '{text-align:right;white-space:nowrap;}' +
      'table.topic-list td.' + COL_CLASS + '{text-align:right;white-space:nowrap;font-size:.93em;color:var(--primary-medium,#919191);}' +
      INLINE_SEL + '{display:none;}' +
      INLINE_SEL + ':empty{display:none!important;}' +
      'html.mobile-view table.topic-list th.' + COL_CLASS + ',html.mobile-view table.topic-list td.' + COL_CLASS + '{display:none!important;}' +
      'html.mobile-view ' + inlineCss + actCss +
      hzCss + hzAlignCss +
      '@media (max-width:580px){' +
      'table.topic-list th.' + COL_CLASS + ',table.topic-list td.' + COL_CLASS + '{display:none!important;}' +
      inlineCss + actCss +
      '}';
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureHeader(table) {
    var headRow = table.tHead && table.tHead.querySelector('tr');
    if (!headRow || headRow.querySelector('th.' + COL_CLASS)) return;
    var th = document.createElement('th');
    th.className = 'topic-list-data num ' + COL_CLASS;
    th.setAttribute('scope', 'col');
    th.textContent = COL_LABEL;
    headRow.insertBefore(th, headRow.querySelector('th.activity')); // 无活动列时第二个参数为 null，追加到末尾
  }

  // 解析当前主题模式：<meta name="discourse_theme_id"> 为服务端渲染的主题 id，
  // 可能逗号分隔多个（取法同 Discourse 官方 theme-selector.js）。读不到 meta 也回退 classic。
  function themeMode() {
    var m = document.querySelector('meta[name="discourse_theme_id"]');
    if (!m || !m.content) return 'classic';
    var ids = m.content.split(',');
    for (var i = 0; i < ids.length; i++) {
      var mode = THEME_MODES[String(parseInt(ids[i], 10))];
      if (mode) return mode;
    }
    return 'classic';
  }

  function sweep() {
    var tables = document.querySelectorAll('table.topic-list');
    if (!tables.length) return;

    var mode = themeMode(); // 主题白名单：'horizon' | 'classic'（未收录主题回退 classic）
    var rootCls = document.documentElement.classList;
    if (mode === 'horizon') rootCls.add('ldc-horizon');
    else rootCls.remove('ldc-horizon');

    for (var i = 0; i < tables.length; i++) {
      var table = tables[i];
      // 卡片模式要求表格真是 Horizon 卡片结构：Horizon 主题下部分页面（如 /new）仍渲染
      // 经典表格，此时回退独立列，避免整页什么都不显示
      var horizon = mode === 'horizon' &&
                    !!table.querySelector('.topic-activity__time, td.topic-activity-data');
      if (!horizon) ensureHeader(table);

      var rows = table.querySelectorAll('tr.topic-list-item[data-topic-id]');
      for (var j = 0; j < rows.length; j++) {
        var row = rows[j];
        var id = row.getAttribute('data-topic-id');

        var td = null;
        if (!horizon) {
          td = row.querySelector('td.' + COL_CLASS);
          if (!td) {
            td = document.createElement('td');
            td.className = 'topic-list-data num ' + COL_CLASS;
            var anchor = row.querySelector('td.activity');
            if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(td, anchor);
            else row.appendChild(td);
          }
        }

        // 内联挂点：默认主题是统计行里的活动节点，Horizon 是活动时间容器
        var target = row.querySelector('.topic-item-stats .num.activity') ||
                     row.querySelector('.topic-activity__time');

        var created = createdMap.get(id);
        if (!created) continue;
        var ts = Date.parse(created);
        if (!isFinite(ts)) continue;

        var d = new Date(ts);
        if (td && td.dataset.filled !== id) { // 已按该主题填充过就不再写
          td.textContent = fmtShort(d);
          td.title = fmtFull(d);
          td.dataset.filled = id;
        }

        if (target) {
          var inline = row.querySelector('.' + COL_CLASS + '-inline');
          if (!inline) {
            inline = document.createElement('span');
            inline.className = COL_CLASS + '-inline';
            target.insertBefore(inline, target.firstChild);
          }
          if (inline.dataset.filled !== id) {
            inline.textContent = fmtShort(d);
            inline.title = fmtFull(d);
            inline.dataset.filled = id;
          }
        }
      }
    }

    // 兜底：本页大面积缺数据（脚本注入晚于首屏请求的设备上，linux.do 又没有可捡的
    // preloaded）时，主动补拉当前列表的 .json；每个 URL 只补一次
    var allRows = document.querySelectorAll('tr.topic-list-item[data-topic-id]');
    if (allRows.length && refetchedUrl !== location.href) {
      var missing = 0;
      for (var k = 0; k < allRows.length; k++) {
        if (!createdMap.has(allRows[k].getAttribute('data-topic-id'))) missing++;
      }
      if (missing * 3 > allRows.length) {
        refetchedUrl = location.href;
        var url = (location.pathname.replace(/\/+$/, '') || '/latest') + '.json' + location.search;
        try {
          origFetch.call(window, url, { credentials: 'same-origin' }).then(function (res) {
            try { res.clone().json().then(harvest, function () {}); } catch (e) { /* ignore */ }
          }, function () {});
        } catch (e) { /* ignore */ }
      }
    }
  }

  /* ---------------------------------------------------------------- 启动 */

  var sweepScheduled = false;
  var refetchedUrl = '';
  function scheduleSweep() {
    if (sweepScheduled) return;
    sweepScheduled = true;
    setTimeout(function () { sweepScheduled = false; sweep(); }, 120);
  }

  function start() {
    injectStyle();
    harvestPreloaded(); // 首屏内嵌数据先落缓存，再跑首轮 sweep
    sweep();
    // Ember 重渲染 / SPA 路由 / 无限滚动的行增删都靠观察补齐，轮询只作兜底
    new MutationObserver(scheduleSweep).observe(document.body, { childList: true, subtree: true });
    setInterval(sweep, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
