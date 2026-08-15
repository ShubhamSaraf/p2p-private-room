# Phase 15 - Multiple files and folders

The file picker accepts multiple files, and a directory picker is exposed on browsers that implement
`webkitdirectory`. A batch confirmation shows file count and total size, then emits individually
encrypted and verified file offers. Aggregate progress is shown above the individual transfer cards.

Folder-relative paths are carried as optional validated metadata. Absolute paths, traversal segments,
backslashes, control characters, and overlong paths are rejected. Received downloads remain explicit
per-file browser downloads rather than attempting unrestricted filesystem writes.
