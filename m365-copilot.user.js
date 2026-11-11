// ==UserScript==
// @name         m365-copilot-gpt-deep-thinking
// @description  强制 Copilot 使用「GPT-5.6 Sol 深度思考」：直接写内部模型选择 store（currentModel），并在 WebSocket 发送层改写 tone 兜底
// @namespace    https://loongphy.com
// @author       Loongphy
// @license      PolyForm-Noncommercial-1.0.0; https://polyformproject.org/licenses/noncommercial/1.0.0/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=copilot.cloud.microsoft
// @version      1.5.0
// @match        https://copilot.cloud.microsoft/*
// @match        https://copilot.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const TONE = 'Gpt_5_6_Reasoning';
    const TONE_FALLBACK = 'Reasoning';
    const CHUNK = 'rspackChunk_1js_m365_copilot_app';
    const HINT_KEY = 'm365-copilot-store-chunk';
    const HINT_TTL = 48 * 3600 * 1000;
    const POLL_INTERVAL = 800;

    const RS = '\x1e';
    let wantTone = TONE;

    function patchPayload(text) {
        const records = text.split(RS);
        let changed = false;
        for (let i = 0; i < records.length; i++) {
            const rec = records[i];
            if (!rec || rec[0] !== '{') continue;
            let msg;
            try { msg = JSON.parse(rec); } catch (_) { continue; }
            const a0 = msg && msg.arguments && msg.arguments[0];
            if (msg.target === 'chat' && a0 && typeof a0 === 'object' && 'tone' in a0 && a0.tone !== wantTone) {
                a0.tone = wantTone;
                records[i] = JSON.stringify(msg);
                changed = true;
            }
        }
        return changed ? records.join(RS) : text;
    }

    const origSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
        if (typeof data === 'string' && data.indexOf('"target":"chat"') !== -1) {
            try { data = patchPayload(data); } catch (_) {}
        }
        return origSend.call(this, data);
    };

    let req = null;
    let storeApi = null;
    let hinted = false;
    let scannedAt = -1;

    function prefetchHint() {
        try {
            const h = JSON.parse(localStorage.getItem(HINT_KEY) || 'null');
            if (h && h.chunk != null && Date.now() - (h.ts || 0) < HINT_TTL && req.e) {
                Promise.resolve(req.e(h.chunk)).catch(() => {});
            }
        } catch (_) {}
    }

    function learnHint(modId) {
        try {
            const arr = self[CHUNK];
            for (let i = arr.length - 1; i >= 0; i--) {
                const c = arr[i];
                if (Array.isArray(c) && c[1] && typeof c[1] === 'object' && modId in c[1]) {
                    const h = JSON.stringify({ chunk: c[0][0], ts: Date.now() });
                    if (localStorage.getItem(HINT_KEY) !== h) localStorage.setItem(HINT_KEY, h);
                    return;
                }
            }
        } catch (_) {}
    }

    function selStore() {
        if (storeApi) return storeApi;
        const arr = self[CHUNK];
        if (!arr) return null;
        if (!req) arr.push([[Symbol()], {}, r => { req = r; }]);
        if (!req) return null;
        if (!hinted) { hinted = true; prefetchHint(); }
        if (!req.m) return null;
        const n = Object.keys(req.m).length;
        if (n === scannedAt) return null;
        scannedAt = n;
        for (const id in req.m) {
            try {
                const src = req.m[id] && req.m[id].toString();
                if (src && src.includes('createStore') && src.includes('currentEffortLevel')) {
                    const m = req(id);
                    if (m && typeof m.S$ === 'function' && typeof m.TZ === 'function') {
                        storeApi = m;
                        learnHint(id);
                        return m;
                    }
                }
            } catch (_) {}
        }
        return null;
    }

    function optionIds(s) {
        const out = [];
        const opts = s && s.resolvedModels && s.resolvedModels.availableModelSelectionOptions;
        for (const o of opts || []) {
            if (o && o.id) out.push(o.id);
            if (Array.isArray(o && o.itemGroup)) {
                for (const x of o.itemGroup) if (x && x.id) out.push(x.id);
            }
        }
        return out;
    }

    function applyTone() {
        const api = selStore();
        if (!api) return;
        let s;
        try { s = api.S$(); } catch (_) { return; }
        if (!s) return;
        const ids = optionIds(s);
        const want = ids.length && !ids.includes(TONE) && ids.includes(TONE_FALLBACK)
            ? TONE_FALLBACK : TONE;
        wantTone = want;
        if (s.currentModel !== want) {
            try { api.TZ({ currentModel: want }); } catch (_) {}
        }
    }

    setInterval(applyTone, POLL_INTERVAL);
})();
