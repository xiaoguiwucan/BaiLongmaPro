# Bailongma Full Installer

This package target is for installing Bailongma on a clean macOS machine with the embedded local memory engine.

## What Is Bundled

- `Bailongma.app`
- Built-in SQLite/local-vector group memory runtime
- First-run setup script:
  - `installer/macos/bailongma-full-setup.sh`

## What The Setup Script Does

1. Checks that `/Applications/Bailongma.app` exists.
2. Opens Bailongma.
3. Waits for `http://127.0.0.1:3721/status`.

## What Cannot Be Silently Bundled

- User API keys.
- WeChat login state or QR scan.
- macOS microphone/screen/file permissions.
- Logged-in external CLIs such as Claude Code, Codex, or Hermes.

The app should surface those as setup checklist items instead of pretending the machine is fully configured.

## Build Note

`package.json` uses `extraResources` to copy the macOS setup helper into the packaged app:

```json
{
  "from": "installer/macos",
  "to": "setup"
}
```

For a full release, publish the DMG, blockmap, and `latest-mac.yml`.
