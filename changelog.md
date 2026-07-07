# Changelog

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
