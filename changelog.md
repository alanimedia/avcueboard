# Changelog

## 1.5.3

### Added
- Collapsible **cue sections** on Electron and web remote with v2 workspace layout (`sections` + `layout` in `cues.json`)
- Section drag reorder in edit mode (all cues in a section move together); full header click to expand/collapse
- Multi-select cues in edit mode (Ctrl/Cmd+click, Ctrl/Cmd+A) with bulk delete via toolbar or Delete/Backspace
- Multi-select drag: moving one selected cue moves the whole selection between sections
- Drag existing cues and new file drops into specific sections (Electron + remote)
- `cueGridSections.js` and `cueLayoutUtils.js` for section UI and layout repair/migration

### Changed
- Section headers use a single light grey bar (no separate dark divider line); styling matched on Electron and remote
- Section titles editable only in persisted edit mode (not show/playback mode)
- Remote `reorder_cues` accepts `layout` payloads; reorder buttons bind after DOM insert

### Fixed
- Electron grid blank after sections refactor (duplicate exports / syntax error in `cueGrid.js`)
- Adding cues to a section no longer collapses layout to a single "Cues" section (broadcast full workspace snapshot)
- Global file drop handler no longer intercepts in-grid cue drags
- Remote invalid reorder request when saving section layout from web UI

## 1.5.2

### Added
- Remote **Playback / Edit** mode toggle with per-cue editing (name, volume, color, reorder) and global settings panel
- WebSocket write actions from remote clients: `update_cue`, `reorder_cues`, `update_config`, `get_cue_detail`, `delete_cue`
- `remoteEditUtils.js` for patch sanitization, cue merge, and config snapshots
- Touch-friendly reorder on iPad: ◀ ▶ buttons, long-press drag, per-card settings cog
- Live volume meter beside playing cues on remote (matches Electron cue grid)
- Volume percentage on remote waveform lane headers during playback

### Changed
- Remote waveform panel uses a thin drag handle for resize (removed +/− size buttons)
- Remote edit cards use a two-row volume layout to prevent text overflow on narrow screens
- Waveform lane rendering caches static bars and redraws only the playhead to reduce flicker

### Fixed
- Multi-cue remote waveform panel flashing on desktop from scrollbar/layout feedback loops
- iOS Safari viewport clipping for bottom waveform panel (`100dvh`, safe-area insets)
- Remote cue saves now merge patches before write (prevents full cue replacement data loss)

## 1.5.1

### Added
- Waveform playhead sync during playback in properties sidebar, expanded editor, and remote UI
- Resizable main waveform panel below cue grid with stacked lanes for simultaneous playback (WAVE toolbar toggle)
- Shared waveform peaks service and HTTP API for remote clients (`/api/cues/:cueId/waveform-peaks`)
- Mini waveform strips on cue buttons (Electron grid and remote) with playhead progress
- Global default **Show waveform on cue buttons** in App Config → Main Display
- Per-cue button waveform override: Use app default / Always show / Always hide
- Remote cue payload improvements: `buttonColor`, trim times, progress ratios, and formatted cue broadcasts

### Changed
- Remote Web UI uses bottom multi-lane waveform panel matching Electron main UI
- Cue save broadcasts enriched remote-formatted cue data instead of raw cue objects

### Fixed
- Cue grid failed to render after waveform config helper refactor (`isInitialized` regression)
- Main-process crash when syncing button waveform fields to remote (`appConfigManager` scope)
- Config save loop when applying app configuration updates

## 1.5.0

### Added
- Per-cue button color with `buttonColor` field persisted in cue data
- Color picker in cue properties: preview box (opens custom picker), 8 neon preset swatches, and 8 recent custom colors
- Automatic text contrast on custom-colored cue buttons (black text on bright backgrounds via WCAG luminance threshold 0.5)
- `recentButtonColors` in app config to remember recently used custom colors across sessions

### Changed
- Properties sidebar scrolls correctly so lower fields are no longer cut off
- Selecting a recent custom color moves it to the front of the recents list
