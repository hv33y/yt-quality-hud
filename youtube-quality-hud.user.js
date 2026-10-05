// ==UserScript==
// @name         YouTube Resolution & FPS Badge (Current & Max)
// @namespace    https://github.com/hv33y
// @version      1.0
// @description  Displays both active playback and maximum original resolution/fps next to the Subscribe button
// @author       github.com/hv33y
// @match        https://www.youtube.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const BADGE_ID = 'yt-dual-res-badge';

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

  function getMaxSpecs() {
    const moviePlayer = document.getElementById('movie_player');
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
    const moviePlayer = document.getElementById('movie_player');
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

  function updateBadge() {
    if (!window.location.pathname.startsWith('/watch')) {
      const existing = document.getElementById(BADGE_ID);
      if (existing) existing.remove();
      return;
    }

    const maxSpecs = getMaxSpecs();
    const activeSpecs = getActiveSpecs();

    if (!maxSpecs && !activeSpecs) return;

    const subscribeContainer = document.querySelector('#owner #subscribe-button, ytd-watch-metadata #subscribe-button');
    if (!subscribeContainer) return;

    let badge = document.getElementById(BADGE_ID);
    if (!badge) {
      badge = document.createElement('div');
      badge.id = BADGE_ID;
      badge.style.display = 'inline-flex';
      badge.style.alignItems = 'center';
      badge.style.justifyContent = 'center';
      badge.style.marginLeft = '10px';
      badge.style.padding = '0 14px';
      badge.style.height = '36px';
      badge.style.borderRadius = '18px';
      badge.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
      badge.style.color = 'var(--yt-spec-text-primary, #fff)';
      badge.style.fontSize = '12px';
      badge.style.fontWeight = '500';
      badge.style.letterSpacing = '0.3px';
      badge.style.verticalAlign = 'middle';
      badge.style.userSelect = 'none';

      subscribeContainer.parentNode.insertBefore(badge, subscribeContainer.nextSibling);
    }

    const activeText = activeSpecs ? formatQuality(activeSpecs.height, activeSpecs.fps) : '...';
    const maxText = maxSpecs ? formatQuality(maxSpecs.height, maxSpecs.fps) : '...';

    // Renders like: "1080p 60fps / Max: 4K 60fps"
    badge.textContent = `${activeText} / Max: ${maxText}`;
  }

  function attachVideoListener() {
    const video = document.querySelector('video');
    if (video) {
      video.removeEventListener('resize', updateBadge);
      video.addEventListener('resize', updateBadge);
    }
  }

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
