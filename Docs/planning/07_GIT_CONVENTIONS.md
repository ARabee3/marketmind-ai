# Git Conventions

This file defines how the MarketMind AI team should use Git and GitHub during
implementation.

The goal is simple: make changes easy to review, easy to explain, and safe to
merge.

## Branch Names

Use short branch names that include the issue number when possible.

Recommended format:

```text
type/issue-number-short-description
```

Examples:

```text
feature/1-prepared-discovery-contract
feature/4-nestjs-health
fix/5-login-token-refresh
docs/7-git-conventions
```

Use these prefixes:

| Prefix | Use |
|---|---|
| `feature/` | New feature or sprint issue work. |
| `fix/` | Bug fix. |
| `docs/` | Documentation-only change. |
| `test/` | Test-only or test-heavy change. |
| `chore/` | Tooling, config, cleanup, or maintenance. |

Avoid personal names in branch names. The issue owner is already tracked in
GitHub Issues.

## Commit Messages

Use a short, clear sentence in imperative style.

Good examples:

```text
Add prepared discovery contract
Define discovery lifecycle examples
Document Git conventions
Fix duplicate email auth response
```

Avoid vague commits:

```text
updates
fix stuff
final changes
ai code
```

One commit should represent one understandable idea. It is okay for a PR to have
more than one commit when each commit is clear.

## Pull Requests

Every implementation PR should connect to a GitHub Issue.

Use this in the PR body when the PR completes the issue:

```text
Closes #1
```

Use this when the PR only contributes part of the issue:

```text
Part of #1
```

PR titles should be specific:

```text
Add Prepared Discovery contract
Initialize NestJS API health endpoint
Implement owner registration and login
```

Every PR body should include:

- summary of what changed
- why it changed
- how it was tested
- screenshots or transcripts when useful
- related issue link

## Review Flow

Use this flow:

```text
Draft PR -> self-check -> request review -> address comments -> merge
```

Open a draft PR early when:

- the work affects another teammate
- contracts or schemas are changing
- you want review before implementation is complete
- you need help checking direction

Mark the PR ready for review only when:

- local checks pass
- the PR body explains the change
- unrelated changes are removed
- the owner can explain the code or docs

## Before Pushing

Run the relevant checks before pushing.

At minimum from the repo root:

```bash
npm run check
```

If your area adds more commands later, include those commands in the PR body.

Examples:

```text
npm run check
npm --workspace apps/api test
npm --workspace packages/contracts run check
```

## What Not To Do

Do not push directly to `main`.

Do not mix unrelated work in one PR.

Do not hide generated code that nobody understands.

Do not merge a PR with failing required checks unless the team explicitly agrees
and documents why.

Do not rewrite shared history after pushing unless everyone affected agrees.

## Handling Conflicts

If your branch conflicts with `main`:

1. Pull the latest `main`.
2. Rebase or merge carefully.
3. Re-run checks.
4. Ask for help if the conflict touches someone else's area.

Do not resolve conflicts by deleting unfamiliar code. Assume another teammate's
work is intentional until proven otherwise.

## Sensitive Changes

These changes need extra care and the right reviewers:

- authentication
- RBAC and permissions
- database schema or migrations
- AI prompts
- AI provider behavior
- generated profile or strategy schemas
- approval gates
- deployment or secret handling

For sensitive work, include enough PR notes that the reviewer can understand the
risk without guessing.

## Good PR Checklist

- [ ] Branch name is clear.
- [ ] PR links the issue.
- [ ] PR scope matches the issue.
- [ ] Commit messages are understandable.
- [ ] Local checks pass.
- [ ] Docs are updated when behavior or contracts change.
- [ ] Review evidence is included.
- [ ] The owner can explain the work.
