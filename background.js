/*!
 * background.js — MV3 service worker.
 *
 * Owns three things and nothing else:
 *   1. toolbar click / Alt+R  → tell the tab to toggle review mode
 *   2. a self-heal path       → inject the scripts into tabs that were
 *                               already open when the extension loaded
 *   3. the badge              → open comment count for the active page
 */

const FILES = ["review-mode.js", "content.js"];

async function toggle(tab) {
  if (!tab || tab.id == null) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "rm:toggle" });
  } catch (e) {
    // No content script yet (tab predates the extension, or was reloaded
    // while the worker was asleep). Inject, then retry once.
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: FILES });
      await chrome.tabs.sendMessage(tab.id, { type: "rm:toggle" });
    } catch (err) {
      console.warn("[review-mode] cannot attach to this page:", err.message);
    }
  }
}

chrome.action.onClicked.addListener(toggle);

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-review") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  toggle(tab);
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== "rm:count" || !sender.tab) return;
  const id = sender.tab.id;
  chrome.action.setBadgeText({ tabId: id, text: msg.count ? String(msg.count) : "" });
  chrome.action.setBadgeBackgroundColor({ tabId: id, color: msg.on ? "#6350c9" : "#7c8792" });
});
