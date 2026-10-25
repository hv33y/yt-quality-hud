// ==UserScript==
// @name         YouTube Resolution & FPS Badge (Current & Max) + Quality & FPS Switcher
// @namespace    https://github.com/hv33y
// @version      1.3
// @description  Displays both active playback and maximum original resolution/fps next to the Subscribe button, plus one-click quality and FPS changers (Auto, 23, 24, 30, 50, 60 fps)
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
  let fpsApplying = false;
  let fpsApplyAttempts = 0;
  let fpsLastApplyAt = 0;

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


  console.log('[YT-HUD v1.3] script loaded');

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
    // Changing resolution must not silently drop an fps lock: re-apply
    // it at the new height once the quality switch has settled.
    if (fpsTarget != null) {
      setTimeout(() => { if (fpsTarget != null) applyFps(fpsTarget, 0); }, 2000);
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
  // Flow for a chosen fps:
  //   1. Open the player's Settings menu, open Quality, scan its entries.
  //   2. Click the best entry for that fps (same height first, then the
  //      highest height that offers that fps).
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

  function levelForHeight(height) {
    for (const [level, h] of Object.entries(LEVEL_HEIGHTS)) {
      if (h === height) return level;
    }
    return null;
  }

  // Best format for a fps: same height first, then highest height with it.
  function formatForFps(target, preferredHeight) {
    const formats = getVideoFormats().filter(f => f.fps && fpsMatches(f.fps, target));
    if (!formats.length) return null;
    const sameHeight = formats.filter(f => f.height === preferredHeight);
    if (sameHeight.length) {
      sameHeight.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      return sameHeight[0];
    }
    formats.sort((a, b) => (b.height - a.height) || ((b.bitrate || 0) - (a.bitrate || 0)));
    return formats[0];
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
        score = height === preferredHeight ? 100 : 50;
      } else if (height != null && fps == null && plainLabelIsTarget(height)) {
        score = height === preferredHeight ? 90 : 40;
      }
      return { ...item, score, height: height || 0 };
    }).filter(x => x.score >= 0);

    scored.sort((a, b) => (b.score - a.score) || (b.height - a.height));
    return scored.length ? scored[0] : null;
  }

  async function applyFpsViaNative(target, preferredHeight) {
    const qualityItems = await openNativeQualityMenu();
    if (!qualityItems) return false;
    let row = null;
    if (target == null) {
      row = qualityItems.find(x => x.parsed.isAuto) || null;
      if (!row) {
        // No Auto row (already on a fixed quality): fall back to the
        // highest-fps row at the current height, which is what Auto
        // would pick for that height anyway.
        const atHeight = qualityItems.filter(x => x.parsed.height === preferredHeight);
        atHeight.sort((a, b) => ((b.parsed.fps || 0) - (a.parsed.fps || 0)));
        row = atHeight[0] || null;
      }
    } else {
      row = pickNativeFpsRow(qualityItems, target, preferredHeight);
    }
    if (!row) { await closeNativeMenu(); return false; }
    row.row.click();
    await waitFor(() => !nativeSettingsMenu(), 800, 100);
    return true;
  }

  function applyFpsViaApi(target, preferredHeight) {
    const mp = getMoviePlayer();
    if (!mp) return false;
    try {
      if (target == null) {
        // Keep the current resolution level, just stop forcing a fps.
        let level = '';
        if (typeof mp.getPlaybackQuality === 'function') level = mp.getPlaybackQuality() || '';
        if (!level && preferredHeight) level = levelForHeight(preferredHeight) || '';
        if (level && typeof mp.setPlaybackQualityRange === 'function') {
          mp.setPlaybackQualityRange(level, level);
        }
        if (level && typeof mp.setPlaybackQuality === 'function') mp.setPlaybackQuality(level);
        return !!level;
      }
      const format = formatForFps(target, preferredHeight);
      if (!format) return false;
      const level = levelForHeight(format.height);
      if (!level) return false;
      if (typeof mp.setPlaybackQualityRange === 'function') mp.setPlaybackQualityRange(level, level);
      if (typeof mp.setPlaybackQuality === 'function') mp.setPlaybackQuality(level);
      return true;
    } catch (e) { return false; }
  }

  function verifyFps(target, videoId, attempt) {
    updateBadge();
    const active = getActiveSpecs();
    const ok = target == null || (active && fpsMatches(active.fps, target));
    console.log('[YT-HUD v1.3] fps verify', JSON.stringify({ target, activeFps: active ? active.fps : null, ok, attempt }));
    if (ok) {
      fpsApplying = false;
      return;
    }
    // Retry once via the native menu, then give up honestly: drop the
    // lock so the button shows Auto instead of a fps that is not playing.
    if (attempt < 1 && fpsVideoId === videoId && fpsTarget === target && fpsIsOffered(target)) {
      fpsApplyAttempts++;
      setTimeout(() => {
        if (fpsVideoId === videoId && fpsTarget === target) applyFps(target, attempt + 1);
      }, 500);
    } else {
      fpsApplying = false;
      if (fpsVideoId === videoId && fpsTarget === target) {
        fpsTarget = null;
        console.log('[YT-HUD v1.3] fps not available after retry, lock cleared');
        updateBadge();
      }
    }
  }

  async function applyFps(target, attempt) {
    const videoId = getCurrentVideoId();
    const active = getActiveSpecs();
    const preferredHeight = active ? active.height : null;
    fpsApplying = true;
    fpsLastApplyAt = Date.now();
    const viaNative = await applyFpsViaNative(target, preferredHeight);
    let applied = viaNative;
    if (!applied) applied = applyFpsViaApi(target, preferredHeight);
    console.log('[YT-HUD v1.3] fps apply', JSON.stringify({ target, viaNative, viaApi: applied && !viaNative, preferredHeight }));
    // Give the player time to switch streams, then check the real fps.
    setTimeout(() => { if (fpsVideoId === videoId) verifyFps(target, videoId, attempt || 0); }, 1500);
    setTimeout(updateBadge, 500);
    setTimeout(updateBadge, 2500);
  }

  function setFps(target) {
    closeMenu();
    const videoId = getCurrentVideoId();
    fpsVideoId = videoId;
    fpsTarget = target;
    fpsApplyAttempts = 0;
    // If a previous apply is still in flight, its verify step checks
    // fpsTarget/videoId and will not clear this new choice.
    applyFps(target, 0);
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

    const header = document.createElement('div');
    header.textContent = activeFps ? `Playing: ${activeFps}fps` : 'FPS';
    header.style.padding = '9px 16px 5px';
    header.style.fontSize = '11px';
    header.style.color = '#aaa';
    header.style.letterSpacing = '0.5px';
    header.style.textTransform = 'uppercase';
    menu.appendChild(header);

    const entries = [{ target: null, text: 'Auto' }].concat(
      FPS_OPTIONS.map(fps => ({ target: fps, text: `${fps} fps` }))
    );

    entries.forEach(entry => {
      const isCurrent = entry.target === fpsTarget;
      const offered = entry.target == null || fpsIsOffered(entry.target);
      const item = document.createElement('div');
      item.textContent = (isCurrent ? '\u2713 ' : '') + entry.text + (offered ? '' : ' \u00b7 n/a');
      item.style.padding = '9px 16px';
      item.style.fontSize = '13px';
      item.style.color = offered ? '#fff' : '#888';
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
      fpsApplying = false;
      fpsApplyAttempts = 0;
    }

    const maxSpecs = getMaxSpecs();
    const activeSpecs = getActiveSpecs();

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
      console.log('[YT-HUD v1.3]', dbg);
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
      const fText = fpsLabel(fpsTarget);
      if (flabel.textContent !== fText) flabel.textContent = fText;
    }

    const darkNow = applyTheme();
    if (lastTheme !== darkNow) {
      lastTheme = darkNow;
      console.log('[YT-HUD v1.3] theme:', darkNow ? 'dark' : 'light');
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
