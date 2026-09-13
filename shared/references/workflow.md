# Parent workflow

Follow the user's explicit task and constraints; implementation and review are defaults.

Before launch, select the absolute repository root, read applicable instructions, and inspect `git -C <repository> status -sb`. Preserve existing work. Resolve routine choices autonomously and clarify only material ambiguity. Do not commit, push, deploy, publish sessions, create worktrees, or delegate again unless that additional action was explicitly requested. Do not spawn Codex subagents as part of this workflow.

Write a self-contained `request.md`: objective, repository, exact scope/comparison, constraints, relevant existing edits, baseline path when applicable, and expected final response. Omit the parent task ID; only the worker needs it. The worker appends the shared [task instructions](../prompts/task.md) and, in review mode, [review prompt](../prompts/review.md) automatically.

Follow the execution-permission guidance in [runtime.md](runtime.md); delegation does not make every preparation command an elevated operation. State the selected agent and repository; the runner applies the saved sandbox preference. If automatic approval review rejects an action, report the rejected action and reason; do not bypass it.

After `started`, report the launch and the returned `sandbox`, then **end the turn**. No polling, waiting, scheduled checks, or intermediate output reads. A single worker notification resumes the originating task. Explicit user status requests may read the known job's state without starting another run.

## Implement

1. Record existing changes and take a baseline using [snapshot.md](snapshot.md). Investigate relevant code and specifications, and write a concrete plan or design **when the task needs one**. A straightforward instruction can be delegated directly.
2. Use `--mode implement`. Require the delegated agent to implement the task, preserve existing work, update related documentation, and run the checks justified by the changes and project instructions. It should fix its own failures and report existing failures or environment blockers separately. If a material question blocks progress, it should state the question in its final response rather than invent a requirement.
3. On completion, read the **last assistant response** in `report.md` and the baseline diff as needed to assess the changes. Do not retrieve session history, tool logs, or complete files for a second investigation. Checks described in the response are the delegated agent-reported results, not independently observed test evidence.
4. If needed, make a small, clear correction of a few lines yourself and perform the relevant check. Delegate substantial remaining corrections in a fresh job using the saved session. If the same implementation still fails after three correction rounds, stop and report the unresolved issue. Preserve the work.

Report what changed, reported checks, any checks you ran yourself, and remaining limitations. Do not repeat passing checks without a relevant change or unresolved problem.

## Review

Explicit scope wins: a diff against a named branch, commit, paths, or the entire codebase. Otherwise select the first nonempty scope:

1. Unstaged changes, including non-ignored untracked files.
2. Staged changes.
3. Current branch changes from its merge base with an established base branch.

Do not treat a clean working tree as proof that the branch has no changes. Resolve the base from the user's context or a clear repository convention; do not mistake the current branch's remote tracking ref for its base. Ask when the base is unclear. On `main`, `master`, or `develop`, do not infer a whole-codebase review. If the context suggests that intent, ask; otherwise report no review target when there are no selected changes. If an explicitly selected branch comparison is empty, report no review target without running the delegated agent. Never broaden an empty diff into a whole-codebase review.

Use `--mode review`; the adapter applies its review permissions and, when enabled, SRT makes the repository and Git metadata read-only. Request findings only, with no fixes. Include the exact comparison and untracked paths in `request.md`; see [runtime.md](runtime.md) for scope commands. The reviewer may read surrounding code to understand the selected changes.

The worker supplies the shared review prompt; add only scope-specific concerns from the user.

On completion, use only the final assistant response and, if needed, the selected diff to assess findings. Summarize credible findings with severity and location; distinguish unverified claims. Do not fix code unless the user requests it. No findings means no findings in the reviewed scope, not proof that the code is defect-free.
