/**
 * Service worker.
 *
 * Thin by design: it opens the panel and runs injections on request. All the
 * analysis lives in core/, shared verbatim with the CLI — the extension is a
 * surface, not a second implementation.
 */

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'ping') { sendResponse({ ok: true }); return false; }
  return false;
});
