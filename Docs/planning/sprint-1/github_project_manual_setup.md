# GitHub Project Manual Setup

The Sprint 1 issues and labels already exist in GitHub.

The only remaining step is creating the GitHub Project board, because the local GitHub CLI could not save the extra `project` permission scope in the macOS keyring.

## Create the project

1. Open the repo:

   ```text
   https://github.com/ARabee3/marketmind-ai
   ```

2. Go to `Projects`.
3. Create a new project named:

   ```text
   MarketMind AI
   ```

4. Use a board view.

## Status columns

Create these statuses:

```text
Backlog
Sprint Ready
In Progress
Review
Done
Blocked
```

## Add Sprint 1 issues

Add these issues to the project:

```text
#1 Implement Discovery Agent flow contract
#2 Implement real AI provider adapter and Discovery prompt
#3 Implement Discovery schemas and AI evaluation cases
#4 Initialize NestJS backend repo and Health endpoint
#5 Implement Auth APIs
#6 Implement RBAC roles permissions and guards
#7 Plan future audit events for approval-sensitive actions
```

Set status:

- `#1` to `#6` → `Sprint Ready`
- `#7` → `Backlog`

## Team rule

Every pull request should mention or close its issue.

Example:

```text
Closes #5
```

