// ==UserScript==
// @name         YouTube Resolution & FPS Badge (Current & Max) + Quality Switcher
// @namespace    https://github.com/hv33y
// @version      1.1
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
    return document.getElementById('movie_player');
  }

  function getMaxSpecs() {
    const moviePlayer = getMoviePlayer();
    let formats = [];

    if (moviePlayer && typeof moviePlayer.getPlayerResponse === 'function') {
      const resp = moviePlayer.getPlayerResponse();
      formats = resp?.streamingData?.adaptiveFormats || [];
    }

    if (!formats.length && window.ytInitialPlayerResponse) {
      formats = window.ytInitialPlayerResponse?.streamingData?.adaptiveFormats || [];
    }

    const videoStreams = formats.filter(f => f.width && f.height && f.mimeType?.includes('video'));
    if (!videoStreams.length) return null;

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

  function getActiveSpecs() {
    const moviePlayer = getMoviePlayer();
    const video = document.querySelector('video');

    if (!video || !video.videoWidth || !video.videoHeight) {
      return null;
    }

    let fps = 30;
    if (moviePlayer && typeof moviePlayer.getStatsForNerds === 'function') {
      const stats = moviePlayer.getStatsForNerds();
      const match = stats?.resolution?.match(/@(\d+)/);
      if (match) fps = parseInt(match[1], 10);
    }

    return {
      width: video.videoWidth,
      height: video.videoHeight,
      fps: fps
    };
  }

  const QUALITY_LABELS = {
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
    if (!mp || typeof mp.setPlaybackQualityRange !== 'function') return;
    try {
      mp.setPlaybackQualityRange(level, level);
    } catch (e) { /* player busy, ignore */ }
    closeMenu();
    setTimeout(updateBadge, 500);
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
    if (levels.includes('auto')) ordered.push('auto');
    ['hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'].forEach(l => {
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

    if (!ordered.length) {
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

  function buildUI() {
    const subscribeContainer = document.querySelector('#owner #subscribe-button, ytd-watch-metadata #subscribe-button');
    if (!subscribeContainer) return null;

    let wrap = document.getElementById(WRAP_ID);
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
      subscribeContainer.parentNode.insertBefore(wrap, subscribeContainer.nextSibling);
    }
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

    if (!maxSpecs && !activeSpecs) return;
    if (!buildUI()) return;

    const badge = document.getElementById(BADGE_ID);
    const qlabel = document.getElementById(QLABEL_ID);

    const activeText = activeSpecs ? formatQuality(activeSpecs.height, activeSpecs.fps) : '...';
    const maxText = maxSpecs ? formatQuality(maxSpecs.height, maxSpecs.fps) : '...';

    if (badge) badge.textContent = `${activeText} / Max: ${maxText}`;

    if (qlabel) {
      const mp = getMoviePlayer();
      let q = '';
      if (mp && typeof mp.getPlaybackQuality === 'function') {
        try { q = mp.getPlaybackQuality() || ''; } catch (e) {}
      }
      qlabel.textContent = '\u2699 ' + qualityLabel(q);
    }
  }

  function attachVideoListener() {
    const video = document.querySelector('video');
    if (video) {
      video.removeEventListener('resize', updateBadge);
      video.addEventListener('resize', updateBadge);
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

  setInterval(() => {
    attachVideoListener();
    updateBadge();
  }, 1000);
})();
