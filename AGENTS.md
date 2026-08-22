# Repository Instructions

## Release branch workflow

- Treat `main` as the released product baseline. Do not commit or push ordinary development work directly to `main`.
- Start each upcoming release on a dedicated `yukiryou/v<next-version>` branch. Keep implementation, fixes, tests, documentation, and user-accepted iteration commits on that branch while the release is in development.
- Do not merge a version branch into `main` merely because an individual milestone was accepted. Merge only when the repository owner explicitly starts release preparation or authorizes the release merge.
- Keep the package version, changelog, release notes, tag, and published artifacts aligned during release preparation. Merge the completed version branch into `main` before creating the immutable release tag.
- After a release, create the next version branch from the released `main` before continuing product development.

## Archived pet experiment

- `yukiryou/pet-experiment-archive-20260820` is a cold-backup branch for the abandoned pet experiment. Its archive commit is `a05117e` (`archive: preserve abandoned pet experiment`).
- Never merge, rebase, cherry-pick, squash, or otherwise copy this branch into a development, release, or default branch automatically.
- Never use this branch as a development base, release input, dependency source, or conflict-resolution reference unless the repository owner explicitly asks to revive or recover pet work in the current conversation.
- General requests such as "continue", "finish the next phase", "restore previous work", or "develop the roadmap" are not authorization to use the archived branch.
- If pet development is explicitly revived, create a new `yukiryou/` branch and recover only the owner-approved scope. Prefer selective restore after reviewing the archive diff; do not merge the archive wholesale by default.
- The archive is intentionally excluded from the current product line. Keep unrelated development and releases pet-free.
