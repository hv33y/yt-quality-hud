# YouTube Quality HUD

A lightweight userscript that injects active playback resolution and native upload master quality directly beside the YouTube Subscribe button.

## Overview

YouTube dynamically scales video playback depending on viewport size, network conditions, and player settings. Determining whether you are viewing the video at its native uploaded quality or a downscaled version normally requires opening Stats for Nerds.

This script hooks into YouTube's player instance and streaming formats to display two clear metrics:
* **Active Quality:** The current rendered stream resolution and frame rate.
* **Maximum Quality:** The highest available encoded tier uploaded by the creator.

Values update dynamically whenever quality is adjusted via the settings menu.

## Features

* Automatic resolution labeling (4K, 1440p, 1080p, 720p).
* Live frame rate detection.
* Immediate update on stream resize without requiring a page refresh.
* Native YouTube button styling.
* Zero external libraries or runtime dependencies.

## Installation

1. Install a userscript extension such as [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Open your extension dashboard and create a new script.
3. Paste the contents of [`youtube-quality-hud.user.js`](https://github.com/hv33y/yt-quality-hud/raw/refs/heads/master/youtube-quality-hud.user.js).
4. Save the file and visit any video on YouTube.

## How It Works

* **Active Playback:** Inspects the active HTML5 video element dimensions alongside the player runtime stats to calculate real-time decoding targets.
* **Max Resolution:** Parses the manifest streams in `streamingData.adaptiveFormats`, selects video feeds, and sorts by total pixel surface area to extract the upload ceiling.

## Author

* GitHub: [hv33y](https://github.com/hv33y)
* Website: [harrykauhaad.com](https://harrykauhaad.com)

## License

This project is licensed under the [MIT License](LICENSE).
