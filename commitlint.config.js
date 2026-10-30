// Conventional Commits enforcement — the format semantic-release parses on
// push to main (feat: → minor, fix: → patch, feat!:/BREAKING CHANGE: → major,
// everything else → no release). Defaults align with the release pipeline:
// merge/Revert/fixup commits are ignored.
export default { extends: ['@commitlint/config-conventional'] };
