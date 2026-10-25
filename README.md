# YouTube Quality HUD

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

A lightweight userscript that shows live playback resolution and the video's native upload quality right next to the Subscribe button, with one-click quality and FPS switchers.

## What you get

- **Active quality**: the resolution and frame rate currently being rendered (e.g. `1080p 60fps`)
- **Max quality**: the highest encoded tier the creator uploaded (e.g. `4K 60fps`)
- **Quality switcher**: a button next to the badge that lists every available quality from the player and switches with one click
- **FPS switcher**: a third button that locks playback to Auto, 23, 24, 30, 50, or 60 fps

No need to open Stats for Nerds or dig through the settings gear menu anymore.

## Features

- Automatic resolution labeling (4K, 1440p, 1080p, 720p, 480p, and below; 8K and 5K in the quality menu)
- Live frame rate detection from player stats
- Updates instantly when the stream resizes or you change quality
- FPS control that actually switches streams, not just relabels them (see [How the FPS switcher works](#how-the-fps-switcher-works))
- Honest FPS labels: options that would drop your resolution say so before you click
- A manual quality choice always wins over an FPS lock
- Native YouTube pill styling, works in light and dark mode
- Zero external libraries or dependencies

## Installation

1. Install a userscript manager: [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/)
2. Create a new script in the dashboard
3. Paste the contents of [`youtube-quality-hud.user.js`](https://github.com/hv33y/yt-quality-hud/raw/refs/heads/master/youtube-quality-hud.user.js)
4. Save, then open any YouTube video

## Usage

Look to the right of the Subscribe button under any video:

- The first pill reads like `1080p 60fps / Max: 4K 60fps`
- The second pill shows the current quality setting, click it to pick a different one (Auto included)
- The third pill shows the FPS setting, click it to pick Auto, 23, 24, 30, 50, or 60 fps

The HUD hides itself on non-video pages and reattaches as you navigate. The FPS lock resets when you open a new video, so a lock from one video never silently carries over to the next.

## How it works

- **Active playback**: reads the dimensions of the active HTML5 `<video>` element and the frame rate from the player's Stats for Nerds data
- **Max resolution**: parses `streamingData.adaptiveFormats` from the player response, filters video streams, and sorts by total pixel area (breaking ties by frame rate) to find the upload ceiling. When formats are hidden (e.g. SABR streaming), it falls back to the quality levels the player reports
- **Quality switcher**: uses the player's `getAvailableQualityLevels()` and `setPlaybackQualityRange()` APIs

## How the FPS switcher works

YouTube's quality API only takes a resolution (`hd1080`, `hd720`, …) — it has no FPS parameter, so calling it alone won't reliably turn a 60fps stream into a 30fps one. The FPS switcher therefore does what you would do by hand: it opens the player's own Settings > Quality menu and clicks the FPS-specific entry (`1080p60`, `720p50`, …), which switches the actual stream while keeping your playback position. If that menu is unavailable, it falls back to the player API for the matching height.

After switching, it verifies against the real active frame rate, retries once if it didn't change, and drops the lock back to Auto if the FPS still isn't playing — so the button never claims a frame rate you're not getting.

### FPS, honestly

These are YouTube's limits, not the script's, and the menu is built to show them upfront:

- **For videos uploaded at 60fps, YouTube does not encode an HD 30fps stream.** Its menu is typically `2160p60, 1440p60, 1080p60, 720p60`, then plain `480p` and below. Picking 30fps on such a video therefore has to drop to the highest height that actually has a 30fps stream — usually 480p. The menu labels that before you click (`30 fps · ↓480p`), and the button shows it while you're dropped (`FPS: 30 ↓480p`).
- **A format list is not the menu.** A video can have a 720p30 format hidden behind a 720p60 menu entry. The menu groups formats by height and takes the highest FPS per height, so only the menu entry counts — and that's what the label is predicted from. If the height can't be predicted, it shows `↓ lower res` with no number, rather than guessing one.
- **23 and 24fps share a stream.** 23.976fps cinema content is reported by YouTube as 24 in most places, so both options are listed but may land on the same stream.
- **Unavailable at this height shows as `n/a at 1440p`** (or whatever you're playing at), instead of silently switching you somewhere else.
- **Manual quality always wins.** Changing quality clears an FPS lock unless that FPS fits the new height exactly — picking 144p with an FPS:60 lock on will not drag you back up to 4K a few seconds later. Going back to 60fps or Auto after a drop restores the height you came from, not the video's maximum.
- **Premium entries are only clicked for Premium users.** `1080p Premium / Enhanced bitrate` is a paid bitrate tier, not a different FPS or resolution — the regular `1080p` entry at the same height gives you the exact FPS you asked for. Clicking Premium as a non-Premium user just opens YouTube's Premium upsell popup instead of switching streams, so the switcher prefers the regular entry, and if only Premium matches, it doesn't click it at all. If you *are* Premium, the switcher bumps you up to the Premium entry at the same height/fps instead — it detects that from a currently selected Premium row (only a Premium user can actually be playing one) and remembers it, and the FPS menu has a `Premium: Auto / On / Off` row if detection ever misses you and you want to force it on (or force regular).

## Author

* GitHub: [hv33y](https://github.com/hv33y)
* Website: [harrykauhaad.com](https://harrykauhaad.com)

## License

This project is licensed under the [MIT License](LICENSE).
