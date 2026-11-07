<div align="center">
  <img src="build/icon.svg" width="112" alt="Vencord Util logo" />
  <h1>Vencord Util</h1>
  <p><strong>Install, update and extend <a href="https://vencord.dev">Vencord</a> from source – without touching a terminal.</strong></p>
  <p>
    <a href="https://github.com/curet-dev/vencord-util/actions/workflows/ci.yml"><img src="https://github.com/curet-dev/vencord-util/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/curet-dev/vencord-util/releases/latest"><img src="https://img.shields.io/github/v/release/curet-dev/vencord-util?color=9E7EB5" alt="Latest release" /></a>
    <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-4C2365" alt="Platforms" />
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-7F5D99" alt="License" /></a>
  </p>
</div>

> Vencord Util is an unofficial helper app and is not affiliated with the Vencord project.

## Features

|                                  |                                                                                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Install from source**          | Clones Vencord, installs dependencies, builds it and injects it into Discord – fully automatic or step by step, following the [official guide](https://docs.vencord.dev/installing/). |
| **Replace the official install** | Detects installs made with the official installer and removes them cleanly. Settings, themes and QuickCSS are kept.                                                                   |
| **Updates**                      | Shows new commits and updates with one click (`git pull` → dependencies → build → restart Discord). Local changes can be stashed first.                                               |
| **Custom plugins**               | Install from GitHub links, folder links, single files, gists or ZIPs – or drag & drop folders, files and links onto the window.                                                       |
| **Multi-plugin repositories**    | Repositories with several plugins or plugins in sub-folders are detected and offered in a selection dialog.                                                                           |
| **Plugin updater**               | Compares the exact Git object of each plugin with GitHub. Only plugins that actually changed are flagged – one API request per repository.                                            |
| **Requirements**                 | Checks Git, Node.js and pnpm and installs missing tools via winget or Homebrew. A broken pnpm is replaced by an app-local copy.                                                       |
| **Discord detection**            | Finds Stable, PTB, Canary and Development, shows the patch state and patches, unpatches or restarts each one.                                                                         |

## Download

Grab the latest build from the [releases page](https://github.com/curet-dev/vencord-util/releases/latest):

| Platform                      | File                                                            |
| ----------------------------- | --------------------------------------------------------------- |
| Windows (installer)           | `VencordUtil-<version>-win-x64-setup.exe` · `…-arm64-setup.exe` |
| Windows (portable)            | `VencordUtil-<version>-win-x64-portable.exe`                    |
| macOS (Apple Silicon & Intel) | `VencordUtil-<version>-mac-universal.dmg`                       |

The builds are not code-signed:

- **Windows** – SmartScreen may warn on first launch: _More info → Run anyway_.
- **macOS** – Right-click the app and choose _Open_, or run `xattr -dr com.apple.quarantine "/Applications/Vencord Util.app"`. Patching Discord requires _System Settings → Privacy & Security → App Management_ for Vencord Util.

## How it works

Patching does exactly what the [official Vencord installer](https://github.com/Vencord/Installer) does:

1. Discord's `resources/app.asar` is renamed to `_app.asar`.
2. A tiny `app.asar` is written that only contains `require("<vencord>/dist/patcher.js")`.

Removing Vencord restores the original archive byte for byte. The app refuses to patch while `dist/patcher.js` is missing, so Discord can never end up in a state where it does not start.

Custom plugins live in `src/userplugins` of your Vencord clone. Disabled plugins are moved to `src/userplugins/.disabled`, which the Vencord build ignores. For every plugin installed from a link, the source URL, branch, path and Git object id are stored, which is what makes precise update checks possible.

## Development

Requirements: Node.js 22.12+ and npm.

```bash
npm install
npm run dev          # start the app with hot reload
npm run verify       # lint + typecheck + tests + production build
npm run dist:win     # build installers for Windows  (release/)
npm run dist:mac     # build the DMG – must run on macOS
```

| Script                            | Purpose                                                                 |
| --------------------------------- | ----------------------------------------------------------------------- |
| `npm run lint` / `npm run format` | Check / fix formatting and lint rules with [Biome](https://biomejs.dev) |
| `npm run typecheck`               | Type-check main, preload and renderer                                   |
| `npm test`                        | Run the unit tests with [Vitest](https://vitest.dev)                    |

### Project structure

```
src/
├─ main/                 Electron main process
│  ├─ core/              config, logging, processes, tasks, PATH and tool detection
│  ├─ discord/           asar format, patching, Discord detection & process control
│  ├─ vencord/           clone, dependencies, build and updates of the source tree
│  ├─ plugins/           link parsing, detection, staging, library and updater
│  ├─ ipc.ts             typed IPC handlers
│  └─ workflows.ts       multi-step tasks shown in the UI
├─ preload/              context-isolated bridge (window.vu)
├─ renderer/             React UI
└─ shared/               types and the IPC contract shared by all processes
```

Pure logic (asar format, patching, link parsing, plugin detection, hashing) has no Electron dependency and is covered by unit tests next to the source files.

### Releasing

1. Bump `version` in `package.json` and add a matching section to `CHANGELOG.md`.
2. Push a tag: `git tag v0.2.0 && git push origin v0.2.0`.
3. The [release workflow](.github/workflows/release.yml) builds Windows and macOS packages and publishes a GitHub release with the changelog section as release notes.

## License

[GPL-3.0-or-later](LICENSE). Vencord itself is made by Vendicated and contributors and is licensed under the GPL-3.0 as well.
