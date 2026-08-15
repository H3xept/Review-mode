/*!
 * review-mode.js — turn any static HTML page into a review surface.
 *
 * Single import. No dependencies, no build step.
 *
 *   <script src="review-mode.js" defer></script>
 *
 * Click blocks (or select text) to attach comments, then copy an
 * agent-ready follow-up prompt that aggregates every comment.
 *
 * Runs in three shells:
 *   1. a <script> tag in the page               (main world, localStorage)
 *   2. a Chrome MV3 content script              (isolated world, chrome.storage)
 *   3. a bookmarklet loader                     (main world, localStorage)
 *
 * If a copy is already running on the page, later copies install a
 * cross-world proxy that drives the owner through CustomEvents instead
 * of rendering a second UI.
 */
(function () {
  "use strict";

  var VERSION = "1.0.0";
  var OWNED = "data-review-mode";

  /* ── proxy shell ────────────────────────────────────────────────────────
     Another copy of the library already owns this page. Expose the same
     surface, implemented as events, so the extension can drive the copy
     the page loaded itself. */
  if (document.documentElement.hasAttribute(OWNED)) {
    var fire = function (name, detail) {
      document.dispatchEvent(new CustomEvent("reviewmode:" + name, { detail: detail }));
    };
    window.ReviewMode = {
      version: document.documentElement.getAttribute(OWNED),
      proxy: true,
      toggle: function () { fire("toggle"); },
      activate: function () { fire("activate"); },
      deactivate: function () { fire("deactivate"); },
      count: function () { return +(document.documentElement.dataset.rmCount || 0); },
    };
    return;
  }
  document.documentElement.setAttribute(OWNED, VERSION);

  /* ── config ─────────────────────────────────────────────────────────── */

  var script = document.currentScript;
  // In a Chrome content script there is no <script> tag and no implicit
  // consent: stay dormant until the toolbar action asks for the UI.
  var isContentScript = !script && typeof chrome !== "undefined" && !!(chrome.storage && chrome.storage.local);
  var CONFIG = {
    // show the floating launcher as soon as the library loads
    launcher: script ? script.dataset.launcher !== "false" : !isContentScript,
    // enter review mode immediately
    open: !!script && script.dataset.open === "true",
    // extra CSS selectors to make annotatable
    extra: (script && script.dataset.extra) || "",
  };

  var KINDS = [
    { id: "question", label: "Question", glyph: "?", color: "#2563c9" },
    { id: "issue", label: "Issue", glyph: "!", color: "#c0392b" },
    { id: "nit", label: "Nit", glyph: "~", color: "#7c8792" },
    { id: "idea", label: "Idea", glyph: "+", color: "#6350c9" },
    { id: "praise", label: "Praise", glyph: "*", color: "#0e7a5c" },
  ];
  var KIND = {};
  KINDS.forEach(function (k) { KIND[k.id] = k; });

  var TARGETS = [
    "p", "li", "td", "th", "dd", "dt", "blockquote", "pre", "figure",
    "figcaption", "img", "svg", "summary", "h1", "h2", "h3", "h4", "h5", "h6",
    ".callout", ".card", ".bound", ".chip", ".key",
  ].concat(CONFIG.extra ? CONFIG.extra.split(",") : []).join(",");

  var SKIP = "#rm-root, .rm-pin, script, style, template, noscript";

  /* ── tiny helpers ───────────────────────────────────────────────────── */

  function el(tag, props, children) {
    var n = document.createElement(tag);
    for (var k in props) {
      if (k === "class") n.className = props[k];
      else if (k === "text") n.textContent = props[k];
      else if (k === "html") n.innerHTML = props[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), props[k]);
      else if (k === "style") n.style.cssText = props[k];
      else if (props[k] != null) n.setAttribute(k, props[k]);
    }
    (children || []).forEach(function (c) {
      if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }

  function hash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function uid() {
    return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  }

  function squash(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  function clip(s, n) {
    s = squash(s);
    return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
  }

  /* ── text model ─────────────────────────────────────────────────────────
     Every offset and hash is computed over the element's *authored* text:
     highlight <mark>s are transparent (they add no characters) and pins are
     excluded, so annotating a block never shifts another block's anchors. */

  function textNodes(root, out) {
    out = out || [];
    for (var n = root.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) out.push(n);
      else if (n.nodeType === 1 && !n.matches(SKIP)) textNodes(n, out);
    }
    return out;
  }

  function blockText(node) {
    return textNodes(node).map(function (n) { return n.data; }).join("");
  }

  var kindMemo = null;
  function lastKind(set) {
    if (set) {
      kindMemo = set;
      try { localStorage.setItem("reviewmode:lastkind", set); } catch (e) {}
      return set;
    }
    if (kindMemo) return kindMemo;
    try { return localStorage.getItem("reviewmode:lastkind"); } catch (e) { return null; }
  }

  function wrapRange(node, start, end, color) {
    var nodes = textNodes(node), segs = [], pos = 0;
    nodes.forEach(function (t) {
      var s = pos, e = pos + t.data.length;
      pos = e;
      if (e <= start || s >= end) return;
      segs.push([t, Math.max(0, start - s), Math.min(t.data.length, end - s)]);
    });
    var marks = [];
    for (var i = segs.length - 1; i >= 0; i--) {
      var t = segs[i][0], s = segs[i][1], e = segs[i][2];
      if (e < t.data.length) t.splitText(e);
      if (s > 0) t = t.splitText(s);
      var m = el("mark", { class: "rm-hl" });
      m.style.setProperty("--rm-c", color);
      t.parentNode.insertBefore(m, t);
      m.appendChild(t);
      marks.unshift(m);
    }
    return marks;
  }

  function unwrap(mark) {
    var p = mark.parentNode;
    if (!p) return;
    while (mark.firstChild) p.insertBefore(mark.firstChild, mark);
    p.removeChild(mark);
    p.normalize();
  }

  /* ── anchoring ───────────────────────────────────────────────────────── */

  function pathOf(node) {
    var parts = [];
    while (node && node.nodeType === 1 && node !== document.body) {
      var tag = node.tagName.toLowerCase(), i = 1;
      for (var s = node.previousElementSibling; s; s = s.previousElementSibling) {
        if (s.tagName === node.tagName) i++;
      }
      parts.unshift(tag + ":" + i);
      node = node.parentElement;
    }
    return parts.join(">");
  }

  function byPath(path) {
    var node = document.body;
    var parts = path.split(">");
    for (var i = 0; i < parts.length; i++) {
      var bits = parts[i].split(":"), tag = bits[0], want = +bits[1], seen = 0, hit = null;
      var kids = node.children;
      for (var j = 0; j < kids.length; j++) {
        if (kids[j].tagName.toLowerCase() === tag && ++seen === want) { hit = kids[j]; break; }
      }
      if (!hit) return null;
      node = hit;
    }
    return node;
  }

  // Headings often wrap inline chips ("<span>05</span><span>Title</span>"), which
  // concatenate into one run. Insert a space at every element boundary.
  function inlineText(node) {
    var out = "";
    for (var n = node.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) out += n.data;
      else if (n.nodeType === 1 && !n.matches(SKIP)) out += " " + inlineText(n) + " ";
    }
    return squash(out);
  }

  function nearestHeading(node) {
    var n = node;
    while (n && n !== document.body) {
      for (var s = n.previousElementSibling; s; s = s.previousElementSibling) {
        if (/^H[1-6]$/.test(s.tagName)) return clip(inlineText(s), 90);
        var inner = s.querySelectorAll ? s.querySelectorAll("h1,h2,h3,h4,h5,h6") : [];
        if (inner.length) return clip(inlineText(inner[inner.length - 1]), 90);
      }
      n = n.parentElement;
    }
    return squash(document.title);
  }

  function describe(node) {
    var d = node.tagName.toLowerCase();
    if (node.id) d += "#" + node.id;
    else if (node.className && typeof node.className === "string") {
      var c = node.className.split(/\s+/).filter(function (x) { return x && x.indexOf("rm-") !== 0; })[0];
      if (c) d += "." + c;
    }
    return d;
  }

  /* Re-attach a stored anchor to a live element.
     path hit → exact; text match → moved; nothing → detached. */
  function resolve(a) {
    var node = byPath(a.path);
    if (node && hash(blockText(node)) === a.hash) return { node: node, state: "ok" };
    var wanted = a.quote || a.excerpt;
    var pool = document.body.querySelectorAll(TARGETS);
    var fallback = null;
    for (var i = 0; i < pool.length; i++) {
      if (pool[i].closest(SKIP)) continue;
      var text = blockText(pool[i]);
      if (hash(text) === a.hash) return { node: pool[i], state: "moved" };
      if (!fallback && wanted && wanted.length > 12 && text.indexOf(wanted) !== -1) fallback = pool[i];
    }
    if (fallback) return { node: fallback, state: "moved" };
    if (node) return { node: node, state: "drifted" };
    return { node: null, state: "detached" };
  }

  /* ── storage ─────────────────────────────────────────────────────────── */

  var hasExtStore = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  var KEY = "reviewmode:v1:" + location.origin + location.pathname;

  var store = {
    get: function () {
      if (hasExtStore) {
        return chrome.storage.local.get(KEY).then(function (o) { return o[KEY] || null; });
      }
      try { return Promise.resolve(JSON.parse(localStorage.getItem(KEY))); }
      catch (e) { return Promise.resolve(null); }
    },
    set: function (v) {
      if (hasExtStore) {
        var o = {};
        o[KEY] = v;
        return chrome.storage.local.set(o);
      }
      try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {}
      return Promise.resolve();
    },
  };

  /* ── state ───────────────────────────────────────────────────────────── */

  var notes = [];        // Annotation[]
  var live = {};         // id -> { node, state, marks, pin }
  var on = false;        // review mode engaged
  var ui = {};           // shadow-dom refs

  function save() {
    document.documentElement.dataset.rmCount = String(notes.length);
    return store.set({ title: document.title, url: location.href, saved: Date.now(), notes: notes });
  }

  function sorted() {
    return notes.slice().sort(function (a, b) {
      var x = live[a.id] && live[a.id].node, y = live[b.id] && live[b.id].node;
      if (!x && !y) return a.created - b.created;
      if (!x) return 1;
      if (!y) return -1;
      if (x === y) return (a.start || 0) - (b.start || 0);
      var rel = x.compareDocumentPosition(y);
      return rel & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }

  /* ── page-level styling (light DOM: highlights, pins, hover) ─────────── */

  var PAGE_CSS = [
    "html[data-rm-on] .rm-hit{cursor:crosshair!important;}",
    "html[data-rm-on] .rm-hit:not(.rm-anno){box-shadow:0 0 0 1px color-mix(in srgb,var(--rm-accent) 45%,transparent)!important;border-radius:3px;}",
    ".rm-anno{background:color-mix(in srgb,var(--rm-c) 11%,transparent)!important;box-shadow:inset 2px 0 0 var(--rm-c)!important;border-radius:2px;}",
    ".rm-hl{background:color-mix(in srgb,var(--rm-c) 24%,transparent)!important;color:inherit!important;box-shadow:inset 0 -2px 0 var(--rm-c);border-radius:2px;padding:0 1px;}",
    ".rm-pin{all:unset;display:inline-flex;align-items:center;justify-content:center;min-width:15px;height:15px;padding:0 3px;margin:0 0 0 3px;border-radius:999px;",
    "background:var(--rm-c);color:#fff;font:600 9.5px/1 ui-monospace,SF Mono,Menlo,monospace;vertical-align:super;cursor:pointer;user-select:none;transform:translateY(-1px);}",
    ".rm-pin:hover{filter:brightness(1.15);}",
    ".rm-pin.rm-off{opacity:.45;text-decoration:line-through;}",
    "@keyframes rm-flash{0%,100%{background:transparent;}30%{background:color-mix(in srgb,var(--rm-accent) 34%,transparent);}}",
    ".rm-flash{animation:rm-flash 1.1s ease-out 1;border-radius:3px;}",
    "html{--rm-accent:#6350c9;}",
  ].join("\n");

  function pageStyle() {
    if (document.getElementById("rm-page-css")) return;
    document.head.appendChild(el("style", { id: "rm-page-css", text: PAGE_CSS }));
  }

  /* ── shadow UI ───────────────────────────────────────────────────────── */

  var SHADOW_CSS = "\
:host{all:initial;}\
*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}\
:host{--bg:#fff;--bg2:#f6f8f9;--ink:#161d24;--ink2:#5a666f;--ink3:#8b959d;--line:#dde3e8;--accent:#6350c9;\
--mono:ui-monospace,'SF Mono',Menlo,Consolas,monospace;--shadow:0 6px 26px rgba(16,24,32,.18),0 1px 3px rgba(16,24,32,.12);}\
@media (prefers-color-scheme:dark){:host{--bg:#1b232a;--bg2:#151c22;--ink:#e6ebef;--ink2:#a4afb8;--ink3:#78848d;--line:#2d373f;--accent:#a596ec;\
--shadow:0 6px 30px rgba(0,0,0,.5),0 1px 3px rgba(0,0,0,.4);}}\
button{font:inherit;cursor:pointer;border:0;background:none;color:inherit;}\
.dock{position:fixed;right:16px;bottom:16px;display:flex;gap:8px;align-items:center;z-index:1;transition:right .16s;}\
.dock.shift{right:408px;}\
@media (max-width:760px){.dock.shift{display:none;}}\
.pill{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 14px;border-radius:999px;background:var(--bg);color:var(--ink);\
border:1px solid var(--line);box-shadow:var(--shadow);font-size:12.5px;font-weight:500;white-space:nowrap;transition:transform .12s,background .12s;}\
.pill:hover{transform:translateY(-1px);}\
.pill.on{background:var(--accent);border-color:var(--accent);color:#fff;}\
.pill .dot{width:7px;height:7px;border-radius:50%;background:var(--ink3);}\
.pill.on .dot{background:#fff;box-shadow:0 0 0 3px rgba(255,255,255,.28);}\
.pill .n{font-family:var(--mono);font-size:11px;opacity:.85;}\
.card{position:fixed;width:340px;max-width:calc(100vw - 24px);background:var(--bg);border:1px solid var(--line);border-radius:9px;\
box-shadow:var(--shadow);overflow:hidden;z-index:3;}\
.card .quote{margin:0;padding:9px 12px;background:var(--bg2);border-bottom:1px solid var(--line);font-size:11.5px;line-height:1.45;color:var(--ink2);\
max-height:76px;overflow:auto;border-left:2px solid var(--accent);}\
.card .quote b{color:var(--ink3);font-family:var(--mono);font-weight:500;font-size:10.5px;letter-spacing:.02em;display:block;margin-bottom:3px;}\
.kinds{display:flex;gap:4px;padding:10px 10px 0;flex-wrap:wrap;}\
.kind{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;border:1px solid var(--line);font-size:11px;color:var(--ink2);}\
.kind i{width:7px;height:7px;border-radius:2px;background:var(--k);font-style:normal;}\
.kind[aria-pressed=true]{border-color:var(--k);background:color-mix(in srgb,var(--k) 14%,transparent);color:var(--ink);font-weight:500;}\
textarea{display:block;width:calc(100% - 20px);margin:9px 10px;min-height:74px;resize:vertical;padding:8px 9px;border-radius:6px;\
border:1px solid var(--line);background:var(--bg2);color:var(--ink);font-size:13px;line-height:1.45;outline:none;}\
textarea:focus{border-color:var(--accent);}\
.row{display:flex;align-items:center;gap:8px;padding:0 10px 10px;}\
.row .sp{margin-left:auto;}\
.hint{font-family:var(--mono);font-size:10px;color:var(--ink3);}\
.btn{height:28px;padding:0 12px;border-radius:6px;border:1px solid var(--line);font-size:12px;color:var(--ink2);}\
.btn:hover{background:var(--bg2);}\
.btn.pri{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:500;}\
.btn.pri:hover{filter:brightness(1.08);background:var(--accent);}\
.btn.danger:hover{color:#c0392b;border-color:#c0392b;}\
.btn:disabled{opacity:.45;cursor:not-allowed;}\
.bubble{position:fixed;z-index:3;}\
.bubble button{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 11px;border-radius:999px;background:var(--accent);color:#fff;\
font-size:11.5px;font-weight:500;box-shadow:var(--shadow);}\
.side{position:fixed;top:0;right:0;bottom:0;width:392px;max-width:100vw;background:var(--bg);border-left:1px solid var(--line);\
box-shadow:var(--shadow);display:flex;flex-direction:column;z-index:2;}\
.side header{display:flex;align-items:center;gap:9px;padding:13px 14px;border-bottom:1px solid var(--line);}\
.side h2{margin:0;font-size:13.5px;font-weight:600;color:var(--ink);}\
.side .sum{font-family:var(--mono);font-size:10.5px;color:var(--ink3);}\
.list{flex:1;overflow:auto;padding:8px;display:flex;flex-direction:column;gap:7px;}\
.note{border:1px solid var(--line);border-radius:7px;padding:9px 10px;background:var(--bg);border-left:3px solid var(--k);}\
.note:hover{background:var(--bg2);}\
.note .top{display:flex;align-items:center;gap:7px;margin-bottom:4px;}\
.note .tag{font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--k);font-weight:600;}\
.note .loc{font-size:10.5px;color:var(--ink3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}\
.note .warn{font-family:var(--mono);font-size:9.5px;color:#c0392b;border:1px solid currentColor;border-radius:3px;padding:0 4px;}\
.note blockquote{margin:0 0 5px;padding-left:8px;border-left:2px solid var(--line);color:var(--ink3);font-size:11.5px;line-height:1.4;\
display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}\
.note p{margin:0;font-size:12.5px;line-height:1.5;color:var(--ink);white-space:pre-wrap;overflow-wrap:anywhere;}\
.note.done p,.note.done blockquote{opacity:.5;text-decoration:line-through;}\
.note .acts{display:flex;gap:2px;margin:6px -4px -4px;}\
.note .acts button{padding:2px 7px;border-radius:5px;font-size:10.5px;color:var(--ink3);}\
.note .acts button:hover{background:var(--line);color:var(--ink);}\
.empty{margin:auto;padding:34px 22px;text-align:center;color:var(--ink3);font-size:12.5px;line-height:1.6;}\
.empty b{display:block;color:var(--ink2);font-size:13px;margin-bottom:5px;}\
.side footer{display:flex;gap:7px;padding:10px;border-top:1px solid var(--line);background:var(--bg2);}\
.side footer .btn{flex:none;}\
.side footer .btn.pri{flex:1;}\
.x{margin-left:auto;width:26px;height:26px;border-radius:6px;display:grid;place-items:center;color:var(--ink3);font-size:15px;}\
.x:hover{background:var(--bg2);color:var(--ink);}\
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:5;background:#161d24;color:#fff;padding:9px 15px;border-radius:8px;\
font-size:12.5px;box-shadow:var(--shadow);opacity:0;transition:opacity .18s,transform .18s;pointer-events:none;}\
.toast.show{opacity:1;transform:translateX(-50%) translateY(-4px);}\
.sink{position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;}\
";

  function buildUI() {
    var host = el("div", { id: "rm-root" });
    host.style.cssText = "all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;";
    var root = host.attachShadow({ mode: "open" });
    root.appendChild(el("style", { text: SHADOW_CSS }));

    ui.root = root;
    ui.toggle = el("button", { class: "pill", title: "Toggle review mode (Alt+R)", onclick: function () { setMode(!on); } }, [
      el("span", { class: "dot" }), el("span", { class: "lbl", text: "Review" }),
    ]);
    ui.counter = el("button", { class: "pill", title: "Show all comments", onclick: openSide }, [
      el("span", { class: "n", text: "0" }), el("span", { text: "comments" }),
    ]);
    ui.dock = el("div", { class: "dock" }, [ui.counter, ui.toggle]);
    ui.toast = el("div", { class: "toast" });
    ui.sink = el("textarea", { class: "sink", "aria-hidden": "true" });
    root.appendChild(ui.dock);
    root.appendChild(ui.toast);
    root.appendChild(ui.sink);

    (document.body || document.documentElement).appendChild(host);
    ui.host = host;
  }

  function toast(msg) {
    ui.toast.textContent = msg;
    ui.toast.classList.add("show");
    clearTimeout(ui.toastT);
    ui.toastT = setTimeout(function () { ui.toast.classList.remove("show"); }, 2100);
  }

  function place(node, x, y) {
    node.style.visibility = "hidden";
    ui.root.appendChild(node);
    var w = node.offsetWidth, h = node.offsetHeight;
    var left = Math.min(Math.max(8, x - w / 2), innerWidth - w - 8);
    var top = y + 10;
    if (top + h > innerHeight - 8) top = Math.max(8, y - h - 14);
    node.style.left = left + "px";
    node.style.top = top + "px";
    node.style.visibility = "visible";
  }

  /* ── composer / viewer card ──────────────────────────────────────────── */

  function closeCard() {
    if (ui.card) { ui.card.remove(); ui.card = null; }
  }

  function closeBubble() {
    if (ui.bubble) { ui.bubble.remove(); ui.bubble = null; }
  }

  function openComposer(target, x, y, sel) {
    closeCard();
    closeBubble();
    var kind = lastKind() || "question";
    var quote = sel ? sel.quote : clip(blockText(target), 220);

    var ta = el("textarea", { placeholder: "What's the comment?  ⌘↵ to save" });
    var kindRow = el("div", { class: "kinds" }, KINDS.map(function (k) {
      var b = el("button", { class: "kind", "aria-pressed": String(k.id === kind), onclick: function () {
        kind = k.id;
        Array.prototype.forEach.call(kindRow.children, function (c, i) {
          c.setAttribute("aria-pressed", String(KINDS[i].id === kind));
        });
        ta.focus();
      } }, [el("i"), document.createTextNode(k.label)]);
      b.style.setProperty("--k", k.color);
      return b;
    }));

    function commit() {
      var body = ta.value.trim();
      if (!body) return;
      lastKind(kind);
      add(target, kind, body, sel);
      closeCard();
    }

    var card = el("div", { class: "card" }, [
      el("div", { class: "quote" }, [
        el("b", { text: (sel ? "selection" : describe(target)) + " · " + clip(nearestHeading(target), 46) }),
        document.createTextNode(quote || "(no text)"),
      ]),
      kindRow, ta,
      el("div", { class: "row" }, [
        el("span", { class: "hint", text: "esc to cancel" }),
        el("span", { class: "sp" }),
        el("button", { class: "btn", text: "Cancel", onclick: closeCard }),
        el("button", { class: "btn pri", text: "Comment", onclick: commit }),
      ]),
    ]);
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
    });
    ui.card = card;
    place(card, x, y);
    ta.focus();
  }

  function openViewer(id, x, y) {
    var n = notes.filter(function (v) { return v.id === id; })[0];
    if (!n) return;
    closeCard();
    var k = KIND[n.kind] || KINDS[0];
    var card = el("div", { class: "card" }, [
      el("div", { class: "quote" }, [
        el("b", { text: k.label + " · " + clip(n.heading, 46) }),
        document.createTextNode(n.quote || n.excerpt || ""),
      ]),
      el("div", { class: "row", style: "padding-top:10px;align-items:flex-start;" }, [
        el("p", { text: n.body, style: "margin:0;font-size:13px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;" }),
      ]),
      el("div", { class: "row" }, [
        el("button", { class: "btn", text: n.done ? "Reopen" : "Resolve", onclick: function () { toggleDone(id); closeCard(); } }),
        el("span", { class: "sp" }),
        el("button", { class: "btn danger", text: "Delete", onclick: function () { remove(id); closeCard(); } }),
        el("button", { class: "btn pri", text: "Edit", onclick: function () { editNote(id, x, y); } }),
      ]),
    ]);
    card.style.setProperty("--k", k.color);
    ui.card = card;
    place(card, x, y);
  }

  function editNote(id, x, y) {
    var n = notes.filter(function (v) { return v.id === id; })[0];
    if (!n) return;
    closeCard();
    var ta = el("textarea");
    ta.value = n.body;
    var card = el("div", { class: "card" }, [
      el("div", { class: "quote" }, [el("b", { text: "editing · " + clip(n.heading, 46) }), document.createTextNode(n.quote || n.excerpt || "")]),
      ta,
      el("div", { class: "row" }, [
        el("span", { class: "sp" }),
        el("button", { class: "btn", text: "Cancel", onclick: closeCard }),
        el("button", { class: "btn pri", text: "Save", onclick: function () {
          n.body = ta.value.trim() || n.body;
          save().then(renderSide);
          closeCard();
        } }),
      ]),
    ]);
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); n.body = ta.value.trim() || n.body; save().then(renderSide); closeCard(); }
    });
    ui.card = card;
    place(card, x, y);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  /* ── annotation lifecycle ────────────────────────────────────────────── */

  function add(node, kind, body, sel) {
    var text = blockText(node);
    var n = {
      id: uid(),
      kind: kind,
      body: body,
      created: Date.now(),
      done: false,
      path: pathOf(node),
      tag: describe(node),
      heading: nearestHeading(node),
      hash: hash(text),
      excerpt: clip(text, 260),
      quote: sel ? sel.quote : "",
      start: sel ? sel.start : null,
      end: sel ? sel.end : null,
    };
    notes.push(n);
    live[n.id] = { node: node, state: "ok", marks: [], pin: null };
    paint(n);
    save().then(renderSide);
    bumpCount();
    toast(KIND[kind].label + " added · " + notes.length + " total");
  }

  function remove(id) {
    unpaint(id);
    notes = notes.filter(function (n) { return n.id !== id; });
    delete live[id];
    save().then(renderSide);
    bumpCount();
  }

  function toggleDone(id) {
    notes.forEach(function (n) { if (n.id === id) n.done = !n.done; });
    var l = live[id];
    if (l && l.pin) l.pin.classList.toggle("rm-off");
    save().then(renderSide);
  }

  function clearAll() {
    Object.keys(live).forEach(unpaint);
    notes = [];
    live = {};
    save().then(renderSide);
    bumpCount();
    toast("All comments cleared");
  }

  /* ── painting ────────────────────────────────────────────────────────── */

  function paint(n) {
    var l = live[n.id];
    if (!l || !l.node) return;
    var color = (KIND[n.kind] || KINDS[0]).color;
    var node = l.node;
    node.style.setProperty("--rm-c", color);

    if (n.start != null && n.end != null && n.end > n.start) {
      l.marks = wrapRange(node, n.start, Math.min(n.end, blockText(node).length), color);
    }
    if (!l.marks || !l.marks.length) node.classList.add("rm-anno");

    var pin = el("sup", { class: "rm-pin" + (n.done ? " rm-off" : ""), "data-rm-id": n.id, text: (KIND[n.kind] || KINDS[0]).glyph });
    pin.style.setProperty("--rm-c", color);
    pin.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      openViewer(n.id, e.clientX, e.clientY);
    });
    var last = l.marks && l.marks.length ? l.marks[l.marks.length - 1] : null;
    if (last && last.parentNode) last.parentNode.insertBefore(pin, last.nextSibling);
    else node.appendChild(pin);
    l.pin = pin;
  }

  function unpaint(id) {
    var l = live[id];
    if (!l) return;
    if (l.pin && l.pin.parentNode) l.pin.remove();
    (l.marks || []).forEach(unwrap);
    l.marks = [];
    l.pin = null;
    if (l.node) {
      var sharing = notes.filter(function (n) {
        return n.id !== id && live[n.id] && live[n.id].node === l.node && live[n.id].pin;
      });
      if (!sharing.some(function (n) { return !(live[n.id].marks || []).length; })) {
        l.node.classList.remove("rm-anno");
      }
      if (!sharing.length) {
        // leave the element exactly as authored
        l.node.style.removeProperty("--rm-c");
        if (!l.node.getAttribute("style")) l.node.removeAttribute("style");
        if (!l.node.getAttribute("class")) l.node.removeAttribute("class");
      }
    }
  }

  function repaintAll() {
    // resolve every anchor first, then mutate — resolution reads authored text
    notes.forEach(function (n) {
      var r = resolve(n);
      live[n.id] = { node: r.node, state: r.state, marks: [], pin: null };
    });
    notes.forEach(paint);
  }

  function clearPaint() {
    Object.keys(live).forEach(unpaint);
  }

  /* ── review mode ─────────────────────────────────────────────────────── */

  function hit(node) {
    if (!node || node.nodeType !== 1) return null;
    if (node.closest("#rm-root, .rm-pin")) return null;
    var t = node.closest(TARGETS);
    if (!t || t.closest(SKIP)) return null;
    if (t.tagName !== "IMG" && t.tagName !== "SVG" && !squash(blockText(t))) return null;
    return t;
  }

  function onOver(e) {
    if (!on) return;
    var t = hit(e.target);
    if (t === ui.hover) return;
    if (ui.hover) ui.hover.classList.remove("rm-hit");
    ui.hover = t;
    if (t) t.classList.add("rm-hit");
  }

  function onClick(e) {
    if (!on) return;
    if (e.target.closest && e.target.closest("#rm-root, .rm-pin")) return;
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed && squash(sel.toString())) return; // selection flow owns it
    var t = hit(e.target);
    if (!t) { closeCard(); return; }
    e.preventDefault();
    e.stopPropagation();
    openComposer(t, e.clientX, e.clientY, null);
  }

  function onUp(e) {
    if (!on) return;
    if (e.target.closest && e.target.closest("#rm-root")) return;
    setTimeout(function () {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed) { closeBubble(); return; }
      var text = squash(sel.toString());
      if (!text) { closeBubble(); return; }
      var range = sel.getRangeAt(0);
      var node = hit(range.commonAncestorContainer.nodeType === 1
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement);
      if (!node) { closeBubble(); return; }

      var offs = offsetsOf(node, range);
      if (!offs) { closeBubble(); return; }
      var rect = range.getBoundingClientRect();
      closeBubble();
      var b = el("div", { class: "bubble" }, [
        el("button", { html: "&#9998; Comment on selection", onclick: function () {
          var picked = { start: offs[0], end: offs[1], quote: clip(sel.toString(), 300) };
          var r = rect;
          sel.removeAllRanges();
          openComposer(node, r.left + r.width / 2, r.bottom, picked);
        } }),
      ]);
      ui.bubble = b;
      b.style.visibility = "hidden";
      ui.root.appendChild(b);
      b.style.left = Math.min(Math.max(8, rect.left + rect.width / 2 - b.offsetWidth / 2), innerWidth - b.offsetWidth - 8) + "px";
      b.style.top = (rect.bottom + 8 > innerHeight - 40 ? rect.top - 36 : rect.bottom + 8) + "px";
      b.style.visibility = "visible";
    }, 0);
  }

  function offsetsOf(node, range) {
    var nodes = textNodes(node), pos = 0, start = null, end = null;
    for (var i = 0; i < nodes.length; i++) {
      var t = nodes[i], len = t.data.length;
      if (t === range.startContainer) start = pos + range.startOffset;
      if (t === range.endContainer) end = pos + range.endOffset;
      pos += len;
    }
    if (start == null) start = 0;
    if (end == null) end = pos;
    if (end <= start) return null;
    return [start, end];
  }

  function onKey(e) {
    if (e.key === "Escape") {
      if (ui.card) return closeCard();
      if (ui.bubble) return closeBubble();
      if (ui.side) return closeSide();
    }
    var tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || (e.target && e.target.isContentEditable)) return;
    if (e.altKey && (e.key === "r" || e.key === "R")) { e.preventDefault(); setMode(!on); }
  }

  function setMode(next) {
    if (next === on) return;
    on = next;
    show(true);
    if (on) {
      pageStyle();
      document.documentElement.setAttribute("data-rm-on", "");
      repaintAll();
      document.addEventListener("mouseover", onOver, true);
      document.addEventListener("click", onClick, true);
      document.addEventListener("mouseup", onUp, true);
      var detached = notes.filter(function (n) { return live[n.id] && live[n.id].state === "detached"; }).length;
      toast(notes.length
        ? "Review mode · " + notes.length + " comment" + (notes.length > 1 ? "s" : "") + (detached ? " (" + detached + " detached)" : "")
        : "Review mode · click any block, or select text");
    } else {
      document.documentElement.removeAttribute("data-rm-on");
      if (ui.hover) { ui.hover.classList.remove("rm-hit"); ui.hover = null; }
      clearPaint();
      closeCard();
      closeBubble();
      closeSide();
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("mouseup", onUp, true);
    }
    ui.toggle.classList.toggle("on", on);
    ui.toggle.querySelector(".lbl").textContent = on ? "Reviewing" : "Review";
    bumpCount();
  }

  function bumpCount() {
    document.documentElement.dataset.rmCount = String(notes.length);
    if (!ui.counter) return;
    ui.counter.querySelector(".n").textContent = String(notes.length);
    ui.counter.style.display = notes.length ? "" : "none";
    if (ui.side) renderSide();
  }

  function show(v) {
    if (ui.dock) ui.dock.style.display = v ? "" : "none";
  }

  /* ── sidebar ─────────────────────────────────────────────────────────── */

  function openSide() {
    if (ui.side) return renderSide();
    if (notes.length && !Object.keys(live).length) {
      notes.forEach(function (n) {
        var r = resolve(n);
        live[n.id] = { node: r.node, state: r.state, marks: [], pin: null };
      });
    }
    ui.side = el("div", { class: "side" }, [
      el("header", {}, [
        el("h2", { text: "Review comments" }),
        el("span", { class: "sum" }),
        el("button", { class: "x", html: "&times;", title: "Close", onclick: closeSide }),
      ]),
      el("div", { class: "list" }),
      el("footer", {}, [
        el("button", { class: "btn pri", text: "Copy follow-up prompt", onclick: function () { copy(buildPrompt(), "Prompt copied — " + notes.length + " comment" + (notes.length === 1 ? "" : "s")); } }),
        el("button", { class: "btn", text: "JSON", title: "Copy raw annotations", onclick: function () { copy(JSON.stringify({ title: document.title, url: location.href, notes: notes }, null, 2), "JSON copied"); } }),
        el("button", { class: "btn danger", text: "Clear", onclick: function () { if (confirm("Delete all " + notes.length + " comments on this page?")) clearAll(); } }),
      ]),
    ]);
    ui.root.appendChild(ui.side);
    ui.dock.classList.add("shift");
    renderSide();
  }

  function closeSide() {
    if (ui.side) { ui.side.remove(); ui.side = null; }
    if (ui.dock) ui.dock.classList.remove("shift");
  }

  function renderSide() {
    if (!ui.side) return;
    var list = ui.side.querySelector(".list");
    list.textContent = "";
    var tally = {};
    notes.forEach(function (n) { tally[n.kind] = (tally[n.kind] || 0) + 1; });
    ui.side.querySelector(".sum").textContent = notes.length
      ? KINDS.filter(function (k) { return tally[k.id]; }).map(function (k) { return tally[k.id] + " " + k.id; }).join(" · ")
      : "";

    if (!notes.length) {
      list.appendChild(el("div", { class: "empty" }, [
        el("b", { text: "No comments yet" }),
        document.createTextNode("Click any paragraph, table cell, card or image. Or select text and use the ✎ bubble."),
      ]));
      return;
    }

    sorted().forEach(function (n, i) {
      var k = KIND[n.kind] || KINDS[0];
      var l = live[n.id] || {};
      var item = el("div", { class: "note" + (n.done ? " done" : "") }, [
        el("div", { class: "top" }, [
          el("span", { class: "tag", text: (i + 1) + " " + k.label }),
          el("span", { class: "loc", text: clip(n.heading, 40) }),
          l.state === "detached" ? el("span", { class: "warn", text: "detached" })
            : l.state === "drifted" ? el("span", { class: "warn", text: "text changed" })
            : l.state === "moved" ? el("span", { class: "warn", text: "moved", style: "color:#a3600f" }) : null,
        ]),
        el("blockquote", { text: n.quote || n.excerpt }),
        el("p", { text: n.body }),
        el("div", { class: "acts" }, [
          el("button", { text: "Jump", onclick: function () { jump(n.id); } }),
          el("button", { text: "Edit", onclick: function () { editNote(n.id, innerWidth - 400, 120); } }),
          el("button", { text: n.done ? "Reopen" : "Resolve", onclick: function () { toggleDone(n.id); } }),
          el("button", { text: "Delete", onclick: function () { remove(n.id); } }),
        ]),
      ]);
      item.style.setProperty("--k", k.color);
      list.appendChild(item);
    });
  }

  function jump(id) {
    var l = live[id];
    if (!l || !l.node) return toast("That anchor is gone from the page");
    var target = (l.marks && l.marks[0]) || l.node;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    l.node.classList.add("rm-flash");
    setTimeout(function () { l.node.classList.remove("rm-flash"); }, 1200);
  }

  /* ── export ──────────────────────────────────────────────────────────── */

  function buildPrompt() {
    var open = sorted().filter(function (n) { return !n.done; });
    var tally = {};
    open.forEach(function (n) { tally[n.kind] = (tally[n.kind] || 0) + 1; });
    var mix = KINDS.filter(function (k) { return tally[k.id]; })
      .map(function (k) { return tally[k.id] + " " + k.label.toLowerCase() + (tally[k.id] > 1 ? "s" : ""); })
      .join(", ");

    var out = [];
    out.push("# Review pass — " + (squash(document.title) || location.pathname));
    out.push("");
    out.push("Document: `" + location.href + "`");
    out.push(open.length + " open comment" + (open.length === 1 ? "" : "s") + (mix ? " (" + mix + ")" : "") + ", in document order.");
    out.push("");
    out.push("Work through every comment below. Each one quotes the exact text it is attached to.");
    out.push("- **Question** — answer it, and fold the answer into the document where it belongs.");
    out.push("- **Issue** — the claim is wrong or unsupported; verify against the source and correct it.");
    out.push("- **Nit** — small wording or formatting fix.");
    out.push("- **Idea** — evaluate, then apply or reject with a one-line reason.");
    out.push("- **Praise** — keep it as-is; do not rewrite that part.");
    out.push("");
    out.push("Preserve the document's existing structure, voice and markup. Report back any comment you chose not to act on and why.");
    out.push("");
    out.push("---");

    open.forEach(function (n, i) {
      var k = KIND[n.kind] || KINDS[0];
      var l = live[n.id] || {};
      out.push("");
      out.push("## " + (i + 1) + ". " + k.label.toUpperCase() + " — " + (n.heading || "(no section)"));
      var loc = "`" + n.tag + "`" + (n.start != null ? " · text selection" : " · whole block");
      if (l.state === "detached") loc += " · **anchor no longer found in the page**";
      else if (l.state === "drifted") loc += " · **surrounding text changed since the comment**";
      out.push("Anchor: " + loc);
      out.push("");
      (n.quote || n.excerpt || "").split("\n").forEach(function (line) { out.push("> " + line); });
      out.push("");
      if (n.start != null && n.excerpt && n.excerpt !== n.quote) {
        out.push("Surrounding block: " + n.excerpt);
        out.push("");
      }
      out.push(n.body);
    });

    var done = notes.filter(function (n) { return n.done; });
    if (done.length) {
      out.push("");
      out.push("---");
      out.push("");
      out.push("_" + done.length + " comment" + (done.length === 1 ? "" : "s") + " already resolved and omitted._");
    }
    return out.join("\n");
  }

  function copy(text, msg) {
    var done = function () { toast(msg); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else fallbackCopy(text, done);
  }

  function fallbackCopy(text, done) {
    ui.sink.value = text;
    ui.sink.select();
    try {
      document.execCommand("copy");
      done();
    } catch (e) {
      toast("Copy blocked — press ⌘C now");
    }
  }

  /* ── boot ────────────────────────────────────────────────────────────── */

  function boot() {
    buildUI();
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("reviewmode:toggle", function () { setMode(!on); });
    document.addEventListener("reviewmode:activate", function () { show(true); setMode(true); });
    document.addEventListener("reviewmode:deactivate", function () { setMode(false); show(false); });
    addEventListener("resize", closeBubble);

    show(CONFIG.launcher);
    store.get().then(function (saved) {
      notes = (saved && saved.notes) || [];
      bumpCount();
      if (CONFIG.open || (notes.length && CONFIG.launcher && location.hash === "#review")) setMode(true);
    });

    window.ReviewMode = {
      version: VERSION,
      proxy: false,
      toggle: function () { setMode(!on); },
      activate: function () { show(true); setMode(true); },
      deactivate: function () { setMode(false); show(false); },
      show: show,
      count: function () { return notes.length; },
      notes: function () { return notes.slice(); },
      prompt: buildPrompt,
      clear: clearAll,
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
