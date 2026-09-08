// =====================================================================
// helpers
// =====================================================================
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const lerp = (a, b, t) => a + (b - a) * t;
// remap t from [inMin, inMax] to [0, 1], clamped
const remap = (t, inMin, inMax) => clamp((t - inMin) / (inMax - inMin), 0, 1);

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// =====================================================================
// starfield background (canvas, two parallax depths)
// =====================================================================
(function starfield() {
  const canvas = document.getElementById('stars-bg');
  const ctx = canvas.getContext('2d');
  let stars = [];
  let w, h, dpr;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildStars();
  }

  function buildStars() {
    const count = Math.round((w * h) / 9000);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.3 + 0.3,
      depth: Math.random() < 0.7 ? 0.15 : 0.4,
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.5 + 0.3,
    }));
  }

  let scrollY = window.scrollY;
  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      const twinkle = prefersReducedMotion ? 1 : 0.55 + 0.45 * Math.sin(t * 0.001 * s.speed + s.phase);
      const parallaxY = (scrollY * s.depth) % (h + 40);
      const y = (s.y - parallaxY + h * 2) % h;
      ctx.beginPath();
      ctx.arc(s.x, y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${twinkle})`;
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }

  window.addEventListener('scroll', () => { scrollY = window.scrollY; }, { passive: true });
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(draw);
})();

// =====================================================================
// scroll progress bar
// =====================================================================
(function scrollProgress() {
  const bar = document.getElementById('scrollBar');
  function update() {
    const doc = document.documentElement;
    const max = doc.scrollHeight - doc.clientHeight;
    const pct = max > 0 ? (window.scrollY / max) * 100 : 0;
    bar.style.width = pct + '%';
  }
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
})();

// =====================================================================
// plasma star renderer — shared by the morph-circle and the project stars.
// each star is a live-computed noise field (4 combined sine waves) sampled
// through a color ramp, redrawn every frame instead of a static gradient.
// =====================================================================
const PLASMA_RAMPS = {
  white: [
    [0.00, [210, 215, 225]],
    [0.30, [245, 247, 252]],
    [0.55, [255, 255, 255]],
    [0.80, [235, 240, 250]],
    [1.00, [255, 255, 255]],
  ],
  blue: [
    [0.00, [5, 8, 20]],
    [0.32, [13, 45, 130]],
    [0.58, [55, 130, 255]],
    [0.80, [175, 215, 255]],
    [1.00, [255, 255, 255]],
  ],
  cyan: [
    [0.00, [4, 20, 18]],
    [0.32, [10, 90, 80]],
    [0.58, [70, 200, 185]],
    [0.80, [190, 250, 240]],
    [1.00, [255, 255, 255]],
  ],
  gold: [
    [0.00, [20, 14, 4]],
    [0.32, [110, 70, 15]],
    [0.58, [222, 160, 70]],
    [0.80, [255, 220, 160]],
    [1.00, [255, 255, 255]],
  ],
};

function lerpStop(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function blendRamps(rampA, rampB, t) {
  return rampA.map((stop, i) => [stop[0], lerpStop(stop[1], rampB[i][1], t)]);
}

function sampleRamp(ramp, t) {
  t = clamp(t, 0, 1);
  for (let i = 0; i < ramp.length - 1; i++) {
    const [t0, c0] = ramp[i];
    const [t1, c1] = ramp[i + 1];
    if (t >= t0 && t <= t1) return lerpStop(c0, c1, (t - t0) / (t1 - t0));
  }
  return ramp[ramp.length - 1][1];
}

function createPlasmaStar(canvas, getRamp) {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const size = Math.max(1, Math.round(140 * dpr));
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const cx = size / 2, cy = size / 2, radius = size / 2;
  const seed = Math.random() * 1000; // desyncs stars so they don't boil in lockstep

  return function render(t) {
    const ramp = getRamp();
    const time = (prefersReducedMotion ? 0 : t) * 0.00045 + seed;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        // sample at the pixel CENTER (x+0.5), not its corner — otherwise the circle
        // is drawn a fraction of a pixel too small, leaving a transparent sliver at
        // the true edge that reads as a thin dark ring once blurred
        const dx = (x + 0.5) - cx, dy = (y + 0.5) - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const FEATHER = 1.5; // soft cutoff, blurred further by the CSS filter
        if (dist > radius + FEATHER) { data[idx + 3] = 0; continue; }

        let v = Math.sin(x * 0.09 + time * 1.6)
              + Math.sin(y * 0.1 - time * 1.1)
              + Math.sin((x + y) * 0.07 + time * 2.1)
              + Math.sin(dist * 0.14 - time * 2.6);
        v = (v / 4 + 1) / 2;      // normalize 0..1
        v = Math.pow(v, 1.5);     // punchier contrast

        // force full brightness over the last few pixels so the boundary meets the
        // glow as solid color, not a semi-transparent blend that would read as a dark ring
        const RIM = 4;
        if (dist > radius - RIM) v = lerp(v, 1, clamp((dist - (radius - RIM)) / RIM, 0, 1));

        const [r, g, b] = sampleRamp(ramp, v);
        const edgeAlpha = dist > radius - FEATHER
          ? clamp((radius + FEATHER - dist) / (FEATHER * 2), 0, 1)
          : 1;
        data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = Math.round(edgeAlpha * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  };
}

const plasmaStars = [];
function registerPlasmaStar(canvas, getRamp) {
  const entry = { render: createPlasmaStar(canvas, getRamp), active: true };
  plasmaStars.push(entry);
  // pause off-screen stars — no point recomputing noise nobody sees
  new IntersectionObserver((entries) => {
    entry.active = entries[0].isIntersecting;
  }, { rootMargin: '150px' }).observe(canvas);
  return entry;
}

(function plasmaLoop() {
  function frame(t) {
    for (const star of plasmaStars) if (star.active) star.render(t);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

// =====================================================================
// intro video -> Canopus star morph (pinned scroll, single traveling element)
// =====================================================================
(function introMorph() {
  const wrapper = document.getElementById('pinWrapper');
  if (!wrapper) return; // this page has no intro/Canopus pin section (e.g. project detail pages)
  const video = document.getElementById('introVideo');
  const canvas = document.getElementById('introCanvas');
  const canvasCtx = canvas.getContext('2d');
  const stage = document.getElementById('pinStage');
  const morph = document.getElementById('morphCircle');
  const anchor = document.getElementById('starAnchor');
  const copy = document.querySelector('.canopus-copy');
  const scrollCue = document.getElementById('scrollCue');

  // the plasma surface blends live from the blue ramp to the white one as colorT advances
  let plasmaColorT = 0;
  registerPlasmaStar(document.getElementById('morphPlasma'), () =>
    blendRamps(PLASMA_RAMPS.blue, PLASMA_RAMPS.white, plasmaColorT)
  );

  const ease = (t) => t * t * (3 - 2 * t); // smoothstep

  // gradient/shadow keyframes: flat blue circle, no glow (start) -> glowing white Canopus star (end)
  const BLUE = {
    core: [207, 232, 255], mid: [79, 163, 255], edge: [26, 79, 196],
    shadow: [
      { blur: 0, spread: 0, rgb: [79, 163, 255], a: 0 },
      { blur: 0, spread: 0, rgb: [43, 110, 220], a: 0 },
      { blur: 0, spread: 0, rgb: [20, 70, 180], a: 0 },
    ],
  };
  const WHITE = {
    core: [255, 255, 255], mid: [255, 249, 236], edge: [216, 210, 194],
    shadow: [
      { blur: 60, spread: 12, rgb: [211, 244, 255], a: 0.85 },
      { blur: 130, spread: 45, rgb: [255, 246, 220], a: 0.45 },
      { blur: 260, spread: 90, rgb: [255, 240, 200], a: 0.18 },
    ],
  };
  const lerpRgb = (a, b, t) => a.map((v, i) => Math.round(lerp(v, b[i], t)));
  const rgbStr = (rgb, a = 1) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;

  function buildLook(t) {
    const core = lerpRgb(BLUE.core, WHITE.core, t);
    const mid = lerpRgb(BLUE.mid, WHITE.mid, t);
    const edge = lerpRgb(BLUE.edge, WHITE.edge, t);
    const background = `radial-gradient(circle at 38% 32%, ${rgbStr(core)}, ${rgbStr(mid)} 38%, ${rgbStr(edge)} 66%, transparent 72%)`;
    const boxShadow = BLUE.shadow.map((s, i) => {
      const w = WHITE.shadow[i];
      const blur = lerp(s.blur, w.blur, t);
      const spread = lerp(s.spread, w.spread, t);
      const rgb = lerpRgb(s.rgb, w.rgb, t);
      const a = lerp(s.a, w.a, t);
      return `0 0 ${blur}px ${spread}px ${rgbStr(rgb, a)}`;
    }).join(', ');
    return { background, boxShadow };
  }

  let typewriterStarted = false;
  function typewriter() {
    const p = document.getElementById('canopusParagraph');
    const full = p.dataset.text;
    let i = 0;
    p.textContent = '';
    const step = () => {
      p.textContent = full.slice(0, i);
      i++;
      if (i <= full.length) {
        requestAnimationFrame(() => setTimeout(step, 12));
      }
    };
    step();
  }

  let frozen = false;

  // --- pre-render the video into a frame sequence once, so scroll-scrubbing
  // is a cheap canvas draw instead of an expensive <video> seek every tick ---
  const isSmallScreen = window.innerWidth < 700;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const FRAME_COUNT = isSmallScreen ? 44 : 64;
  const frames = [];
  let framesReady = 0;
  canvasCtx.imageSmoothingQuality = 'high';

  function seekTo(t) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        video.removeEventListener('seeked', finish);
        resolve();
      };
      video.addEventListener('seeked', finish);
      video.currentTime = t;
      setTimeout(finish, 300); // safety net if 'seeked' never fires
    });
  }

  async function preloadFrames() {
    const duration = video.duration;
    if (!duration || !isFinite(duration)) return;

    // target the actual on-screen size (CSS px) times device pixel ratio,
    // capped by the source's native resolution — sharp on retina without
    // wasting memory rendering higher than the video actually has
    const displayHeightCss = Math.min(window.innerHeight * 0.86, 900);
    const targetHeight = Math.round(displayHeightCss * dpr);
    const scale = Math.min(1, targetHeight / video.videoHeight);
    const fw = Math.max(1, Math.round(video.videoWidth * scale));
    const fh = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.width = fw;
    canvas.height = fh;

    const tmp = document.createElement('canvas');
    tmp.width = fw;
    tmp.height = fh;
    const tctx = tmp.getContext('2d');
    tctx.imageSmoothingQuality = 'high';

    video.pause();
    for (let i = 0; i < FRAME_COUNT; i++) {
      const t = Math.min((i / (FRAME_COUNT - 1)) * duration, duration - 0.02);
      await seekTo(t);
      tctx.drawImage(video, 0, 0, fw, fh);
      const bitmap = await createImageBitmap(tmp);
      frames.push(bitmap);
      framesReady = frames.length;
      if (i === 0) canvasCtx.drawImage(bitmap, 0, 0);
    }
  }

  if (video.readyState >= 2) {
    preloadFrames();
  } else {
    video.addEventListener('loadeddata', preloadFrames, { once: true });
  }

  let lastFrameIdx = -1;

  function update() {
    const rect = wrapper.getBoundingClientRect();
    const total = wrapper.offsetHeight - window.innerHeight;
    const progress = total > 0 ? clamp(-rect.top / total, 0, 1) : 0;

    // 1. video advances frame-by-frame with scroll — instant canvas draw, no seeking
    if (framesReady > 0) {
      const scrubT = ease(remap(progress, 0, 0.32));
      const idx = Math.min(framesReady - 1, Math.round(scrubT * (FRAME_COUNT - 1)));
      if (idx !== lastFrameIdx) {
        canvasCtx.drawImage(frames[idx], 0, 0);
        lastFrameIdx = idx;
      }
    }

    // 2. canvas fades out once it's finished scrubbing
    const videoOutT = ease(remap(progress, 0.3, 0.5));
    canvas.style.opacity = 1 - videoOutT;
    canvas.style.transform = `translate(-50%, -50%) scale(${lerp(1, 0.94, videoOutT)})`;

    // 3. the single circle travels from behind the video to the star anchor + turns white
    // (starts once the video has mostly faded out, so it doesn't drift off while still visible)
    const travelT = ease(remap(progress, 0.44, 0.86));
    const colorT = ease(remap(progress, 0.5, 0.84));

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const startD = Math.min(vh * 0.62, vw * 0.62) * 0.88; // 10% smaller resting size behind the video
    // read the video/canvas's actual on-screen center (instead of hardcoding vh/2)
    // so the circle always lines up with it, whatever `top` is set to in CSS
    const canvasRect = canvas.getBoundingClientRect();
    const startCx = canvasRect.left + canvasRect.width / 2;
    const isMobileNow = window.innerWidth < 700; // re-checked live, not cached from page load
    const startCy = canvasRect.top + canvasRect.height / 2 - (isMobileNow ? 35 : 60);

    const anchorRect = anchor.getBoundingClientRect();
    const endD = anchorRect.width || startD * 0.4;
    const endCx = anchorRect.left + anchorRect.width / 2;
    const endCy = anchorRect.top + anchorRect.height / 2;

    // handle the fixed <-> absolute transition first, so the travel
    // computation below always runs against a clean, known state this frame
    if (progress >= 0.995 && !frozen) {
      // pin has fully released: freeze the circle in document coordinates
      // so it scrolls away naturally with the rest of the page afterwards
      // #pinStage (position: sticky) is the nearest positioned ancestor, so it becomes
      // morph's containing block once switched to absolute — position relative to ITS
      // rect, not the document (adding window.scrollX/Y here would use the wrong origin
      // and fling the circle far off-screen the instant the pin releases).
      const liveRect = morph.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      morph.style.position = 'absolute';
      morph.style.left = (liveRect.left - stageRect.left) + 'px';
      morph.style.top = (liveRect.top - stageRect.top) + 'px';
      morph.style.transform = 'none';
      frozen = true;
    } else if (progress < 0.995 && frozen) {
      // scrolled back up into the pin range: hand control back to the rAF loop.
      // clear the absolute left/top left over from freezing, otherwise they'd
      // stack on top of the transform-based positioning below and fling the
      // circle off-screen.
      morph.style.position = 'fixed';
      morph.style.left = '0px';
      morph.style.top = '0px';
      frozen = false;
    }

    if (!frozen) {
      const d = lerp(startD, endD, travelT);
      const cx = lerp(startCx, endCx, travelT);
      const cy = lerp(startCy, endCy, travelT);
      morph.style.width = d + 'px';
      morph.style.height = d + 'px';
      morph.style.transform = `translate(${cx - d / 2}px, ${cy - d / 2}px)`;

      morph.style.boxShadow = buildLook(colorT).boxShadow;
      morph.style.filter = `blur(${lerp(2, 0, travelT)}px)`;
      plasmaColorT = colorT; // the plasma canvas reads this every frame on its own rAF loop
    }

    // 4. text fades in as the star settles
    const textT = ease(remap(progress, 0.62, 0.9));
    copy.style.opacity = textT;
    copy.style.transform = `translateY(${lerp(24, 0, textT)}px)`;

    // scroll cue disappears fast
    scrollCue.style.opacity = 1 - remap(progress, 0, 0.08);

    if (!typewriterStarted && progress >= 0.68) {
      typewriterStarted = true;
      typewriter();
    }
  }

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => { update(); ticking = false; });
      ticking = true;
    }
  }, { passive: true });
  window.addEventListener('resize', update);
  update();
})();

// =====================================================================
// project stars — plasma surface, one fixed ramp per accent color
// =====================================================================
(function projectPlasma() {
  document.querySelectorAll('.project-star').forEach((article) => {
    const canvas = article.querySelector('.star-plasma');
    const ramp = PLASMA_RAMPS[article.dataset.accent] || PLASMA_RAMPS.white;
    registerPlasmaStar(canvas, () => ramp);
  });
})();

// =====================================================================
// "coming soon" toast — for project cards not linked to real content yet
// =====================================================================
(function comingSoon() {
  const links = document.querySelectorAll('[data-soon]');
  if (!links.length) return;

  const toast = document.createElement('div');
  toast.className = 'soon-toast';
  document.body.appendChild(toast);

  let hideTimer = null;
  links.forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      toast.textContent = link.dataset.soon;
      toast.classList.add('is-visible');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => toast.classList.remove('is-visible'), 2200);
    });
  });
})();

// =====================================================================
// reveal-on-scroll (projects, contact, etc.)
// =====================================================================
(function reveal() {
  const items = document.querySelectorAll('.reveal');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.2 });
  items.forEach((el) => observer.observe(el));
})();
