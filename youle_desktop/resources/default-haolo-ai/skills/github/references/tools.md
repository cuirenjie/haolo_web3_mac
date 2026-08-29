# GitHub tool contract

## Read tools

- `github_status`: Show relay availability and policy without exposing credentials.
- `list_my_repositories`: List repositories available to the connected GitHub user, including authorized private repositories.
- `search_repositories`: Search repositories visible to the connected user; without a connection only public results are available.
- `get_repository`: Read repository metadata and the default branch.
- `list_branches`, `get_branch`: Inspect branches and their current commit SHAs.
- `get_file_contents`: Read a file or directory at an optional ref. Text files include `decoded_content` when they fit the relay limit.
- `list_commits`, `get_commit`, `compare_commits`: Inspect repository history and diffs.
- `search_code`: Search code inside one explicit repository.
- `list_issues`, `get_issue`: Inspect issues. Issue lists can contain pull requests.
- `list_pull_requests`, `get_pull_request`, `get_pull_request_files`: Inspect pull requests and changed files.

Use `page` and `per_page` instead of requesting unbounded result sets.

## Write tools

- `create_branch`: Requires `owner`, `repo`, `branch`, and the source commit `sha`.
- `create_or_update_file`: Requires text `content`, `message`, and `branch`; include the current file `sha` when updating.
- `create_issue`: Requires `title`; optional `body` and `labels`.
- `add_issue_comment`: Requires `issue_number` and `body`.
- `create_pull_request`: Requires `title`, `head`, and `base`; defaults to a draft.

All write tools require a connected GitHub user, the backend write switch, any configured administrator repository allowlist, permissions shared by the user and GitHub App, Codex MCP write approval, and explicit user confirmation. GitHub records the connected user as the actor.

## Expected failures

- `GITHUB_DISABLED`: The backend feature switch is off.
- `GITHUB_USER_AUTH_REQUIRED`: Connect or reconnect GitHub under Haolo **设置 → GitHub**.
- `GITHUB_ACCOUNT_ALREADY_CONNECTED`: The GitHub identity is already bound to another Haolo account.
- `GITHUB_REPOSITORY_NOT_ALLOWED`: The operation targeted a repository outside an optional administrator allowlist.
- `GITHUB_WRITE_DISABLED`: The backend is read-only.
- `GITHUB_CREDENTIALS_UNAVAILABLE`: Legacy administrator credential mode is incomplete.
- `GITHUB_RATE_LIMITED`: Wait for `retry_after_ms` before another read; do not automatically retry a write.
- `GITHUB_UPSTREAM_ERROR`: Inspect `upstream_status` and the sanitized message.
