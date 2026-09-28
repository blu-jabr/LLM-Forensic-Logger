// modules/index.js — shared namespace + content-side debug logging.
// Loaded FIRST (manifest content_scripts order). Everything here is
// service-agnostic; per-service logic belongs in modules/<service>.js.

window.ForensicModules = {};

// ─── Shared debug tracing (isolated world only; MAIN-world scripts log directly) ───
const FL_DEBUG = true;
let flBuffer = [], flFlushTimer = null;
function flSend() {
    if (!flBuffer.length) return;
    const lines = flBuffer; flBuffer = [];
    try { chrome.runtime.sendMessage({ type: 'FL_DEBUG_LOG', lines }).catch(() => {}); } catch (e) {}
}
function dlog(...a) {
    const line = new Date().toISOString() + ' [CS] ' + a.map(x => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ');
    if (FL_DEBUG) console.log('%c[FL]', 'color:#080;font-weight:bold', ...a);
    flBuffer.push(line);
    clearTimeout(flFlushTimer); flFlushTimer = setTimeout(flSend, 2000);
}
function derr(...a) {
    const line = new Date().toISOString() + ' [CS✗] ' + a.map(x => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ');
    if (FL_DEBUG) console.error('%c[FL✗]', 'color:#c00;font-weight:bold', ...a);
    flBuffer.push(line);
    clearTimeout(flFlushTimer); flFlushTimer = setTimeout(flSend, 2000);
}
