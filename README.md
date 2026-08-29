# youle_desktop

Cross-platform macOS/Windows desktop shell for running the local Codex
app-server through an Electron UI.

## Layout

- `youle_desktop/` - Electron app source.
- `youle_desktop/resources/bin/` - bundled Codex runtimes for Windows and
  macOS (`darwin-x64`/`darwin-arm64`), tracked with Git LFS.
- `youle_desktop/resources/default-youle-ai/config.toml` - bundled default provider config.
- `youle_desktop/release/youle_desktop-0.1.0-Setup.exe` - current Windows installer, tracked with Git LFS.

Generated folders such as `node_modules/`, `runtime/`, `dist/`, and
`release/win-unpacked/` are intentionally ignored.

## Default Codex Config

The desktop app uses bundled provider defaults when starting `codex app-server`.
It does not create or modify `%USERPROFILE%\.codex\config.toml`.

For local test builds, an ignored `resources/default-youle-ai/auth.json` can also
be bundled. The app reads that file from the installation directory and passes
`OPENAI_API_KEY` only to the child `codex app-server` process environment. It
does not create or modify `%USERPROFILE%\.codex\auth.json`.

Runtime files created by Codex are isolated under Electron user data
(`%APPDATA%\youle_desktop\youle-ai-home`) instead of the user's normal
`%USERPROFILE%\.codex` directory.

The default desktop workspace is also isolated from the user's home directory:
`%PUBLIC%\Documents\youle_desktop-workspace` on Windows, unless
`YOULE_DESKTOP_WORKSPACE` or `CODEX_DESKTOP_WORKSPACE` is set.

## Common Commands

```powershell
D:\nodejs\pnpm.cmd install
D:\nodejs\pnpm.cmd --filter youle_desktop dev
D:\nodejs\pnpm.cmd --filter youle_desktop smoke
D:\nodejs\pnpm.cmd --filter youle_desktop dist:win
```

On macOS, use the native pnpm commands and choose an architecture-specific or
universal package:

```bash
pnpm install
pnpm --filter youle_desktop dev
pnpm --filter youle_desktop verify:mac:runtimes
pnpm --filter youle_desktop dist:mac:arm64       # Apple Silicon
pnpm --filter youle_desktop dist:mac:x64         # Intel
pnpm --filter youle_desktop dist:mac:universal  # both architectures
```

The macOS build uses the native `.icns` icon, traffic-light titlebar, Dock and
menu-bar tray behavior, microphone permission prompts, and architecture-matched
`haolo_ai`/`rg` binaries. Signing/notarization credentials can be supplied to
`electron-builder` for a production release; local builds remain unsigned.

## GitHub Windows Build

The repository includes a GitHub Actions workflow for packaging the Windows
desktop app:

1. Open **Actions** in GitHub.
2. Select **Build Windows Desktop**.
3. Click **Run workflow**.
4. Download the generated artifacts after the run completes:
   - `youle_desktop-windows-installer` contains the NSIS setup executable.
   - `youle_desktop-windows-unpacked` contains a zipped `win-unpacked` app.

The workflow runs on `windows-latest`, installs pnpm, pulls Git LFS resources,
typechecks, builds the renderer, and packages the app with `electron-builder`.
It also validates the bundled Codex version, SHA-256 manifest, Authenticode
signatures, and required Windows sandbox helpers, so incomplete or mismatched
runtime packages fail fast.

If you are using the copied local runtime from this machine:

```powershell
D:\youle_desktop\runtime\nodejs\pnpm.cmd --filter youle_desktop dev
```

The Windows installer is produced at:

```text
D:\youle_desktop\youle_desktop\release\youle_desktop-0.1.0-Setup.exe
```
