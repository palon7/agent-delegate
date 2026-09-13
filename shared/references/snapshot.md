# Baseline diff and storage

For implementation, save the actual working-file state immediately before delegation. A status listing or `git diff HEAD` alone cannot distinguish new edits from pre-existing edits to the same file.

```bash
node "$plugin_root/shared/scripts/snapshot.mjs" before \
  --cwd "$repository" --snapshot "$job_dir/baseline"
```

After completion, when checking the implementation:

```bash
node "$plugin_root/shared/scripts/snapshot.mjs" diff \
  --snapshot "$job_dir/baseline" > "$job_dir/changes.patch"
```

The second command captures current files before comparing. Do not let another writer edit the same repository during the job: a content comparison cannot attribute simultaneous human edits to a particular author. Each correction job gets a fresh baseline; retain the first baseline until the overall task has been assessed if a cumulative diff is needed.

## What is stored

The helper creates a private Git index and object directory. Existing repository objects are borrowed read-only through Git alternates; history and unchanged blobs are not copied. New objects are compressed by Git and reused across the before/after captures. The repository's index, refs, and object directory are not written by the helper's Git commands. It does not stash, commit, or alter staging.

Additional storage is approximately the index/tree metadata plus compressed versions of new or modified content absent from the original object database. It is **not always small**: a large new or modified binary may consume roughly its full size per captured version. Capture must also scan working files; repositories with many files cost time and index space even with few changes. Repeated captures can retain intermediate objects until the snapshot directory is removed.

Before a large job, inspect changed/untracked paths and their sizes, available space, and whether generated assets are ignored. If their storage is material, explain it and agree a narrower explicit task scope or storage location; do not silently drop user source files. Keep baseline data only until review is complete. The review diff reports binary changes without embedding binary payloads, avoiding another large copy in the patch or model context.

## Coverage and limits

- Includes staged, unstaged, deleted, and non-ignored untracked files as they exist on disk. Pre-existing staged additions remain tracked for snapshot purposes even if their paths match ignore rules.
- Ignored files are excluded unless explicitly requested with repeated `--include <root-relative-path>` arguments. Already tracked ignored files remain included.
- Merge conflicts must be resolved first. Git clean filters apply, so this is a Git-normalized content comparison, not a byte-for-byte archive. Filters such as Git LFS can have their own storage or side effects; inspect those before using this helper in such a repository.
- Submodules are represented by their Git links, not a recursive capture of dirty submodule files. If a task changes submodule contents, take a separate baseline inside each affected submodule.
- Use the source repository normally while the job is active; do not delete it or prune objects that the snapshot borrows. This is temporary review material, not an independent backup.
- The helper requires Git. An explicitly requested task in a non-Git directory needs an agreed file scope and a separate before/after file copy comparison.

Sources: [Git environment variables](https://git-scm.com/docs/git#_environment_variables), [write-tree](https://git-scm.com/docs/git-write-tree), [diff](https://git-scm.com/docs/git-diff).
