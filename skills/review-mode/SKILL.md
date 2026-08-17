---
name: review-mode
description: Make HTML output reviewable in the browser and process exported Review Mode feedback. Use when a user asks to annotate HTML, review a generated page, add Review Mode, install the Review Mode post-hook, or apply a pasted Review Mode follow-up prompt.
---

# Review Mode

Turn HTML output into a review surface. Keep the integration local to the document and verify it in a browser.

## Add Review Mode to HTML

1. Identify every HTML entry point the user wants to review.
2. Run the installer for each entry point:

   ```bash
   npx --yes github:H3xept/review_mode install path/to/page.html
   ```

3. Open the real page. Confirm that the **Review** pill appears at the bottom-right.
4. Toggle review mode. Confirm that clicking a text block opens the comment composer.

The installer is idempotent. It copies the runtime to `.review-mode/review-mode.js` beside the page and inserts one marked script block before `</body>`.

## Install the Optional Post-Hook

Use the post-hook only when the user wants every HTML file written by Claude Code to become reviewable automatically.

```bash
npx --yes github:H3xept/review_mode hook install
```

The command updates `.claude/settings.local.json`. It limits the hook to successful `Write` and `Edit` calls for HTML files inside the project.

Remove the post-hook with:

```bash
npx --yes github:H3xept/review_mode hook remove
```

## Process Exported Feedback

A Review Mode follow-up prompt is an exhaustive worklist.

1. Account for every numbered comment.
2. Preserve text marked **Praise**.
3. Answer **Question** comments in the document where the answer belongs.
4. Verify and correct **Issue** comments at the source.
5. Apply **Nit** comments directly.
6. Evaluate each **Idea**. Apply it or give one concise rejection reason.
7. Report every skipped or unresolved comment by number.

Finish when every open comment has an observable disposition and the updated page still renders correctly.
