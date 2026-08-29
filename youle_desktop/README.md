# youle_desktop

A cross-platform Electron desktop shell for the Codex app-server protocol. It starts
`codex app-server` on a loopback websocket, initializes a desktop client
session, streams thread items into a native window, and surfaces approval
prompts inside the app.

## Run

```powershell
# From the repository root
pnpm install
pnpm --filter youle_desktop dev
```

If PowerShell blocks shim scripts, use the `.cmd` shim explicitly:

```powershell
D:\nodejs\pnpm.cmd --filter youle_desktop dev
```

## Verify Backend Without UI

```powershell
pnpm --filter youle_desktop smoke
```

## Build installers

```powershell
D:\nodejs\pnpm.cmd --filter youle_desktop dist:win
```

The installer is written to:

```text
D:\youle_desktop\youle_desktop\release\youle_desktop-0.1.0-Setup.exe
```

macOS builds select the matching bundled runtime automatically:

```bash
pnpm run verify:mac:runtimes
pnpm run dist:mac:arm64       # Apple Silicon
pnpm run dist:mac:x64         # Intel
pnpm run dist:mac:universal   # universal DMG
```

macOS packages use the native `.icns` icon and titlebar controls, request
microphone access through System Settings when voice input is used, and bundle
separate `darwin-arm64`/`darwin-x64` `haolo_ai` and `rg` binaries. For local
unsigned packages, use `pack:mac:*`; production signing and notarization are
provided by the standard `electron-builder` environment variables.

The package bundles the signed Codex runtime in `resources/bin/`, including
`haolo_ai.exe` and its Windows sandbox helpers, so the target machine does not
need a global `@openai/codex` npm install.

## Default Codex Config

The installer also bundles `resources/default-youle-ai/config.toml`. The desktop
app uses equivalent provider overrides when starting `codex app-server`; it
does not create or modify `%USERPROFILE%\.codex\config.toml`.

The installer can also bundle an ignored `resources/default-youle-ai/auth.json`
for local test builds. The desktop app reads that file from the installation
directory and passes `OPENAI_API_KEY` only to the child `codex app-server`
process environment. It does not create or modify
`%USERPROFILE%\.codex\auth.json`.

Runtime files created by Codex are isolated under Electron user data
(`%APPDATA%\youle_desktop\youle-ai-home`) instead of the user's normal
`%USERPROFILE%\.codex` directory.

The default desktop workspace is also isolated from the user's home directory:
`%PUBLIC%\Documents\youle_desktop-workspace` on Windows, unless
`YOULE_DESKTOP_WORKSPACE` or `CODEX_DESKTOP_WORKSPACE` is set.

## Codex Binary Resolution

The desktop shell looks for Codex in this order:

1. `YOULE_DESKTOP_CODEX_BIN`, `CODEX_DESKTOP_CODEX_BIN`, or `CODEX_BIN`
2. A locally built `codex-rs/target/debug/codex(.exe)`
3. A packaged `resources/bin/haolo_ai(.exe)`
4. The globally installed `@openai/codex` native binary
5. `codex.exe`, `codex.cmd`, or `codex` on `PATH`

Set `YOULE_DESKTOP_WORKSPACE` or `CODEX_DESKTOP_WORKSPACE` to choose the
initial workspace.

## Youle API Login

The app now shows the same email OTP login flow as the Haolo frontend before
starting the local Codex app-server. The login token is stored in Electron's
user data directory and is used by the left message list.

Optional environment variables:

```text
HAOLO_API_BASE_URL=https://haolo.com
YOULE_API_SEND_OTP_PATH=/api/auth/otp/send
YOULE_API_VERIFY_OTP_PATH=/api/auth/otp/verify
YOULE_API_PROFILE_PATH=/api/profile/me
YOULE_API_CONVERSATIONS_PATH=/api/conversations
YOULE_API_CONVERSATIONS_METHOD=GET
```
