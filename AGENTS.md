# Repository guidance

Use `review-mode.js` as the single source of browser behavior. Keep the runtime dependency-free and build-free.

Run `npm test` after changing installer, hook, manifest, skill, or version metadata.

Exercise `demo/index.html` in a real browser after changing page behavior. Verify activation, block comments, selection comments, the sidebar, prompt export, reload restoration, and clean deactivation.

Keep `package.json`, `manifest.json`, and `review-mode.js` versions equal.

Preserve user page markup. Review Mode may inject temporary highlights and pins only while active.

Keep command-line installation idempotent. Limit the post-hook to HTML files inside the configured project.
