// ==UserScript==
// @name         YouTube Resolution & FPS Badge (Current & Max) + Quality & FPS Switcher
// @namespace    https://github.com/hv33y
// @version      1.4
// @description  Displays both active playback and maximum original resolution/fps next to the Subscribe button, plus one-click quality and FPS changers (Auto, 23, 24, 30, 50, 60 fps) where a manual quality choice always wins over an FPS lock
// @author       github.com/hv33y
// @match        https://www.youtube.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const WRAP_ID = 'yt-dual-res-wrap';
  const BADGE_ID = 'yt-dual-res-badge';
  const QBTN_ID = 'yt-dual-res-qbtn';
  const QLABEL_ID = 'yt-dual-res-qlabel';
  const MENU_ID = 'yt-dual-res-qmenu';
  const FBTN_ID = 'yt-dual-res-fbtn';
  const FLABEL_ID = 'yt-dual-res-flabel';
  const FMENU_ID = 'yt-dual-res-fmenu';

  let lastAnchorMode = 'none';
  let lastDebug = '';
  let lastTheme = null;
  let noAnchorTicks = 0;

  // FPS lock state. null = Auto (no fps forced). Reset per video, so a lock
  // chosen for one video never silently downgrades the next one.
  let fpsTarget = null;
  let fpsVideoId = null;
  // Height the user was at before an fps choice dropped the resolution
  // (e.g. 1080p60 -> 480p30). Used to restore that height when they go
  // back to 60fps / Auto, instead of jumping to the video's max.
  let fpsDropFromHeight = null;
  let fpsApplying = false;
  let fpsApplyAttempts = 0;
  let fpsLastApplyAt = 0;
  // Height a verified fps lock is actually playing at. If the playing
  // height later changes to something else (manual quality change, or
  // YouTube adapting), that change wins and the lock is cleared -
  // otherwise a stale lock would keep dragging the video back to 4K.
  let fpsLockedHeight = null;

  function isDarkTheme() {
    const html = document.documentElement;
    if (html.hasAttribute('dark') || html.getAttribute('data-theme') === 'dark') return true;
    // Fall back to the page's actual background luminance
    const m = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g);
    if (m && m.length >= 3) {
      const lum = (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]);
      const alpha = m.length > 3 ? parseFloat(m[3]) : 1;
      if (alpha > 0) return lum < 128;
    }
    return false;
  }

  // Dark mode keeps the original look; light mode gets readable colours
  function applyTheme() {
    const dark = isDarkTheme();
    const bg = dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)';
    const fg = dark ? '#fff' : '#0f0f0f';
    [BADGE_ID, QBTN_ID, FBTN_ID].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.style.backgroundColor !== bg) el.style.backgroundColor = bg;
      if (el.style.color !== fg) el.style.color = fg;
    });
    return dark;
  }


  console.log('[YT-HUD v1.4] script loaded');

  function formatQuality(height, fps) {
    if (!height) return '...';

    let resName = `${height}p`;
    if (height >= 2160) {
      resName = '4K';
    } else if (height >= 1440) {
      resName = '1440p';
    } else if (height >= 1080) {
      resName = '1080p';
    } else if (height >= 720) {
      resName = '720p';
    } else if (height >= 480) {
      resName = '480p';
    }

    const fpsName = fps ? ` ${fps}fps` : '';
    return `${resName}${fpsName}`;
  }

  function getMoviePlayer() {
    // Prefer the watch-page player; fall back to any HTML5 player element
    const mp = document.getElementById('movie_player');
    if (mp && typeof mp.getPlayerResponse === 'function') return mp;
    const alt = document.querySelector('.html5-video-player');
    return alt || mp;
  }

  function getPlayerResponseSafe() {
    const mp = getMoviePlayer();
    if (mp && typeof mp.getPlayerResponse === 'function') {
      try {
        const resp = mp.getPlayerResponse();
        if (resp) return resp;
      } catch (e) { /* ignore */ }
    }
    return window.ytInitialPlayerResponse || null;
  }

  function getVideoFormats() {
    const resp = getPlayerResponseSafe();
    let formats = resp?.streamingData?.adaptiveFormats || [];

    // ytInitialPlayerResponse can be stale after SPA navigation, but is a
    // better-than-nothing fallback when the player response has no formats
    if (!formats.length && window.ytInitialPlayerResponse) {
      formats = window.ytInitialPlayerResponse?.streamingData?.adaptiveFormats || [];
    }

    return formats.filter(f => f.width && f.height && (f.mimeType ? f.mimeType.includes('video') : true));
  }

  const LEVEL_HEIGHTS = {
    highres: 4320,
    hd2880: 2880,
    hd2160: 2160,
    hd1440: 1440,
    hd1080: 1080,
    hd720: 720,
    large: 480,
    medium: 360,
    small: 240,
    tiny: 144
  };

  function getMaxSpecs() {
    const videoStreams = getVideoFormats();

    if (videoStreams.length) {
      videoStreams.sort((a, b) => {
        const areaA = a.width * a.height;
        const areaB = b.width * b.height;
        if (areaB !== areaA) return areaB - areaA;
        return (b.fps || 0) - (a.fps || 0);
      });

      const best = videoStreams[0];
      return {
        width: best.width,
        height: best.height,
        fps: best.fps || 30
      };
    }

    // Fallback: formats are hidden (e.g. SABR streaming), so derive the
    // ceiling from the quality levels the player reports
    const mp = getMoviePlayer();
    if (mp && typeof mp.getAvailableQualityLevels === 'function') {
      try {
        const levels = mp.getAvailableQualityLevels() || [];
        let maxH = 0;
        levels.forEach(l => {
          if (LEVEL_HEIGHTS[l] && LEVEL_HEIGHTS[l] > maxH) maxH = LEVEL_HEIGHTS[l];
        });
        if (maxH) return { width: 0, height: maxH, fps: null };
      } catch (e) { /* ignore */ }
    }

    return null;
  }

  function getActiveSpecs() {
    const moviePlayer = getMoviePlayer();
    const video = document.querySelector('#movie_player video, video.html5-main-video, video');

    if (!video || !video.videoWidth || !video.videoHeight) {
      return null;
    }

    let fps = null;
    if (moviePlayer && typeof moviePlayer.getStatsForNerds === 'function') {
      try {
        const stats = moviePlayer.getStatsForNerds();
        const text = [stats?.resolution, stats?.currentResolution, stats?.optimalResolution]
          .filter(Boolean)
          .join(' ');
        const match = text.match(/@\s*(\d+)/);
        if (match) fps = parseInt(match[1], 10);
      } catch (e) { /* ignore */ }
    }

    // Fallback: use the highest fps encoded at the currently playing height
    if (!fps) {
      const sameHeight = getVideoFormats().filter(f => f.height === video.videoHeight && f.fps);
      if (sameHeight.length) fps = Math.max(...sameHeight.map(f => f.fps));
    }

    return {
      width: video.videoWidth,
      height: video.videoHeight,
      fps: fps || 30
    };
  }

  const QUALITY_LABELS = {
    highres: '8K',
    hd2880: '5K',
    hd2160: '4K',
    hd1440: '1440p',
    hd1080: '1080p',
    hd720: '720p',
    large: '480p',
    medium: '360p',
    small: '240p',
    tiny: '144p',
    auto: 'Auto'
  };

  function qualityLabel(level) {
    return QUALITY_LABELS[level] || level || 'Quality';
  }

  function closeMenu() {
    const menu = document.getElementById(MENU_ID);
    if (menu) menu.remove();
    const fmenu = document.getElementById(FMENU_ID);
    if (fmenu) fmenu.remove();
  }

  function setQuality(level) {
    const mp = getMoviePlayer();
    if (!mp) return;
    try {
      if (typeof mp.setPlaybackQualityRange === 'function') {
        if (level === 'auto') {
          mp.setPlaybackQualityRange('tiny', 'highres');
        } else {
          mp.setPlaybackQualityRange(level, level);
        }
      }
      if (typeof mp.setPlaybackQuality === 'function') {
        mp.setPlaybackQuality(level);
      }
    } catch (e) { /* player busy, ignore */ }
    closeMenu();
    setTimeout(updateBadge, 500);
    setTimeout(updateBadge, 1500);
    // v1.6: a manual quality choice ALWAYS wins over an fps lock.
    // v1.5 re-applied the lock after every quality change, so picking
    // 144p with an FPS:60 lock on would, 2 seconds later, re-apply
    // 60fps at the highest height that offers it - i.e. back to 4K.
    // That is the auto-upgrade the user reported. Now: the lock only
    // survives if it fits the new height exactly (same-height re-apply,
    // never an upgrade or a drop). Otherwise it is cleared immediately,
    // so nothing can fire later and drag the video back up.
    if (fpsTarget != null) {
      const newHeight = level === 'auto' ? null : (LEVEL_HEIGHTS[level] || null);
      const survives = newHeight != null && predictFpsHeight(fpsTarget, newHeight) === newHeight;
      if (survives) {
        setTimeout(() => { if (fpsTarget != null) applyFps(fpsTarget, 0, false); }, 2000);
      } else {
        console.log('[YT-HUD v1.6] manual quality wins, fps lock cleared', JSON.stringify({ level, newHeight, fpsTarget }));
        fpsTarget = null;
        fpsDropFromHeight = null;
        fpsLockedHeight = null;
        setTimeout(updateBadge, 2100);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // FPS controller
  //
  // Why this is not just setPlaybackQuality(): that API only takes a
  // resolution level (hd1080, hd720, ...). It has no fps parameter, so
  // calling it for "1080p" on a 60fps video does NOT reliably give you
  // 30fps. YouTube's own Settings > Quality menu is the one place that
  // distinguishes fps: it lists "1080p60", "1080p50", "720p60" etc. next
  // to the plain "1080p" / "720p" entries. Clicking that menu entry is
  // exactly what YouTube does when you pick it by hand, so it switches
  // the actual stream (keeping the current playback position) instead
  // of just relabelling something. This is also the technique used by
  // the "YouTube Auto HD + FPS" extension.
  //
  // YouTube limitation that shapes this whole controller: for a video
  // uploaded at 60fps, YouTube does NOT encode a 1080p30 / 4K30 stream.
  // Its menu is typically 2160p60, 1440p60, 1080p60, 720p60, then plain
  // 480p, 360p, 240p - and Google's own help says exactly that: to watch
  // at a lower frame rate, switch to 480p or lower. So "30fps" on such a
  // video cannot mean "same height, fewer frames" inside YouTube's
  // player; it means dropping to the highest height that has a 30fps
  // stream. v1.3 did that silently, which is why it felt broken even
  // though it was technically correct. v1.4 therefore never drops
  // silently: the menu labels the drop ("30 fps · ↓480p") before you
  // click, and going back to 60fps/Auto restores the height you came
  // from instead of jumping to max.
  //
  // v1.5 fix for the label: the drop height must be predicted from
  // YouTube's menu, not from any format with that fps. A 720p30 format
  // hidden behind a 720p60 menu entry is not selectable, so v1.4's
  // "↓720p" label was wrong when the click landed on 480p. The menu
  // now groups formats by height and takes the max fps per height -
  // exactly what the native menu shows - and if that prediction is
  // impossible it shows "↓ lower res" with no number, never a guess.
  //
  // v1.6 rule, learned the hard way: a manual quality choice always
  // wins over an fps lock. v1.5 re-applied the lock after any quality
  // change, so 144p + FPS:60 became 4K60 two seconds later. Now a
  // quality change only keeps a lock that fits the new height exactly
  // (same-height re-apply), otherwise the lock is cleared on the spot,
  // and a watchdog in updateBadge clears a stale lock if the playing
  // height changes outside the HUD too. Nothing in this script ever
  // re-applies a lock by raising the resolution on its own.
  //
  // Flow for a chosen fps:
  //   1. Open the player's Settings menu, open Quality, scan its entries.
  //   2. Click the best entry for that fps (same height first, then the
  //      height you came from, then the highest height that offers it).
  //   3. If the native menu is unavailable, fall back to the player API
  //      for the matching height.
  //   4. Verify against the real active fps (Stats for nerds / video
  //      element) a couple of seconds later. If it did not change and
  //      the fps is actually offered, retry once; otherwise drop the
  //      lock so the button never pretends a fps it is not playing.
  // ---------------------------------------------------------------------------

  const FPS_OPTIONS = [23, 24, 30, 50, 60];

  // 23.976fps cinema content is reported by YouTube as 24 in most places,
  // and there is no separate 23fps stream for it. Treat 23/24 as one
  // "cinema" bucket for matching/availability, but keep both menu items
  // because the user asked for both.
  function fpsMatches(actual, target) {
    if (actual == null || target == null) return false;
    if (actual === target) return true;
    const cinema = [23, 24];
    return cinema.includes(actual) && cinema.includes(target);
  }

  function getCurrentVideoId() {
    const mp = getMoviePlayer();
    if (mp && typeof mp.getVideoData === 'function') {
      try {
        const id = mp.getVideoData()?.video_id;
        if (id) return id;
      } catch (e) { /* ignore */ }
    }
    try {
      const v = new URLSearchParams(window.location.search).get('v');
      if (v) return v;
    } catch (e) { /* ignore */ }
    return window.location.pathname;
  }

  function getAvailableFps() {
    const fpsSet = new Set();
    getVideoFormats().forEach(f => { if (f.fps) fpsSet.add(f.fps); });
    return [...fpsSet].sort((a, b) => a - b);
  }

  function fpsIsOffered(target) {
    const offered = getAvailableFps();
    // Unknown (SABR streams hide formats): don't grey anything out, let
    // the native menu decide at apply time.
    if (!offered.length) return true;
    return offered.some(f => fpsMatches(f, target));
  }

  // Is `target` offered at exactly `height`, from the format list?
  // Returns null when formats are hidden (unknown), false when the
  // height has formats but none at that fps. A plain native label at a
  // height is just that height's non-HFR format, so an explicit fps
  // match is the right test here - the plain-label fallback in
  // pickNativeFpsRow only applies when formats are hidden.
  function fpsAtHeight(target, height) {
    const formats = getVideoFormats();
    if (!formats.length) return null;
    const atHeight = formats.filter(f => f.height === height);
    if (!atHeight.length) return false;
    if (atHeight.some(f => f.fps && fpsMatches(f.fps, target))) return true;
    if (atHeight.some(f => !f.fps)) return null;
    return false;
  }

  // Highest height that offers `target` fps, or null if none / unknown.
  // NOTE: this is deliberately NOT used for the menu label anymore.
  // v1.4 used it, and it lied: a video can have a 720p30 format in its
  // format list while YouTube's menu only shows 720p60 for that height,
  // so the label said "↓720p" and the actual click landed on 480p.
  function highestHeightForFps(target) {
    const formats = getVideoFormats().filter(f => f.fps && fpsMatches(f.fps, target));
    if (!formats.length) return null;
    return Math.max(...formats.map(f => f.height));
  }

  // The player's own quality data, when it exposes it: entries with
  // qualityLabel like "1440p60", "480p", "Auto". These are exactly the
  // entries YouTube's native menu shows, so they are the best source
  // for predicting what a click will actually do. Returns [] when the
  // player does not expose this (then we fall back, honestly, to a
  // generic warning instead of a guessed number).
  function getQualityDataEntries() {
    const mp = getMoviePlayer();
    if (!mp || typeof mp.getAvailableQualityData !== 'function') return [];
    try {
      const data = mp.getAvailableQualityData() || [];
      return data.map(d => {
        const parsed = parseNativeQualityLabel(d.qualityLabel || d.label || '');
        return parsed && parsed.height != null ? parsed : null;
      }).filter(Boolean);
    } catch (e) { return []; }
  }

  // Menu-equivalent fps per height, derived from formats: YouTube's
  // menu shows ONE entry per height - the highest fps format at that
  // height, labelled with its fps if it is HFR, plain otherwise. So a
  // 720p30 format hidden behind a 720p60 format at the same height is
  // NOT a selectable 720p30 entry, and must not be used for the label.
  // Returns a Map height -> max fps (or null when fps is unknown).
  function getMenuFpsByHeight() {
    const byHeight = new Map();
    getVideoFormats().forEach(f => {
      if (!f.height) return;
      const prev = byHeight.get(f.height);
      if (f.fps && (!prev || f.fps > prev)) byHeight.set(f.height, f.fps);
      else if (!byHeight.has(f.height)) byHeight.set(f.height, null);
    });
    return byHeight;
  }

  // Height that picking `target` will actually land on, using the same
  // scoring as pickNativeFpsRow, but on a predicted menu instead of
  // the live native menu. Returns null when no prediction is possible
  // (no quality data and no formats) - the caller must then NOT claim
  // a specific height. Returns undefined when prediction says the fps
  // is not selectable at all.
  function predictFpsHeight(target, preferredHeight) {
    // Effective fps per height: from formats, this is the max fps at
    // that height (the menu entry for that height). From quality data
    // alone, only exact-suffix entries have a known fps; plain entries
    // are unknown and must not be guessed at.
    const byHeight = getMenuFpsByHeight();
    let effective = null;
    if (byHeight.size) {
      effective = byHeight;
    } else {
      const qd = getQualityDataEntries();
      if (!qd.length) return null;
      effective = new Map();
      qd.forEach(e => { if (e.fps) effective.set(e.height, e.fps); });
      if (!effective.size) return null;
    }
    const candidates = [...effective.entries()]
      .filter(([, maxFps]) => maxFps && fpsMatches(maxFps, target))
      .map(([h]) => h);
    if (!candidates.length) {
      // Unknown plain entries could still be this fps, but claiming
      // n/a would be a guess too - return null only when there are
      // plain entries we could not resolve; otherwise it is truly n/a.
      const hasUnknown = byHeight.size
        ? [...byHeight.values()].some(v => v == null)
        : getQualityDataEntries().some(e => !e.fps);
      return hasUnknown ? null : undefined;
    }
    if (candidates.includes(preferredHeight)) return preferredHeight;
    if (candidates.includes(fpsDropFromHeight)) return fpsDropFromHeight;
    return Math.max(...candidates);
  }

  function levelForHeight(height) {
    for (const [level, h] of Object.entries(LEVEL_HEIGHTS)) {
      if (h === height) return level;
    }
    return null;
  }

  // Best format for a fps: same height first, then the height you came
  // from before a drop, then the highest height with it. When
  // allowHeightChange is false (re-applying after a manual quality
  // change), ONLY the same height is allowed - returning a higher
  // height here is exactly the 144p -> 4K auto-upgrade bug.
  function formatForFps(target, preferredHeight, allowHeightChange = true) {
    const formats = getVideoFormats().filter(f => f.fps && fpsMatches(f.fps, target));
    if (!formats.length) return null;
    const pickAt = (height) => {
      const at = formats.filter(f => f.height === height);
      if (!at.length) return null;
      at.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      return at[0];
    };
    const same = pickAt(preferredHeight);
    if (same || !allowHeightChange) return same;
    return pickAt(fpsDropFromHeight) || (() => {
      formats.sort((a, b) => (b.height - a.height) || ((b.bitrate || 0) - (a.bitrate || 0)));
      return formats[0];
    })();
  }

  function fpsLabel(target) {
    return target == null ? 'FPS: Auto' : `FPS: ${target}`;
  }

  // Parse a native quality label: "1080p60", "1080p60 Premium",
  // "720s50" (360 video), "1080p", "Auto". Plain (no fps suffix) means
  // the non-HFR stream at that height, usually 30fps (or the video's
  // native fps when no HFR variant exists).
  function parseNativeQualityLabel(text) {
    if (!text) return null;
    const t = text.trim();
    if (/^auto/i.test(t)) return { height: null, fps: null, isAuto: true, text: t };
    const m = t.match(/(\d+)[ps](\d+)?/i);
    if (!m) return null;
    return { height: parseInt(m[1], 10), fps: m[2] ? parseInt(m[2], 10) : null, isAuto: false, text: t };
  }

  function waitFor(fn, timeoutMs, intervalMs) {
    return new Promise(resolve => {
      const start = Date.now();
      const tick = () => {
        let result = null;
        try { result = fn(); } catch (e) { /* ignore */ }
        if (result) return resolve(result);
        if (Date.now() - start >= timeoutMs) return resolve(null);
        setTimeout(tick, intervalMs || 100);
      };
      tick();
    });
  }

  function isVisible(el) {
    return !!(el && el.offsetParent !== null);
  }

  function nativeSettingsMenu() {
    const menu = document.querySelector('#movie_player .ytp-settings-menu, .ytp-settings-menu');
    return menu && isVisible(menu) ? menu : null;
  }

  function nativeSettingsButton() {
    return document.querySelector('#movie_player .ytp-settings-button, .ytp-settings-button');
  }

  async function closeNativeMenu() {
    if (!nativeSettingsMenu()) return;
    const btn = nativeSettingsButton();
    if (btn) btn.click();
    await waitFor(() => !nativeSettingsMenu(), 800, 100);
  }

  // Opens Settings > Quality and returns its menu items, or null.
  async function openNativeQualityMenu() {
    const btn = nativeSettingsButton();
    if (!btn) return null;

    // Start from a known state: if a settings menu is already open, close it.
    await closeNativeMenu();

    btn.click();
    const menu = await waitFor(() => nativeSettingsMenu(), 1500, 100);
    if (!menu) return null;

    // Find the "Quality" row. English label is the common case; the row's
    // content also shows the current quality (e.g. "1080p60"), so a row
    // whose label is not Speed/Subtitles/etc. is not guessed at here -
    // if Quality is not found we bail to the API fallback instead of
    // clicking the wrong row.
    const items = [...menu.querySelectorAll('.ytp-menuitem')];
    const qualityRow = items.find(item => {
      const label = item.querySelector('.ytp-menuitem-label');
      const text = (label ? label.textContent : item.textContent || '').trim();
      return /^quality$/i.test(text);
    });
    if (!qualityRow) { await closeNativeMenu(); return null; }

    qualityRow.click();
    // After clicking Quality, the menu repopulates with quality entries.
    const qualityItems = await waitFor(() => {
      const m = nativeSettingsMenu();
      if (!m) return null;
      const rows = [...m.querySelectorAll('.ytp-menuitem')];
      const parsed = rows.map(row => {
        const label = row.querySelector('.ytp-menuitem-label');
        const text = (label ? label.textContent : row.textContent || '').trim();
        return { row, parsed: parseNativeQualityLabel(text), text };
      }).filter(x => x.parsed);
      return parsed.length ? parsed : null;
    }, 1500, 100);
    return qualityItems;
  }

  // Pick the native menu row for `target` fps. Priority:
  //   1. same height, exact fps suffix (1080p60)
  //   2. same height, plain label - only when that plain label really is
  //      the target fps (30, or a cinema fps with no 30/60 variant there)
  //   3. any height, exact fps suffix, highest height first
  //   4. any height, plain label, same rule as (2)
  function pickNativeFpsRow(qualityItems, target, preferredHeight) {
    const formats = getVideoFormats();
    const plainLabelIsTarget = (height) => {
      if (target === 30) return true; // plain = non-HFR stream, i.e. 30
      if (target === 23 || target === 24) {
        const atHeight = formats.filter(f => f.height === height && f.fps);
        // Plain is the cinema stream only if there is no 30/50/60 stream
        // at this height to be the plain one instead.
        return atHeight.length > 0 && atHeight.every(f => f.fps === 23 || f.fps === 24);
      }
      return false; // 50/60 always carry a suffix, never plain
    };

    const scored = qualityItems.map(item => {
      const { height, fps } = item.parsed;
      let score = -1;
      if (height != null && fps != null && fpsMatches(fps, target)) {
        score = height === preferredHeight ? 100 : height === fpsDropFromHeight ? 80 : 50;
      } else if (height != null && fps == null && plainLabelIsTarget(height)) {
        score = height === preferredHeight ? 90 : height === fpsDropFromHeight ? 70 : 40;
      }
      return { ...item, score, height: height || 0 };
    }).filter(x => x.score >= 0);

    scored.sort((a, b) => (b.score - a.score) || (b.height - a.height));
    return scored.length ? scored[0] : null;
  }

  async function applyFpsViaNative(target, preferredHeight, allowHeightChange = true) {
    const qualityItems = await openNativeQualityMenu();
    if (!qualityItems) return { ok: false, height: null };
    // Same-height-only mode: never let a re-apply change the height.
    // Filtering here, before picking, is what stops 144p -> 4K: a
    // 60fps row at 144p simply does not exist, so this fails cleanly
    // instead of picking the 2160p60 row.
    const itemsForPick = allowHeightChange
      ? qualityItems
      : qualityItems.filter(x => x.parsed.height === preferredHeight);
    let row = null;
    if (target == null) {
      // If an earlier fps choice dropped the resolution, Auto goes back
      // to the height you came from, not to the video's max - but only
      // when height changes are allowed at all.
      if (allowHeightChange && fpsDropFromHeight) {
        const atRestore = qualityItems.filter(x => x.parsed.height === fpsDropFromHeight);
        atRestore.sort((a, b) => ((b.parsed.fps || 0) - (a.parsed.fps || 0)));
        row = atRestore[0] || null;
      }
      if (!row && allowHeightChange) row = qualityItems.find(x => x.parsed.isAuto) || null;
      if (!row) {
        // No Auto row (already on a fixed quality): fall back to the
        // highest-fps row at the current height, which is what Auto
        // would pick for that height anyway.
        const atHeight = itemsForPick.filter(x => x.parsed.height === preferredHeight);
        atHeight.sort((a, b) => ((b.parsed.fps || 0) - (a.parsed.fps || 0)));
        row = atHeight[0] || null;
      }
    } else {
      row = pickNativeFpsRow(itemsForPick, target, preferredHeight);
    }
    if (!row) { await closeNativeMenu(); return { ok: false, height: null }; }
    row.row.click();
    await waitFor(() => !nativeSettingsMenu(), 800, 100);
    return { ok: true, height: row.parsed.height || null };
  }

  function applyFpsViaApi(target, preferredHeight, allowHeightChange = true) {
    const mp = getMoviePlayer();
    if (!mp) return { ok: false, height: null };
    try {
      if (target == null) {
        // Keep the current resolution level, just stop forcing a fps -
        // unless an earlier fps choice dropped it, in which case go
        // back to the height you came from (only when height changes
        // are allowed).
        let level = (allowHeightChange && fpsDropFromHeight) ? (levelForHeight(fpsDropFromHeight) || '') : '';
        if (!level && typeof mp.getPlaybackQuality === 'function') level = mp.getPlaybackQuality() || '';
        if (!level && preferredHeight) level = levelForHeight(preferredHeight) || '';
        if (level && typeof mp.setPlaybackQualityRange === 'function') {
          mp.setPlaybackQualityRange(level, level);
        }
        if (level && typeof mp.setPlaybackQuality === 'function') mp.setPlaybackQuality(level);
        return { ok: !!level, height: LEVEL_HEIGHTS[level] || null };
      }
      const format = formatForFps(target, preferredHeight, allowHeightChange);
      if (!format) return { ok: false, height: null };
      const level = levelForHeight(format.height);
      if (!level) return { ok: false, height: null };
      if (typeof mp.setPlaybackQualityRange === 'function') mp.setPlaybackQualityRange(level, level);
      if (typeof mp.setPlaybackQuality === 'function') mp.setPlaybackQuality(level);
      return { ok: true, height: format.height };
    } catch (e) { return { ok: false, height: null }; }
  }

  function verifyFps(target, videoId, attempt, allowHeightChange = true) {
    updateBadge();
    const active = getActiveSpecs();
    const ok = target == null || (active && fpsMatches(active.fps, target));
    console.log('[YT-HUD v1.6] fps verify', JSON.stringify({ target, activeFps: active ? active.fps : null, activeHeight: active ? active.height : null, ok, attempt }));
    if (ok) {
      fpsApplying = false;
      if (active) fpsLockedHeight = active.height;
      // If we are back at (or above) the height we dropped from, the
      // drop is undone - forget it so later choices are not biased.
      if (fpsDropFromHeight && active && active.height >= fpsDropFromHeight) fpsDropFromHeight = null;
      if (target == null) fpsDropFromHeight = null;
      return;
    }
    // Retry once via the native menu, then give up honestly: drop the
    // lock so the button shows Auto instead of a fps that is not playing.
    // A same-height-only retry must never become an upgrade retry.
    if (attempt < 1 && fpsVideoId === videoId && fpsTarget === target && fpsIsOffered(target)) {
      fpsApplyAttempts++;
      setTimeout(() => {
        if (fpsVideoId === videoId && fpsTarget === target) applyFps(target, attempt + 1, allowHeightChange);
      }, 500);
    } else {
      fpsApplying = false;
      if (fpsVideoId === videoId && fpsTarget === target) {
        fpsTarget = null;
        fpsLockedHeight = null;
        console.log('[YT-HUD v1.6] fps not available after retry, lock cleared');
        updateBadge();
      }
    }
  }

  async function applyFps(target, attempt, allowHeightChange = true) {
    const videoId = getCurrentVideoId();
    const active = getActiveSpecs();
    const preferredHeight = active ? active.height : null;
    fpsApplying = true;
    fpsLastApplyAt = Date.now();
    const nativeResult = await applyFpsViaNative(target, preferredHeight, allowHeightChange);
    let result = nativeResult;
    if (!result.ok) result = applyFpsViaApi(target, preferredHeight, allowHeightChange);
    // Remember a drop, so going back restores it. A chosen height
    // below the one we started at is a drop; a chosen height at/above
    // the remembered drop height undoes it. In same-height-only mode
    // result.height can never differ from preferredHeight, so no drop
    // (and no upgrade) is recorded here.
    if (result.ok && result.height && preferredHeight && result.height < preferredHeight && !fpsDropFromHeight) {
      fpsDropFromHeight = preferredHeight;
    }
    if (target == null) fpsDropFromHeight = null;
    console.log('[YT-HUD v1.6] fps apply', JSON.stringify({ target, viaNative: nativeResult.ok, viaApi: result.ok && !nativeResult.ok, preferredHeight, chosenHeight: result.height, dropFromHeight: fpsDropFromHeight, allowHeightChange }));
    // Give the player time to switch streams, then check the real fps.
    setTimeout(() => { if (fpsVideoId === videoId) verifyFps(target, videoId, attempt || 0, allowHeightChange); }, 1500);
    setTimeout(updateBadge, 500);
    setTimeout(updateBadge, 2500);
  }

  function setFps(target) {
    closeMenu();
    const videoId = getCurrentVideoId();
    fpsVideoId = videoId;
    fpsTarget = target;
    fpsLockedHeight = null;
    fpsApplyAttempts = 0;
    // If a previous apply is still in flight, its verify step checks
    // fpsTarget/videoId and will not clear this new choice.
    // Explicit fps clicks DO allow a height change - but only the one
    // the menu already warned about (↓480p / ↑2160p).
    applyFps(target, 0, true);
    updateBadge();
  }

  function toggleFpsMenu() {
    const existing = document.getElementById(FMENU_ID);
    if (existing) { existing.remove(); return; }
    closeMenu();

    const btn = document.getElementById(FBTN_ID);
    if (!btn) return;

    const active = getActiveSpecs();
    const activeFps = active ? active.fps : null;

    const menu = document.createElement('div');
    menu.id = FMENU_ID;
    menu.style.position = 'absolute';
    menu.style.bottom = '44px';
    menu.style.right = '0';
    menu.style.minWidth = '150px';
    menu.style.backgroundColor = '#212121';
    menu.style.borderRadius = '12px';
    menu.style.padding = '6px 0';
    menu.style.zIndex = '9999';
    menu.style.boxShadow = '0 8px 24px rgba(0,0,0,0.55)';
    menu.style.overflow = 'hidden';

    const activeHeight = active ? active.height : null;
    const header = document.createElement('div');
    header.textContent = activeFps ? `Playing: ${activeFps}fps` : 'FPS';
    header.style.padding = '9px 16px 5px';
    header.style.fontSize = '11px';
    header.style.color = '#aaa';
    header.style.letterSpacing = '0.5px';
    header.style.textTransform = 'uppercase';
    menu.appendChild(header);
    if (fpsDropFromHeight && activeHeight && activeHeight < fpsDropFromHeight) {
      const note = document.createElement('div');
      note.textContent = `Dropped from ${fpsDropFromHeight}p - pick 60 or Auto to go back`;
      note.style.padding = '0 16px 5px';
      note.style.fontSize = '11px';
      note.style.color = '#f9ab00';
      menu.appendChild(note);
    }

    const entries = [{ target: null, text: 'Auto' }].concat(
      FPS_OPTIONS.map(fps => ({ target: fps, text: `${fps} fps` }))
    );

    entries.forEach(entry => {
      const isCurrent = entry.target === fpsTarget;
      // v1.4: an fps is not just "offered somewhere" - if it is not
      // offered at the current height, say so and say where it drops to,
      // instead of silently dropping the resolution on click.
      let offered = true;
      let suffix = '';
      let title = '';
      if (entry.target != null) {
        // v1.5: predict from the menu-equivalent heights, NOT from any
        // format with that fps. A 720p30 format hidden behind 720p60
        // must not produce a "↓720p" label when the click will land
        // on 480p. If prediction is impossible, show a generic warning
        // with no number, rather than a wrong number.
        const predicted = activeHeight ? predictFpsHeight(entry.target, activeHeight) : null;
        if (predicted === undefined) {
          offered = false;
          suffix = activeHeight ? ` \u00b7 n/a at ${activeHeight}p` : ' \u00b7 n/a';
        } else if (predicted === null) {
          // Unknown (formats/quality data hidden): clickable, native
          // menu will decide. If formats at least say this fps exists
          // somewhere, warn generically that it may drop resolution.
          offered = fpsIsOffered(entry.target);
          if (!offered) {
            suffix = ' \u00b7 n/a';
          } else if (activeHeight && !fpsAtHeight(entry.target, activeHeight)) {
            suffix = ' \u00b7 \u2193 lower res';
            title = 'Not offered at this height - will drop to a lower resolution';
          }
        } else if (predicted === activeHeight) {
          offered = true;
        } else {
          offered = true;
          const arrow = predicted < activeHeight ? '\u2193' : '\u2191';
          const verb = predicted < activeHeight ? 'drop' : 'switch';
          suffix = ` \u00b7 ${arrow}${predicted}p`;
          title = `Not offered at ${activeHeight}p - will ${verb} to ${predicted}p`;
        }
      }
      const item = document.createElement('div');
      item.textContent = (isCurrent ? '\u2713 ' : '') + entry.text + suffix;
      if (title) item.title = title;
      item.style.padding = '9px 16px';
      item.style.fontSize = '13px';
      item.style.color = offered ? (suffix ? '#f9ab00' : '#fff') : '#888';
      item.style.cursor = offered ? 'pointer' : 'default';
      item.style.fontWeight = isCurrent ? '600' : '400';
      item.style.backgroundColor = isCurrent ? 'rgba(255,255,255,0.12)' : 'transparent';
      if (offered) {
        item.addEventListener('mouseenter', () => { if (!isCurrent) item.style.backgroundColor = 'rgba(255,255,255,0.08)'; });
        item.addEventListener('mouseleave', () => { if (!isCurrent) item.style.backgroundColor = 'transparent'; });
        item.addEventListener('click', (e) => { e.stopPropagation(); setFps(entry.target); });
      }
      menu.appendChild(item);
    });

    btn.appendChild(menu);
  }

  function toggleMenu() {
    const existing = document.getElementById(MENU_ID);
    if (existing) { existing.remove(); return; }
    const fmenu = document.getElementById(FMENU_ID);
    if (fmenu) fmenu.remove();

    const mp = getMoviePlayer();
    let levels = [];
    if (mp && typeof mp.getAvailableQualityLevels === 'function') {
      try { levels = mp.getAvailableQualityLevels() || []; } catch (e) {}
    }

    const ordered = [];
    ordered.push('auto');
    ['highres', 'hd2880', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'].forEach(l => {
      if (levels.includes(l)) ordered.push(l);
    });

    let current = '';
    if (mp && typeof mp.getPlaybackQuality === 'function') {
      try { current = mp.getPlaybackQuality() || ''; } catch (e) {}
    }

    const btn = document.getElementById(QBTN_ID);
    if (!btn) return;

    const menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.style.position = 'absolute';
    menu.style.bottom = '44px';
    menu.style.right = '0';
    menu.style.minWidth = '150px';
    menu.style.backgroundColor = '#212121';
    menu.style.borderRadius = '12px';
    menu.style.padding = '6px 0';
    menu.style.zIndex = '9999';
    menu.style.boxShadow = '0 8px 24px rgba(0,0,0,0.55)';
    menu.style.overflow = 'hidden';

    if (ordered.length <= 1 && !levels.length) {
      const empty = document.createElement('div');
      empty.textContent = 'No qualities found';
      empty.style.padding = '10px 16px';
      empty.style.fontSize = '13px';
      empty.style.color = '#aaa';
      menu.appendChild(empty);
    }

    ordered.forEach(level => {
      const isCurrent = level === current;
      const item = document.createElement('div');
      item.textContent = (isCurrent ? '\u2713 ' : '') + qualityLabel(level);
      item.style.padding = '9px 16px';
      item.style.fontSize = '13px';
      item.style.color = '#fff';
      item.style.cursor = 'pointer';
      item.style.fontWeight = isCurrent ? '600' : '400';
      item.style.backgroundColor = isCurrent ? 'rgba(255,255,255,0.12)' : 'transparent';
      item.addEventListener('mouseenter', () => { if (!isCurrent) item.style.backgroundColor = 'rgba(255,255,255,0.08)'; });
      item.addEventListener('mouseleave', () => { if (!isCurrent) item.style.backgroundColor = 'transparent'; });
      item.addEventListener('click', (e) => { e.stopPropagation(); setQuality(level); });
      menu.appendChild(item);
    });

    btn.appendChild(menu);
  }

  // Find the Subscribe button across old and new YouTube layouts,
  // preferring an element that is actually visible
  function findAnchor() {
    const selectors = [
      '#owner #subscribe-button',
      'ytd-watch-metadata #subscribe-button',
      '#owner yt-subscribe-button-view-model',
      'ytd-watch-metadata yt-subscribe-button-view-model',
      '#owner ytd-subscribe-button-renderer',
      'ytd-watch-metadata ytd-subscribe-button-renderer'
    ];

    for (const sel of selectors) {
      const nodes = document.querySelectorAll(sel);
      for (const n of nodes) {
        if (n.offsetParent !== null || n.getClientRects().length) { noAnchorTicks = 0; return { el: n, mode: 'after' }; }
      }
    }

    // Last resort: append to the owner row (e.g. you are viewing your own video,
    // where there is no Subscribe button)
    const owner = document.querySelector('ytd-watch-metadata #owner, #owner');
    if (owner) { noAnchorTicks = 0; return { el: owner, mode: 'append' }; }

    // Final fallback: float in the bottom-left corner, but only after no anchor
    // has been found for a few seconds (avoids flashing during page loads)
    noAnchorTicks++;
    if (noAnchorTicks >= 5 && document.body) return { el: document.body, mode: 'float' };

    return null;
  }

  function buildUI() {
    const anchor = findAnchor();
    if (!anchor) return null;

    let wrap = document.getElementById(WRAP_ID);

    // Re-attach if YouTube re-rendered the area and our wrap was orphaned
    if (wrap && !wrap.isConnected) wrap = null;

    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = WRAP_ID;
      wrap.style.display = 'inline-flex';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '8px';
      wrap.style.marginLeft = '10px';
      wrap.style.verticalAlign = 'middle';

      const badge = document.createElement('div');
      badge.id = BADGE_ID;
      badge.style.display = 'inline-flex';
      badge.style.alignItems = 'center';
      badge.style.justifyContent = 'center';
      badge.style.padding = '0 14px';
      badge.style.height = '36px';
      badge.style.borderRadius = '18px';
      badge.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
      badge.style.color = 'var(--yt-spec-text-primary, #fff)';
      badge.style.fontSize = '12px';
      badge.style.fontWeight = '500';
      badge.style.letterSpacing = '0.3px';
      badge.style.userSelect = 'none';
      badge.style.whiteSpace = 'nowrap';

      const btn = document.createElement('div');
      btn.id = QBTN_ID;
      btn.style.position = 'relative';
      btn.style.display = 'inline-flex';
      btn.style.alignItems = 'center';
      btn.style.justifyContent = 'center';
      btn.style.height = '36px';
      btn.style.padding = '0 14px';
      btn.style.borderRadius = '18px';
      btn.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
      btn.style.color = 'var(--yt-spec-text-primary, #fff)';
      btn.style.fontSize = '12px';
      btn.style.fontWeight = '500';
      btn.style.cursor = 'pointer';
      btn.style.userSelect = 'none';
      btn.style.whiteSpace = 'nowrap';
      btn.title = 'Change playback quality';

      const label = document.createElement('span');
      label.id = QLABEL_ID;
      btn.appendChild(label);

      btn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });

      const fbtn = document.createElement('div');
      fbtn.id = FBTN_ID;
      fbtn.style.position = 'relative';
      fbtn.style.display = 'inline-flex';
      fbtn.style.alignItems = 'center';
      fbtn.style.justifyContent = 'center';
      fbtn.style.height = '36px';
      fbtn.style.padding = '0 14px';
      fbtn.style.borderRadius = '18px';
      fbtn.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
      fbtn.style.color = 'var(--yt-spec-text-primary, #fff)';
      fbtn.style.fontSize = '12px';
      fbtn.style.fontWeight = '500';
      fbtn.style.cursor = 'pointer';
      fbtn.style.userSelect = 'none';
      fbtn.style.whiteSpace = 'nowrap';
      fbtn.title = 'Change playback frame rate';

      const flabel = document.createElement('span');
      flabel.id = FLABEL_ID;
      fbtn.appendChild(flabel);

      fbtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFpsMenu(); });

      wrap.appendChild(badge);
      wrap.appendChild(btn);
      wrap.appendChild(fbtn);
    }

    // Make sure the wrap sits right after the anchor (re-check each tick)
    if (anchor.mode === 'after') {
      if (wrap.previousSibling !== anchor.el || wrap.parentNode !== anchor.el.parentNode) {
        anchor.el.parentNode.insertBefore(wrap, anchor.el.nextSibling);
      }
    } else if (wrap.parentNode !== anchor.el) {
      anchor.el.appendChild(wrap);
    }

    if (anchor.mode === 'float') {
      wrap.style.position = 'fixed';
      wrap.style.left = '16px';
      wrap.style.bottom = '16px';
      wrap.style.zIndex = '9998';
      wrap.style.marginLeft = '0';
    } else if (wrap.style.position === 'fixed') {
      wrap.style.position = '';
      wrap.style.left = '';
      wrap.style.bottom = '';
      wrap.style.zIndex = '';
      wrap.style.marginLeft = '10px';
    }

    lastAnchorMode = anchor.mode;
    return wrap;
  }

  function updateBadge() {
    if (!window.location.pathname.startsWith('/watch')) {
      const existing = document.getElementById(WRAP_ID);
      if (existing) existing.remove();
      closeMenu();
      return;
    }

    // A new video gets a fresh fps state; a lock from the last video
    // must never silently carry over (and must not be cleared by a
    // verify timer from the old video either - verify checks videoId).
    const currentVideoId = getCurrentVideoId();
    if (fpsVideoId !== currentVideoId) {
      fpsVideoId = currentVideoId;
      fpsTarget = null;
      fpsDropFromHeight = null;
      fpsLockedHeight = null;
      fpsApplying = false;
      fpsApplyAttempts = 0;
    }

    const maxSpecs = getMaxSpecs();
    const activeSpecs = getActiveSpecs();

    // Watchdog for quality changes made outside the HUD (native menu,
    // YouTube adapting): if a verified lock was playing at one height
    // and the video is now playing at a different height with a
    // different fps, that change wins. Do NOT re-apply the lock here -
    // re-applying is exactly what would drag 144p back up to 4K.
    // The 4-second grace after an apply lets the switch settle first.
    if (fpsTarget != null && !fpsApplying && fpsLockedHeight != null && activeSpecs &&
        activeSpecs.height !== fpsLockedHeight && Date.now() - fpsLastApplyAt > 4000) {
      if (activeSpecs.fps && fpsMatches(activeSpecs.fps, fpsTarget)) {
        fpsLockedHeight = activeSpecs.height;
      } else {
        console.log('[YT-HUD v1.6] playing height changed, fps lock cleared (manual quality wins)', JSON.stringify({ fpsTarget, wasHeight: fpsLockedHeight, nowHeight: activeSpecs.height, nowFps: activeSpecs.fps }));
        fpsTarget = null;
        fpsDropFromHeight = null;
        fpsLockedHeight = null;
      }
    }

    const built = buildUI();

    const mpDbg = getMoviePlayer();
    const dbg = JSON.stringify({
      player: !!mpDbg,
      getPlayerResponse: typeof mpDbg?.getPlayerResponse,
      getAvailableQualityLevels: typeof mpDbg?.getAvailableQualityLevels,
      getStatsForNerds: typeof mpDbg?.getStatsForNerds,
      formats: getVideoFormats().length,
      offeredFps: getAvailableFps(),
      fpsTarget: fpsTarget,
      max: maxSpecs,
      active: activeSpecs,
      anchor: lastAnchorMode,
      mounted: !!built
    });
    if (dbg !== lastDebug) {
      lastDebug = dbg;
      console.log('[YT-HUD v1.6]', dbg);
    }

    if (!built) return;

    const badge = document.getElementById(BADGE_ID);
    const qlabel = document.getElementById(QLABEL_ID);
    const flabel = document.getElementById(FLABEL_ID);

    const activeText = activeSpecs ? formatQuality(activeSpecs.height, activeSpecs.fps) : '...';
    const maxText = maxSpecs ? formatQuality(maxSpecs.height, maxSpecs.fps) : '...';

    const text = `${activeText} / Max: ${maxText}`;
    if (badge && badge.textContent !== text) badge.textContent = text;

    if (qlabel) {
      const mp = getMoviePlayer();
      let q = '';
      if (mp && typeof mp.getPlaybackQuality === 'function') {
        try { q = mp.getPlaybackQuality() || ''; } catch (e) {}
      }
      const qText = '\u2699 ' + qualityLabel(q);
      if (qlabel.textContent !== qText) qlabel.textContent = qText;
    }

    if (flabel) {
      let fText = fpsLabel(fpsTarget);
      // Make a drop visible on the button itself, not just in the menu:
      // "FPS: 30 ↓480p" instead of a bare "FPS: 30" next to a 480p badge.
      if (fpsTarget != null && fpsDropFromHeight && activeSpecs && activeSpecs.height < fpsDropFromHeight) {
        fText = `FPS: ${fpsTarget} \u2193${activeSpecs.height}p`;
      }
      if (flabel.textContent !== fText) flabel.textContent = fText;
    }

    const darkNow = applyTheme();
    if (lastTheme !== darkNow) {
      lastTheme = darkNow;
      console.log('[YT-HUD v1.6] theme:', darkNow ? 'dark' : 'light');
    }


  }

  let listenedVideo = null;
  function attachVideoListener() {
    const video = document.querySelector('#movie_player video, video.html5-main-video, video');
    if (video && video !== listenedVideo) {
      if (listenedVideo) listenedVideo.removeEventListener('resize', updateBadge);
      video.addEventListener('resize', updateBadge);
      listenedVideo = video;
    }
  }

  document.addEventListener('click', () => {
    closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  window.addEventListener('yt-navigate-finish', () => {
    attachVideoListener();
    setTimeout(updateBadge, 600);
  });

  attachVideoListener();
  updateBadge();

  setInterval(() => {
    attachVideoListener();
    updateBadge();
  }, 1000);
})();
