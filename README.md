# Review Mode

Turn any HTML page into a review surface. Click a block or select text, attach a
comment, then copy one follow-up prompt that carries every comment back to an
agent.

Built for reviewing generated HTML documents, but it assumes nothing about them
— it works on any page.

```
review-mode.js   the whole library (no dependencies, no build step)
manifest.json    Chrome MV3 manifest — the repo root IS the extension
content.js       extension shell: toolbar/keyboard toggle, badge
background.js    MV3 service worker
icons/           toolbar icons
demo/index.html  a page to practise on
```

`review-mode.js` is the only file that matters. The extension files are a shell
around it, so there is exactly one copy of the logic.

## Two ways to load it

### 1. Chrome extension (works on pages you cannot edit)

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
   pick this repository's root directory.
2. For `file://` documents, open the extension's **Details** and enable
   **Allow access to file URLs**.
3. Click the toolbar icon (or press `Alt+R`) on any page to toggle review mode.
   The badge shows the open comment count for that page.

Note: branded Chrome 137+ ignores the `--load-extension` command-line flag, so
load it through the extensions page as above.

### 2. One script tag (travels with the document)

```html
<script src="review-mode.js" defer></script>
```

A floating **Review** pill appears bottom-right. `demo/index.html` carries this
tag — open it directly from disk to try the whole flow. If a document that
loads the library is shared on its own, the script 404s and the page renders
normally.

Options, as `data-` attributes on the script tag:

| attribute | default | effect |
|---|---|---|
| `data-launcher="false"` | `true` | hide the floating pill; drive it via `ReviewMode` |
| `data-open="true"` | `false` | enter review mode on load |
| `data-extra=".myblock,figure>span"` | — | extra selectors to make annotatable |

Loading `page.html#review` opens review mode automatically when the page
already has comments.

A bookmarklet works too, but only against a served copy — a page on `http(s)`
cannot pull a script off `file://`:

```js
javascript:(function(){var s=document.createElement('script');s.src='http://localhost:8000/review-mode.js';document.body.appendChild(s);})()
```

Both loaders can be active at once. Whichever copy initialises first owns the
page; the other one stands down and drives the owner through `CustomEvent`s, so
the extension button still works on a page that ships its own script tag.

## Using it

| action | how |
|---|---|
| toggle review mode | the **Review** pill, `Alt+R`, or the toolbar icon |
| comment on a block | click any paragraph, list item, table cell, card, heading or image |
| comment on a phrase | select text → **✎ Comment on selection** |
| pick a kind | Question · Issue · Nit · Idea · Praise |
| save | **Comment** or `⌘↵` |
| reopen a comment | click its coloured pin |
| see everything | the **n comments** pill |
| export | **Copy follow-up prompt**, or **JSON** for the raw records |

Resolved comments stay in the page but drop out of the generated prompt.

## The generated prompt

Comments are emitted in document order, each with its section heading, its
anchor, the exact quoted text, and — for a phrase-level comment — the
surrounding block. The header tells the agent what each kind means:

```markdown
# Review pass — eToro asks vs. verified continuations v1 — scope assessment

Document: `file:///…/docs/2026-08-15-etoro-asks-vs-vc-scope.html`
2 open comments (1 question, 1 idea), in document order.

…

## 2. QUESTION — 05 Watcher triggers: how safe, precisely
Anchor: `td` · text selection

> 2.777 ETH

Surrounding block: "Swap 5,000 USDC when ETH ≤ $1,800" = "swap 5,000 USDC for ≥ 2.777 ETH"

Show the arithmetic: 5000/1800 = 2.777. Worth a footnote so the floor is checkable.
```

## How anchors survive an edit

Each comment stores a structural path (`div:1>header:1>p:1`), a hash of the
block's text, the quoted text, and character offsets into the block. On reload
the library tries, in order: the path with a matching hash → any block whose
hash matches (the block moved) → any block containing the quoted text →
give up. Comments in the last two states are flagged **moved** / **detached**
in the sidebar and in the generated prompt, so a stale comment is visible
rather than silently misattached.

Offsets and hashes are computed over the page's *authored* text: the
highlight `<mark>`s and pins the library injects are excluded, so annotating
one block never shifts another block's anchor. Leaving review mode unwinds
every injected node — the document's markup returns byte-identical.

## Where comments live

`localStorage` under `reviewmode:v1:<origin><pathname>` for the script tag,
`chrome.storage.local` under the same key for the extension. Per page, on your
machine, never sent anywhere. Nothing is written until you save a comment.

Note the two stores are separate: a comment made through the extension on a
page that also loads the script tag is stored by whichever copy owns the page.

## API

`window.ReviewMode` — `toggle()`, `activate()`, `deactivate()`, `count()`,
`notes()`, `prompt()`, `clear()`. Identical surface whether the object is the
owner or the cross-world proxy.
