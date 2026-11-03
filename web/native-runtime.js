'use strict';
(function () {
  const LOGICAL_WIDTH = 390;
  const LOGICAL_HEIGHT = 844;
  const canvas = document.getElementById('game');
  const loading = document.getElementById('loading');
  const errorOutput = document.getElementById('error');
  const retryButton = document.getElementById('retry');
  const storageWarning = document.getElementById('storage-warning');
  retryButton.addEventListener('click', () => window.location.reload());
  function showError(message) {
    errorOutput.textContent = String(message || '游戏启动失败');
    loading.hidden = true;
    retryButton.hidden = false;
  }
  // Private browsing, file:// URLs and storage quotas may disable localStorage.
  // Preserve gameplay in those environments, but never misrepresent volatile saves.
  const volatileStorage = new Map();
  let persistentStorage = true;
  try {
    const probe = '__birdup_storage_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
  } catch (_) { persistentStorage = false; storageWarning.hidden = false; }
  function getSaved(key) {
    if (persistentStorage) {
      try { const value = localStorage.getItem(key); if (value !== null) volatileStorage.set(key, value); return value === null ? undefined : value; }
      catch (_) { persistentStorage = false; storageWarning.hidden = false; }
    }
    return volatileStorage.has(key) ? volatileStorage.get(key) : undefined;
  }
  function putSaved(key, value) {
    const serialized = String(value);
    volatileStorage.set(key, serialized);
    if (persistentStorage) {
      try { localStorage.setItem(key, serialized); return; }
      catch (_) { persistentStorage = false; storageWarning.hidden = false; }
    }
    volatileStorage.set(key, serialized);
  }
  function removeSaved(key) {
    volatileStorage.delete(key);
    if (persistentStorage) {
      try { localStorage.removeItem(key); return; }
      catch (_) { persistentStorage = false; storageWarning.hidden = false; }
    }
    volatileStorage.delete(key);
  }
  const callbacks = {
    resize: [], hide: [], show: [],
    touchStart: [], touchMove: [], touchEnd: [], touchCancel: [],
    mouseDown: [], mouseMove: [], mouseUp: []
  };
  const audioPlayers = new Set();

  // Optional Web Audio synthesizer fallback when local WAV assets are unavailable
  let synthCtx = null;
  const synthCues = {
    tap: [[74, 0, .09, 'triangle', .22], [81, .025, .08, 'sine', .12]],
    'home-select': [[79, 0, .13, 'triangle', .24], [86, .035, .09, 'sine', .1]],
    'home-swap': [[76, 0, .11, 'sine', .2], [83, .065, .16, 'sine', .18]],
    'home-route': [[72, 0, .16, 'sine', .2], [76, .11, .18, 'sine', .2], [79, .22, .22, 'sine', .2], [84, .34, .32, 'sine', .22]],
    'home-arrive': [[84, 0, .16, 'sine', .22], [91, .08, .24, 'sine', .2]],
    'home-blocked': [[65, 0, .09, 'triangle', .16], [64, .075, .11, 'triangle', .13]],
    hint: [[79, 0, .13, 'sine', .2], [86, .085, .22, 'sine', .18]],
    'stack-drop': [[60, 0, .07, 'triangle', .2], [55, .04, .09, 'triangle', .18]],
    'stack-land': [[60, 0, .09, 'triangle', .2], [72, .035, .18, 'triangle', .2]],
    'stack-perfect': [[76, 0, .16, 'triangle', .22], [79, .055, .2, 'triangle', .22], [84, .11, .26, 'sine', .22]],
    'rescue-pull': [[53, 0, .18, 'triangle', .2, 60], [60, .09, .14, 'triangle', .14, 55]],
    'rescue-burst-1': [[72, 0, .12, 'sine', .22], [84, .06, .14, 'sine', .14]],
    'rescue-burst-2': [[74, 0, .13, 'triangle', .22], [81, .07, .16, 'sine', .16], [88, .12, .15, 'sine', .12]],
    'rescue-burst-3': [[76, 0, .14, 'triangle', .24], [81, .05, .18, 'sine', .18], [88, .11, .2, 'sine', .14], [93, .18, .16, 'sine', .1]],
    'rescue-burst-4': [[72, 0, .16, 'triangle', .2], [79, .045, .2, 'triangle', .22], [84, .09, .24, 'sine', .18], [91, .16, .26, 'sine', .14]],
    'rescue-settle': [[55, 0, .11, 'triangle', .18], [67, .065, .16, 'triangle', .18]],
    'rescue-blocked': [[48, 0, .085, 'triangle', .2], [48, .12, .085, 'triangle', .18]],
    'rescue-risk': [[62, 0, .16, 'triangle', .15, 59], [62, .22, .16, 'triangle', .13, 59]],
    'win-fall': [[48, 0, .14, 'triangle', .16, 42], [79, .13, .12, 'sine', .2, 91], [88, .29, .11, 'sine', .18, 81], [72, .39, .24, 'triangle', .16], [76, .57, .27, 'triangle', .17], [79, .75, .31, 'sine', .2], [84, .94, .54, 'sine', .22], [88, 1.16, .44, 'sine', .11], [91, 1.33, .54, 'sine', .09], [72, 1.33, .57, 'triangle', .08]],
    reward: [[72, 0, .2, 'sine', .22], [79, .085, .22, 'sine', .22], [84, .17, .26, 'sine', .22], [88, .28, .36, 'sine', .2], [91, .42, .5, 'sine', .18]],
    place: [[72, 0, .12, 'sine', .2], [79, .06, .12, 'sine', .18]],
    soft: [[55, 0, .14, 'sine', .16], [52, .08, .16, 'sine', .14]]
  };
  function playSynthCue(srcUrl) {
    try {
      const m = /fx-([a-z0-9-]+)\.wav/i.exec(srcUrl || '');
      if (!m) return;
      const notes = synthCues[m[1]];
      if (!notes) return;
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!synthCtx) synthCtx = new Ctx();
      if (synthCtx.state === 'suspended') synthCtx.resume().catch(() => {});
      const now = synthCtx.currentTime;
      for (const [midi, start, len = .12, type = 'sine', amp = .2, slide] of notes) {
        const osc = synthCtx.createOscillator();
        const gain = synthCtx.createGain();
        osc.type = type;
        const f0 = 440 * Math.pow(2, (midi - 69) / 12);
        osc.frequency.setValueAtTime(f0, now + start);
        if (slide !== undefined) {
          osc.frequency.exponentialRampToValueAtTime(440 * Math.pow(2, (slide - 69) / 12), now + start + len);
        }
        gain.gain.setValueAtTime(0.0001, now + start);
        gain.gain.linearRampToValueAtTime(amp * 0.45, now + start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + start + len);
        osc.connect(gain);
        gain.connect(synthCtx.destination);
        osc.start(now + start);
        osc.stop(now + start + len + 0.02);
      }
    } catch (_) {}
  }

  function emit(name, payload) {
    callbacks[name].forEach(callback => callback(payload));
  }

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      identifier: event.pointerId || 0,
      clientX: (event.clientX - rect.left) * LOGICAL_WIDTH / rect.width,
      clientY: (event.clientY - rect.top) * LOGICAL_HEIGHT / rect.height
    };
  }

  function createAudio() {
    const audio = new Audio();
    let canplay, ended, error, rawSrc = '';
    audio.preload = 'auto';
    audioPlayers.add(audio);
    audio.addEventListener('canplay', () => canplay?.());
    audio.addEventListener('ended', () => ended?.());
    audio.addEventListener('error', event => { playSynthCue(rawSrc); error?.(event); });
    return {
      get src() { return audio.src; },
      set src(value) {
        rawSrc = String(value || '');
        const audioPath = rawSrc.endsWith('/fx-win-fall.wav') ? rawSrc + '?v=rescue-success-20261102' : rawSrc;
        try { audio.src = typeof document !== 'undefined' && document.baseURI ? new URL(audioPath, document.baseURI).href : audioPath; }
        catch (_) { audio.src = audioPath; }
      },
      get volume() { return audio.volume; },
      set volume(value) { audio.volume = value; },
      get loop() { return audio.loop; },
      set loop(value) { audio.loop = !!value; },
      get paused() { return audio.paused; },
      obeyMuteSwitch: true,
      autoplay: false,
      play() {
        const res = audio.play();
        if (res && typeof res.catch === 'function') return res.catch(() => { playSynthCue(rawSrc); });
        return res;
      },
      pause() { audio.pause(); },
      stop() { audio.pause(); try { audio.currentTime = 0; } catch (_) {} },
      seek(value) { try { audio.currentTime = value; } catch (_) {} },
      onCanplay(callback) { canplay = callback; },
      onEnded(callback) { ended = callback; },
      onError(callback) { error = callback; },
      destroy() { audio.pause(); audio.src = ''; audioPlayers.delete(audio); }
    };
  }

  const wx = {
    __preview: true,
    createCanvas: () => canvas,
    createOffscreenCanvas: ({width = 1, height = 1} = {}) => {
      const surface = document.createElement('canvas');
      surface.width = width;
      surface.height = height;
      return surface;
    },
    createImage: () => new Image(),
    createInnerAudioContext: createAudio,
    setInnerAudioOption() {},
    getWindowInfo: () => ({
      windowWidth: LOGICAL_WIDTH,
      windowHeight: LOGICAL_HEIGHT,
      screenWidth: LOGICAL_WIDTH,
      screenHeight: LOGICAL_HEIGHT,
      pixelRatio: Math.min(2, window.devicePixelRatio || 1),
      safeArea: {top: 0, left: 0, right: LOGICAL_WIDTH, bottom: LOGICAL_HEIGHT, width: LOGICAL_WIDTH, height: LOGICAL_HEIGHT}
    }),
    getSystemInfoSync() { return this.getWindowInfo(); },
    getStorageSync: getSaved,
    setStorageSync: putSaved,
    removeStorageSync: removeSaved,
    onWindowResize(callback) { callbacks.resize.push(callback); },
    onHide(callback) { callbacks.hide.push(callback); },
    onShow(callback) { callbacks.show.push(callback); },
    onTouchStart(callback) { callbacks.touchStart.push(callback); },
    onTouchMove(callback) { callbacks.touchMove.push(callback); },
    onTouchEnd(callback) { callbacks.touchEnd.push(callback); },
    onTouchCancel(callback) { callbacks.touchCancel.push(callback); },
    onMouseDown(callback) { callbacks.mouseDown.push(callback); },
    onMouseMove(callback) { callbacks.mouseMove.push(callback); },
    onMouseUp(callback) { callbacks.mouseUp.push(callback); },
    vibrateShort({type} = {}) { navigator.vibrate?.(type === 'heavy' ? 28 : type === 'medium' ? 18 : 9); },
    showToast({title} = {}) { errorOutput.textContent = String(title || ''); },
    setUserCloudStorage({success} = {}) { success?.(); }
  };

  let app;
  try {
    app = window.startNative(wx);
  } catch (error) {
    console.error(error);
    showError('网页版启动失败：' + (error?.message || '未知错误')); 
    return;
  }

  // Rescue accepts a second pointer for pinch zoom; the other games keep
  // their existing single-pointer gestures.
  const activePointers = new Map();
  const pointerEvent = (changed, touches) => ({changedTouches: [changed], touches: [...touches]});
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    if (activePointers.size && (app.controller.view !== 'game' || app.controller.game?.mode !== 'fall')) return;
    try { canvas.setPointerCapture?.(event.pointerId); } catch (_) {}
    const p = point(event);
    activePointers.set(event.pointerId, p);
    emit('touchStart', pointerEvent(p, activePointers.values()));
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', event => {
    if (!activePointers.has(event.pointerId)) return;
    const p = point(event);
    activePointers.set(event.pointerId, p);
    emit('touchMove', pointerEvent(p, activePointers.values()));
    event.preventDefault();
  });
  function endPointer(event, cancelled) {
    if (!activePointers.has(event.pointerId)) return;
    const p = point(event);
    activePointers.delete(event.pointerId);
    emit(cancelled ? 'touchCancel' : 'touchEnd', pointerEvent(p, activePointers.values()));
    try { canvas.releasePointerCapture?.(event.pointerId); } catch (_) {}
    event.preventDefault();
  }
  canvas.addEventListener('pointerup', event => endPointer(event, false));
  canvas.addEventListener('pointercancel', event => endPointer(event, true));
  canvas.addEventListener('lostpointercapture', event => {
    if (!activePointers.has(event.pointerId)) return;
    activePointers.delete(event.pointerId);
    emit('touchCancel', pointerEvent(point(event), activePointers.values()));
  });
  window.addEventListener('blur', () => {
    if (activePointers.size) {
      activePointers.clear();
      emit('touchCancel', {changedTouches: [], touches: []});
    }
  });
  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('wheel', event => {
    if (event.ctrlKey && app.controller.view === 'game' && app.controller.game?.mode === 'fall') {
      const p = point(event);
      app.renderer.setRescueZoom((app.renderer.rescueZoom || 1) * Math.exp(-event.deltaY * 0.012), p.clientX, p.clientY);
      event.preventDefault();
      return;
    }
    const region = app.renderer.scrollRegion;
    const owner = app.controller.panel || region?.owner;
    if (region && owner) owner.scroll = Math.max(0, Math.min(region.max, (owner.scroll || 0) + event.deltaY));
    event.preventDefault();
  }, {passive: false});
  document.addEventListener('visibilitychange', () => emit(document.hidden ? 'hide' : 'show'));
  window.addEventListener('resize', () => emit('resize', {size: wx.getWindowInfo()}));

  setInterval(() => {
    const message = app.error?.message || app.renderer.d.errors.join(', ');
    if (app.error) showError('游戏运行出错：' + message);
    else if (message) errorOutput.textContent = message;
  }, 300);
})();
