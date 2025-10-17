// ==UserScript==
// @name         中英文空格排版
// @namespace    https://loongphy.com
// @author       Loongphy
// @version      0.2.1
// @description  中英/数字混排的视觉留白（不改文本）；跳过输入框、代码块和可编辑区域。
// @license      PolyForm-Noncommercial-1.0.0; https://polyformproject.org/licenses/noncommercial/1.0.0/
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    if (!(typeof CSS !== "undefined" && CSS.supports("text-autospace: normal")))
        return;
    const s = document.createElement("style");
    s.id = "cjk-latin-autospace-style";
    s.textContent = `
html { text-autospace: normal; }
@supports (text-autospace: ideograph-alpha ideograph-numeric) {
  html { text-autospace: ideograph-alpha ideograph-numeric; }
}
@supports (text-autospace: ideograph-alpha ideograph-numeric punctuation) {
  html { text-autospace: ideograph-alpha ideograph-numeric punctuation; }
}
@supports (text-autospace: ideograph-alpha ideograph-numeric punctuation replace) {
  html { text-autospace: ideograph-alpha ideograph-numeric punctuation replace; }
}
code, pre, kbd, samp, textarea, input,
[contenteditable], [contenteditable=""], [contenteditable="true"] {
  text-autospace: no-autospace;
}
`;
    (document.head || document.documentElement).appendChild(s);
})();
