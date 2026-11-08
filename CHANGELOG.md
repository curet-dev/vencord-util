# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## 0.2.0 – 2026-11-08

### Added

- **App updates:** Vencord Util checks for a new release on every start and shows what changed. The update is downloaded, verified (SHA-512) and installed in place – the Windows installer runs silently, the portable version is replaced by the new file, on macOS the disk image is opened. Releases can set a `minimumVersion`; older versions then have to update before they can be used.
- **Compatibility check for plugins:** before a Vencord update, the plugins' imports are compared with the new Vencord version. Plugins that use removed functions (for example `Toasts` or `HeadingSecondary`) are listed, and updating asks for confirmation. Plugins that do not fit the installed version are flagged on the overview and the plugin list, and right after installing them.
- **Link existing plugins to Git:** plugins that were copied in by hand can be linked to their repository (or a single file). The local copy is compared with the remote one, so the plugin shows up as up to date or as "update available".
- When a build fails because of a plugin, the error names the plugin and the reason, and offers to disable it and rebuild. The plugin list marks plugins that broke the last build.

### Changed

- Smaller downloads: separate Windows installers per architecture (no more combined ~240 MB installer), separate macOS images for Apple Silicon and Intel instead of a universal image, only English and German Chromium locales and maximum compression.
- Plugins installed from a repository sub-folder with a generic name such as `src` get a folder named after the plugin instead.
- Failed commands no longer print their output twice.

## 0.1.0 – 2026-11-07

The first public release of Vencord Util.

### Vencord from source

- One-click setup: clone, `pnpm install --frozen-lockfile`, `pnpm build` and inject into Discord – or run every step on its own.
- Detects and removes the official Vencord installation. Settings, themes and QuickCSS are kept.
- Adopts an existing source clone (for example one set up with `pnpm inject`) automatically.
- Update check with commit list, one-click update (`git pull` → dependencies → build) and an option to stash local changes first.
- Optional developer builds (`pnpm build --dev`) and automatic Discord restarts after building.

### Custom plugins

- Install from a GitHub repository, a folder link (`/tree/<branch>/<path>`), a single file, a gist, a ZIP link or any other Git host.
- Drag & drop folders, `.ts`/`.tsx` files, `.zip` archives or links from the browser.
- Repositories containing several plugins – or plugins nested in sub-folders – are detected and offered in a selection dialog.
- Plugin updater: compares the exact Git object of every plugin with GitHub (one API request per repository), so only plugins that actually changed are flagged.
- Enable, disable, update and delete plugins; disabled plugins are excluded from the build.

### Discord

- Detects Discord Stable, PTB, Canary and Development on Windows and macOS.
- Patches exactly like the official Vencord installer and restores the original `app.asar` byte for byte when removing Vencord.

### Requirements

- Checks Git, Node.js and pnpm and installs missing tools via winget (Windows) or Homebrew (macOS).
- Replaces a missing or broken pnpm with an app-local copy – no admin rights required.
