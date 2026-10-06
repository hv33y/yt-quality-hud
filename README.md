# YouTube Quality HUD

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

A lightweight userscript that shows live playback resolution and the video's native upload quality right next to the Subscribe button, with a one-click quality switcher.

## What you get

- **Active quality**: the resolution and frame rate currently being rendered (e.g. `1080p 60fps`)
- **Max quality**: the highest encoded tier the creator uploaded (e.g. `4K 60fps`)
- **Quality switcher**: a button next to the badge that lists every available quality from the player and switches with one click

No need to open Stats for Nerds or dig through the settings gear menu anymore.

## Features

- Automatic resolution labeling (4K, 1440p, 1080p, 720p, 480p)
- Live frame rate detection from player stats
- Updates instantly when the stream resizes or you change quality
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

The HUD hides itself on non-video pages and reattaches as you navigate.

## How it works

- **Active playback**: reads the dimensions of the active HTML5 `<video>` element and the frame rate from the player's Stats for Nerds data
- **Max resolution**: parses `streamingData.adaptiveFormats` from the player response, filters video streams, and sorts by total pixel area (breaking ties by frame rate) to find the upload ceiling
- **Quality switcher**: uses the player's `getAvailableQualityLevels()` and `setPlaybackQualityRange()` APIs

## Author

* GitHub: [hv33y](https://github.com/hv33y)
* Website: [harrykauhaad.com](https://harrykauhaad.com)

## License

This project is licensed under the [MIT License](LICENSE).
