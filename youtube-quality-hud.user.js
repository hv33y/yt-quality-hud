// ==UserScript==
// @name         YouTube Resolution & FPS Badge (Current & Max) + Quality Switcher
// @namespace    https://github.com/hv33y
// @version      1.2
// @description  Displays both active playback and maximum original resolution/fps next to the Subscribe button, plus a one-click quality changer
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

  let lastAnchorMode = 'none';
  let lastDebug = '';
  let lastTheme = null;
  let noAnchorTicks = 0;

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
    [BADGE_ID, QBTN_ID].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.style.backgroundColor !== bg) el.style.backgroundColor = bg;
      if (el.style.color !== fg) el.style.color = fg;
    });
    return dark;
  }


  console.log('[YT-HUD v1.2] script loaded');

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
  }

  function toggleMenu() {
    const existing = document.getElementById(MENU_ID);
    if (existing) { existing.remove(); return; }

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

      wrap.appendChild(badge);
      wrap.appendChild(btn);
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
      max: maxSpecs,
      active: activeSpecs,
      anchor: lastAnchorMode,
      mounted: !!built
    });
    if (dbg !== lastDebug) {
      lastDebug = dbg;
      console.log('[YT-HUD v1.2]', dbg);
    }

    if (!built) return;

    const badge = document.getElementById(BADGE_ID);
    const qlabel = document.getElementById(QLABEL_ID);

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

    const darkNow = applyTheme();
    if (lastTheme !== darkNow) {
      lastTheme = darkNow;
      console.log('[YT-HUD v1.2] theme:', darkNow ? 'dark' : 'light');
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
    const menu = document.getElementById(MENU_ID);
    if (menu) menu.remove();
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
