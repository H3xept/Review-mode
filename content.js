/*!
 * content.js — extension shell around review-mode.js.
 *
 * review-mode.js is listed first in the manifest, so by the time this runs
 * `window.ReviewMode` exists in the same isolated world. Two cases:
 *
 *   owner  — we injected the only copy; drive it directly.
 *   proxy  — the page loaded its own <script src="review-mode.js">, so our
 *            copy stood down and exposes an event-based proxy. Driving it
 *            still works; the page keeps ownership of the UI and storage.
 *
 * The comment count is published as a DOM attribute (`data-rm-count`) by
 * whichever copy owns the page, so the badge works across both worlds.
 */
(function () {
  "use strict";

  var RM = window.ReviewMode;
  if (!RM) return;

  var html = document.documentElement;
  var isOn = function () { return html.hasAttribute("data-rm-on"); };
  var count = function () { return +(html.dataset.rmCount || 0); };

  function report() {
    try {
      chrome.runtime.sendMessage({ type: "rm:count", count: count(), on: isOn() });
    } catch (e) {
      /* service worker asleep or context invalidated — badge is cosmetic */
    }
  }

  chrome.runtime.onMessage.addListener(function (msg, _sender, respond) {
    if (!msg || msg.type !== "rm:toggle") return;
    if (isOn()) RM.deactivate();
    else RM.activate();
    respond({ on: isOn(), count: count() });
    report();
    return true;
  });

  new MutationObserver(report).observe(html, {
    attributes: true,
    attributeFilter: ["data-rm-count", "data-rm-on"],
  });

  report();
})();
