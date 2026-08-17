# Contributing to Review Mode

Thank you for improving Review Mode. Small, focused changes are easiest to review.

## Before you start

Search existing issues and pull requests. Open an issue before a large behavior change or new integration.

Use Node.js 18 or newer. The browser runtime has no dependencies and no build step.

## Local setup

```bash
git clone https://github.com/H3xept/review_mode.git
cd review_mode
npm test
```

Open `demo/index.html` directly in a browser for manual testing. Load the repository root as an unpacked Chrome extension to test extension behavior.

## Design constraints

- Keep `review-mode.js` as the single browser runtime.
- Keep the runtime dependency-free and build-free.
- Keep comments local to browser storage.
- Preserve existing page markup after review mode closes.
- Keep installer changes idempotent.
- Keep `package.json`, `manifest.json`, and the runtime version aligned.

## Test a change

Run the focused checks:

```bash
npm test
```

Then exercise the changed browser path in `demo/index.html`.

For user interface changes, test these states:

1. A clean page before activation.
2. A whole-block comment.
3. A text-selection comment.
4. The comment sidebar and copied prompt.
5. A reload with stored comments.
6. Deactivation with the original page restored.

For extension changes, test toolbar activation and `Alt+R` on both an HTTP page and an allowed `file://` page.

## Pull requests

Keep each pull request focused. Include:

- The user problem.
- The chosen behavior.
- The exact verification you ran.
- A screenshot or GIF for visible changes.
- Any storage or permission effect.

Update `CHANGELOG.md` for user-visible changes. Do not commit private comments, generated extension archives, or local Claude settings.

By contributing, you agree that your contribution uses the repository's MIT License.
