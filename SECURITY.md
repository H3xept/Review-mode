# Security Policy

## Supported versions

The latest release receives security fixes. Older releases may receive fixes when maintainers consider the change safe and practical.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/H3xept/review_mode/security/advisories/new). Do not open a public issue for an undisclosed vulnerability.

Include:

- The affected version or commit.
- The page or extension context.
- Reproduction steps.
- The expected security boundary.
- Any known workaround.

A maintainer will acknowledge the report through the advisory. The project will coordinate a fix and disclosure there.

## Security model

Review Mode stores comments in browser-local storage. The runtime has no analytics or backend.

The Chrome extension requests access to pages so it can attach the review interface. Chrome still blocks protected browser pages.

The command-line installer copies the tracked runtime beside the selected HTML file. The optional Claude Code hook only processes successful HTML writes inside the configured project root.
