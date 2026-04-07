'use strict';

const DIFF = ['Easy', 'Normal', 'Hard', 'Harder', 'Insane', 'Demon'];
const DIFF_CLASS = {
  Easy: 'diff-easy', Normal: 'diff-normal', Hard: 'diff-hard', Harder: 'diff-harder', Insane: 'diff-insane', Demon: 'diff-demon'
};
const GAME_W = 1280;
const GAME_H = 720;
const GROUND_Y = 560;

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

class StorageService {
  constructor() { this.key = 'neonRushSaveV1'; }
  load(levelCount) {
    const raw = localStorage.getItem(this.key);
    const base = {
      unlocked: 1,
      settings: { muted: false, reducedMotion: false },
      stats: { totalAttempts: 0, totalDeaths: 0, totalCoins: 0, levelsCompleted: 0 },
      levels: Array.from({ length: levelCount }, () => ({
        bestPercent: 0,
        bestTime: null,
        coins: [false, false, false],
        normalClear: false,
        practiceClear: false,
        attempts: 0,
        deaths: 0,
        noDeathClear: false,
        firstTryClear: false
      }))
    };
    if (!raw) return base;
    try {
      const parsed = JSON.parse(raw);
      return {
        ...base,
        ...parsed,
        settings: { ...base.settings, ...(parsed.settings || {}) },
        stats: { ...base.stats, ...(parsed.stats || {}) },
        levels: base.levels.map((l, i) => ({ ...l, ...(parsed.levels?.[i] || {}) }))
      };
    } catch { return base; }
  }
  save(data) { localStorage.setItem(this.key, JSON.stringify(data)); }
}

class Input {
  constructor() {
    this.down = false; this.justPressed = false; this.bufferTimer = 0;
    this.bind();
  }
  bind() {
    const fireDown = (e) => {
      if (['Space', 'ArrowUp'].includes(e.code) || e.type === 'pointerdown' || e.type === 'touchstart') {
        e.preventDefault?.();
        if (!this.down) this.justPressed = true;
        this.down = true; this.bufferTimer = 0.12;
      }
    };
    const fireUp = (e) => {
      if (['Space', 'ArrowUp'].includes(e.code) || e.type === 'pointerup' || e.type === 'touchend') {
        this.down = false;
      }
    };
    window.addEventListener('keydown', fireDown);
    window.addEventListener('keyup', fireUp);
    window.addEventListener('pointerdown', fireDown, { passive: false });
    window.addEventListener('pointerup', fireUp);
    window.addEventListener('touchstart', fireDown, { passive: false });
    window.addEventListener('touchend', fireUp);
  }
  step(dt) { if (this.bufferTimer > 0) this.bufferTimer -= dt; }
  consumePress() {
    if (this.justPressed || this.bufferTimer > 0) {
      this.justPressed = false;
      this.bufferTimer = 0;
      return true;
    }
    return false;
  }
}

class AudioEngine {
  constructor() { this.ctx = null; this.muted = false; }
  ensure() { this.ctx ??= new (window.AudioContext || window.webkitAudioContext)(); }
  beep(freq = 440, d = 0.08, type = 'sine', gain = 0.03) {
    if (this.muted) return;
    this.ensure();
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.value = gain;
    o.connect(g); g.connect(this.ctx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + d);
    o.stop(this.ctx.currentTime + d);
  }
  sfx(name) {
    const map = {
      jump: [520, 0.07, 'triangle'], death: [160, 0.15, 'sawtooth', 0.05], coin: [880, 0.08, 'square'],
      portal: [660, 0.08, 'sine'], checkpoint: [300, 0.1, 'triangle'], complete: [980, 0.18, 'sine'], menu: [420, 0.05, 'square']
    };
    this.beep(...(map[name] || [500, 0.05, 'sine']));
  }
}

class LevelFactory {
  static build() {
    const defs = [
      ['Pulse Initiation', 'Easy', 'Learn jumps and beat spacing.', ['cube'], 130, '#1f2f7f', '#00e8ff'],
      ['Grid Bounce', 'Easy', 'Pads and rings with roomy timing.', ['cube', 'robot'], 138, '#10375d', '#22ffb8'],
      ['Gravity Lesson', 'Normal', 'Gravity flips over mirrored hazards.', ['cube', 'ball'], 144, '#341b64', '#ff7dff'],
      ['Vector Drift', 'Normal', 'Ship flight and tunnel precision.', ['ship', 'cube'], 148, '#123049', '#58d7ff'],
      ['Neon Switch', 'Hard', 'Rapid portals and speed jolts.', ['cube', 'ship', 'ball'], 154, '#3d1c2b', '#ff5f8f'],
      ['Fracture Drive', 'Hard', 'Moving platforms and bait blocks.', ['cube', 'robot', 'dash'], 158, '#2b2f18', '#cbff52'],
      ['Dual Spark', 'Harder', 'Dual mode mirrored pressure lanes.', ['dual', 'cube', 'wave'], 164, '#1c2d4a', '#71b8ff'],
      ['Circuit Vortex', 'Harder', 'Wave to ship transitions.', ['wave', 'ship', 'cube'], 170, '#1b2a2d', '#66ffe8'],
      ['Helix Collapse', 'Insane', 'Dense portals and fake-outs.', ['ball', 'spider', 'cube'], 176, '#3f1e44', '#ff77dc'],
      ['Night Reactor', 'Insane', 'Fast rhythm and disappearing blocks.', ['cube', 'wave', 'dash'], 182, '#3d2018', '#ffb26c'],
      ['Omega Corridor', 'Demon', 'Expert gauntlet with dual bursts.', ['ship', 'dual', 'spider'], 188, '#1c1c1f', '#ff5b78'],
      ['Final Overdrive', 'Demon', 'Multi-phase finale and cinematic finish.', ['cube', 'ship', 'wave', 'dash'], 194, '#1a123a', '#a88dff']
    ];
    return defs.map((d, i) => LevelFactory.makeLevel(i, ...d));
  }

  static makeLevel(index, title, difficulty, description, modes, bpm, bg, accent) {
    const length = 260 + index * 30;
    const beat = 60 / bpm;
    const objects = [];
    const portals = [];
    const checkpoints = [];
    const coins = [];
    for (let x = 20; x < length - 12; x += 8) {
      const phase = (x / 8 + index) % 8;
      if (phase <= 2) objects.push({ type: 'spike', x, y: GROUND_Y - 26, w: 28, h: 26 });
      if (phase === 5) objects.push({ type: 'block', x, y: GROUND_Y - 80, w: 34, h: 34, moving: index > 4 ? ((x % 3) - 1) * 20 : 0 });
      if (phase === 6 && index > 2) objects.push({ type: 'laser', x, y: GROUND_Y - 140, w: 20, h: 140, pulse: true });
      if (phase === 3 && index > 5) objects.push({ type: 'saw', x, y: GROUND_Y - 60, r: 20 + (index % 3) * 6 });
      if (phase === 1 && index > 6) objects.push({ type: 'fake', x, y: GROUND_Y - 34, w: 34, h: 34 });
    }
    const modeCycle = ['cube', 'ship', 'ball', 'wave', 'robot', 'spider', 'dash', 'dual'];
    for (let p = 45; p < length - 20; p += 35) {
      portals.push({ type: 'mode', mode: modeCycle[(Math.floor(p / 35) + index) % modeCycle.length], x: p, y: GROUND_Y - 130 });
      if (p % 70 === 0) portals.push({ type: 'gravity', x: p + 8, y: GROUND_Y - 180 });
      if (p % 105 === 0) portals.push({ type: 'speed', mul: 1 + ((index + p) % 3) * 0.2, x: p + 12, y: GROUND_Y - 100 });
    }
    for (let c = 60; c < length - 8; c += Math.floor(length / 4)) {
      coins.push({ x: c, y: GROUND_Y - 180 - ((c + index * 11) % 120), collected: false });
    }
    for (let cp = 50; cp < length; cp += 45) checkpoints.push(cp);

    return {
      id: index,
      title,
      difficulty,
      description,
      bpm,
      beat,
      bg,
      accent,
      modes,
      length,
      startSpeed: 300 + index * 15,
      objects,
      portals,
      coins,
      checkpoints
    };
  }
}

class Player {
  constructor() { this.reset(); }
  reset() {
    this.x = 220; this.y = GROUND_Y - 38; this.w = 38; this.h = 38;
    this.vx = 0; this.vy = 0; this.mode = 'cube'; this.gravity = 1; this.rotation = 0;
    this.coyote = 0; this.alive = true; this.dashing = 0; this.dualMirror = false;
  }
  onGround() { return this.gravity > 0 ? this.y + this.h >= GROUND_Y : this.y <= 80; }
  jump(power = 760) { this.vy = -power * this.gravity; }
  update(dt, input, worldSpeed) {
    this.coyote = this.onGround() ? 0.08 : Math.max(0, this.coyote - dt);
    const press = input.consumePress();

    switch (this.mode) {
      case 'cube':
        if (press && (this.onGround() || this.coyote > 0)) this.jump(760);
        break;
      case 'ship':
        this.vy += input.down ? -1600 * dt * this.gravity : 1400 * dt * this.gravity;
        break;
      case 'ball':
        if (press) this.gravity *= -1;
        break;
      case 'wave':
        this.vy = (input.down ? -520 : 520) * this.gravity;
        break;
      case 'robot':
        if (press && (this.onGround() || this.coyote > 0)) this.jump(input.down ? 980 : 740);
        break;
      case 'spider':
        if (press) this.y = this.gravity > 0 ? 110 : GROUND_Y - this.h - 6;
        break;
      case 'dash':
        if (press && this.dashing <= 0) this.dashing = 0.18;
        if (this.dashing > 0) { this.dashing -= dt; this.vx = worldSpeed * 1.6; }
        else this.vx = worldSpeed;
        break;
      case 'dual':
        if (press && (this.onGround() || this.coyote > 0)) this.jump(770);
        this.dualMirror = true;
        break;
      default:
        break;
    }

    if (!['ship', 'wave'].includes(this.mode)) this.vy += 2200 * dt * this.gravity;

    this.x += (this.vx || worldSpeed) * dt;
    this.y += this.vy * dt;
    this.rotation += dt * (this.mode === 'ship' ? 2 : 8) * Math.sign(this.vy || 1);

    const floor = GROUND_Y - this.h;
    const ceil = 80;
    if (this.gravity > 0 && this.y > floor) { this.y = floor; this.vy = 0; }
    if (this.gravity < 0 && this.y < ceil) { this.y = ceil; this.vy = 0; }

    if (this.y < -180 || this.y > GAME_H + 180) this.alive = false;
  }
}

class Game {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.input = new Input();
    this.audio = new AudioEngine();
    this.levels = LevelFactory.build();
    this.storage = new StorageService();
    this.save = this.storage.load(this.levels.length);

    this.state = 'main';
    this.current = null;
    this.player = new Player();
    this.worldX = 0;
    this.worldSpeed = 320;
    this.practice = false;
    this.paused = false;
    this.time = 0;
    this.lastBeat = 0;
    this.camShake = 0;
    this.reducedMotion = this.save.settings.reducedMotion;
    this.bindUI();
    this.renderMenus();
    this.loop(performance.now());
  }

  bindUI() {
    document.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => this.openScreen(b.dataset.nav)));
    document.getElementById('resumeBtn').onclick = () => this.togglePause(false);
    document.getElementById('restartBtn').onclick = () => this.restartLevel();
    document.getElementById('pauseMenuBtn').onclick = () => { this.togglePause(false); this.openScreen('levels'); };
    document.getElementById('nextLevelBtn').onclick = () => this.startLevel(Math.min(this.current.id + 1, this.levels.length - 1), false);
    document.getElementById('replayLevelBtn').onclick = () => this.startLevel(this.current.id, this.practice);
    document.getElementById('completeMenuBtn').onclick = () => this.openScreen('levels');

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyR' && this.current) this.restartLevel();
      if (e.code === 'Escape' && this.current) this.togglePause(!this.paused);
    });

    const tapBtn = document.getElementById('tapBtn');
    tapBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.input.down = true; this.input.justPressed = true; });
    tapBtn.addEventListener('pointerup', () => { this.input.down = false; });
  }

  openScreen(name) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    const map = { main: 'screen-main', levels: 'screen-levels', stats: 'screen-stats', settings: 'screen-settings', credits: 'screen-credits', game: 'screen-game' };
    document.getElementById(map[name]).classList.add('active');
    this.state = name;
    this.audio.sfx('menu');
    if (name !== 'game') this.current = null;
    if (name === 'levels') this.renderLevels();
    if (name === 'stats') this.renderStats();
    if (name === 'settings') this.renderSettings();
  }

  renderMenus() {
    this.openScreen('main');
    this.renderTopStats();
    document.getElementById('screen-credits').innerHTML = `<div class="card hero"><h2>Credits</h2><p>Design & code: Codex Arcade Systems.</p><p>Inspired by rhythm platformer classics and built for instant browser play.</p><button class="btn" data-nav="main">Back</button></div>`;
    document.querySelector('#screen-credits [data-nav="main"]').onclick = () => this.openScreen('main');
  }

  renderTopStats() {
    const s = this.save.stats;
    document.getElementById('topStats').innerHTML = `Levels ${s.levelsCompleted}/${this.levels.length}<br>Coins ${s.totalCoins} • Attempts ${s.totalAttempts}`;
  }

  renderLevels() {
    const el = document.getElementById('screen-levels');
    el.innerHTML = `<div class="actions" style="margin-bottom:10px"><button class="btn" data-back>Back</button><button class="btn" data-practice>Toggle Practice: ${this.practice ? 'ON' : 'OFF'}</button></div><div class="level-grid"></div>`;
    el.querySelector('[data-back]').onclick = () => this.openScreen('main');
    el.querySelector('[data-practice]').onclick = () => { this.practice = !this.practice; this.renderLevels(); };
    const grid = el.querySelector('.level-grid');

    this.levels.forEach((lvl, i) => {
      const progress = this.save.levels[i];
      const locked = i + 1 > this.save.unlocked;
      const coins = progress.coins.filter(Boolean).length;
      const card = document.createElement('article');
      card.className = `card level-card ${locked ? 'locked' : ''}`;
      card.innerHTML = `<span class="badge ${DIFF_CLASS[lvl.difficulty]}">${lvl.difficulty}</span><h3>${i + 1}. ${lvl.title}</h3><p>${lvl.description}</p><p>Modes: ${lvl.modes.join(', ')}</p><p>Best ${Math.floor(progress.bestPercent)}% • Coins ${coins}/3</p><div class="progress"><span style="width:${progress.bestPercent}%"></span></div><div class="actions"><button class="btn primary" ${locked ? 'disabled' : ''}>Play</button></div>`;
      card.querySelector('button').onclick = () => this.startLevel(i, this.practice);
      grid.appendChild(card);
    });
  }

  renderStats() {
    const s = this.save.stats;
    const achievements = [
      ['Complete 5 levels', s.levelsCompleted >= 5],
      ['Collect 10 coins', s.totalCoins >= 10],
      ['Beat a Demon level', this.levels.some((l, i) => l.difficulty === 'Demon' && this.save.levels[i].normalClear)],
      ['No-checkpoint practice clear', this.save.levels.some((l) => l.practiceClear)]
    ];
    document.getElementById('screen-stats').innerHTML = `<div class="card hero"><h2>Stats</h2><p>Total Attempts: ${s.totalAttempts} | Deaths: ${s.totalDeaths} | Coins: ${s.totalCoins}</p><ul>${achievements.map((a) => `<li>${a[1] ? '✅' : '⬜'} ${a[0]}</li>`).join('')}</ul><button class="btn" data-back>Back</button></div>`;
    document.querySelector('#screen-stats [data-back]').onclick = () => this.openScreen('main');
  }

  renderSettings() {
    const wrap = document.getElementById('screen-settings');
    wrap.innerHTML = `<div class="card hero"><h2>Settings</h2><div class="actions"><button class="btn" data-mute>Mute: ${this.save.settings.muted ? 'ON' : 'OFF'}</button><button class="btn" data-motion>Reduced Motion: ${this.save.settings.reducedMotion ? 'ON' : 'OFF'}</button><button class="btn" data-full>Fullscreen</button></div><p>Controls: Space / Up / Click / Tap to jump, hold for sustained modes. R restart. Esc pause.</p><button class="btn" data-back>Back</button></div>`;
    wrap.querySelector('[data-mute]').onclick = () => { this.save.settings.muted = !this.save.settings.muted; this.audio.muted = this.save.settings.muted; this.persist(); this.renderSettings(); };
    wrap.querySelector('[data-motion]').onclick = () => { this.save.settings.reducedMotion = !this.save.settings.reducedMotion; this.reducedMotion = this.save.settings.reducedMotion; this.persist(); this.renderSettings(); };
    wrap.querySelector('[data-full]').onclick = () => document.documentElement.requestFullscreen?.();
    wrap.querySelector('[data-back]').onclick = () => this.openScreen('main');
  }

  startLevel(index, practice) {
    document.getElementById('screen-complete').classList.remove('active');
    document.getElementById('screen-pause').classList.remove('active');
    this.current = JSON.parse(JSON.stringify(this.levels[index]));
    this.practice = practice;
    this.player.reset();
    this.worldX = 0;
    this.worldSpeed = this.current.startSpeed;
    this.time = 0;
    this.lastBeat = 0;
    this.paused = false;
    this.save.stats.totalAttempts++;
    this.save.levels[index].attempts++;
    this.save.levels[index].runDeaths = 0;
    this.lastCheckpoint = 0;
    this.coinsGrabbed = 0;
    this.trail = [];
    this.openScreen('game');
    this.persist();
  }

  restartLevel() {
    if (!this.current) return;
    if (this.practice && this.lastCheckpoint > 0) {
      this.worldX = this.lastCheckpoint;
      this.player.reset();
      this.player.x = 220 + this.lastCheckpoint * 10;
      this.audio.sfx('checkpoint');
      return;
    }
    this.startLevel(this.current.id, this.practice);
  }

  togglePause(v) {
    this.paused = v;
    document.getElementById('screen-pause').classList.toggle('active', v);
  }

  fail() {
    this.audio.sfx('death');
    this.camShake = 14;
    this.save.stats.totalDeaths++;
    this.save.levels[this.current.id].deaths++;
    this.save.levels[this.current.id].runDeaths = (this.save.levels[this.current.id].runDeaths || 0) + 1;
    this.persist();
    this.restartLevel();
  }

  collectCoin(c) {
    if (c.collected) return;
    c.collected = true;
    this.coinsGrabbed++;
    this.audio.sfx('coin');
  }

  completeLevel() {
    const l = this.save.levels[this.current.id];
    const clearType = this.practice ? 'practiceClear' : 'normalClear';
    l[clearType] = true;
    l.bestPercent = 100;
    if (!l.bestTime || this.time < l.bestTime) l.bestTime = this.time;
    this.current.coins.forEach((c, i) => {
      if (c.collected && !l.coins[i]) { l.coins[i] = true; this.save.stats.totalCoins++; }
    });
    if (!this.practice && l.runDeaths === 0) l.noDeathClear = true;
    if (!this.practice && l.attempts === 1) l.firstTryClear = true;
    this.save.unlocked = Math.max(this.save.unlocked, this.current.id + 2);
    this.save.stats.levelsCompleted = this.save.levels.filter((lv) => lv.normalClear).length;
    this.persist();
    this.audio.sfx('complete');

    const badges = [
      l.normalClear && 'Normal Clear',
      l.practiceClear && 'Practice Clear',
      l.coins.every(Boolean) && 'Coin Clear',
      l.noDeathClear && 'No Death',
      l.firstTryClear && 'First Try'
    ].filter(Boolean);

    document.getElementById('completeTitle').textContent = `${this.current.title} Complete`;
    document.getElementById('completeMeta').textContent = `${this.practice ? 'Practice' : 'Normal'} run • ${this.coinsGrabbed}/3 coins • ${this.time.toFixed(2)}s`;
    document.getElementById('completeBadges').innerHTML = badges.map((b) => `<span class="badge diff-normal">${b}</span>`).join('');
    document.getElementById('screen-complete').classList.add('active');
  }

  update(dt) {
    if (!this.current || this.paused || this.state !== 'game') return;
    this.input.step(dt);
    this.time += dt;
    this.worldX += this.worldSpeed * dt / 100;

    // Beat pulse support for synced visuals.
    const beatIdx = Math.floor(this.time / this.current.beat);
    if (beatIdx > this.lastBeat) {
      this.lastBeat = beatIdx;
      if (!this.reducedMotion) this.camShake = Math.min(8, this.camShake + 2);
    }

    // Practice checkpoints.
    if (this.practice) {
      const nextCp = this.current.checkpoints.find((cp) => cp > this.lastCheckpoint && cp <= this.worldX);
      if (nextCp) { this.lastCheckpoint = nextCp; this.audio.sfx('checkpoint'); }
    }

    // Portals.
    for (const p of this.current.portals) {
      if (p.hit) continue;
      if (Math.abs(this.worldX - p.x) < 0.6) {
        p.hit = true;
        if (p.type === 'gravity') this.player.gravity *= -1;
        if (p.type === 'speed') this.worldSpeed = this.current.startSpeed * p.mul;
        if (p.type === 'mode') this.player.mode = p.mode;
        this.audio.sfx('portal');
      }
    }

    this.player.update(dt, this.input, this.worldSpeed);

    // Coin checks.
    for (const c of this.current.coins) {
      const wx = c.x * 10 - this.worldX * 10 + this.player.x;
      if (!c.collected && Math.hypot(wx - this.player.x, c.y - this.player.y) < 35) this.collectCoin(c);
    }

    // Hazards & solids collision.
    for (const o of this.current.objects) {
      const ox = o.x * 10 - this.worldX * 10 + this.player.x;
      const oy = o.y + (o.moving ? Math.sin(this.time * 2 + o.x) * o.moving : 0);
      const isSolid = ['block', 'fake'].includes(o.type);
      const px = this.player.x, py = this.player.y;
      const overlap = ox < px + this.player.w && ox + (o.w || o.r * 2) > px && oy < py + this.player.h && oy + (o.h || o.r * 2) > py;
      if (!overlap) continue;

      if (o.type === 'block' || o.type === 'fake') {
        const prevY = py - this.player.vy * 0.016;
        if (prevY + this.player.h <= oy + 10 && this.player.gravity > 0 && o.type === 'block') {
          this.player.y = oy - this.player.h;
          this.player.vy = 0;
        } else if (o.type === 'fake') {
          this.fail();
          return;
        } else {
          this.fail();
          return;
        }
      } else {
        if (o.type === 'laser' && o.pulse && Math.sin(this.time * 10 + o.x) < 0) continue;
        this.fail();
        return;
      }
    }

    const percent = clamp((this.worldX / this.current.length) * 100, 0, 100);
    this.save.levels[this.current.id].bestPercent = Math.max(this.save.levels[this.current.id].bestPercent, percent);

    document.getElementById('hudLevel').textContent = `${this.current.id + 1}. ${this.current.title}`;
    document.getElementById('hudMode').textContent = `${this.practice ? 'Practice' : 'Normal'} • ${this.player.mode.toUpperCase()}`;
    document.getElementById('hudProgress').textContent = `${Math.floor(percent)}%`;
    document.getElementById('hudCoins').textContent = `◈ ${this.coinsGrabbed}/3`;

    if (percent >= 100) {
      this.completeLevel();
      return;
    }

    if (!this.player.alive) this.fail();
  }

  drawBackground() {
    const ctx = this.ctx;
    const lvl = this.current;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * Math.PI * 2 / lvl.beat);
    ctx.fillStyle = lvl.bg;
    ctx.fillRect(0, 0, GAME_W, GAME_H);
    for (let i = 0; i < 26; i++) {
      const y = (i * 80 + (this.worldX * (6 + i * 0.2))) % (GAME_H + 80);
      ctx.fillStyle = `rgba(255,255,255,${0.02 + (i % 5) * 0.01})`;
      ctx.fillRect((i * 120 - this.worldX * 18) % (GAME_W + 180), y, 2, 70);
    }
    ctx.fillStyle = `${lvl.accent}22`;
    ctx.fillRect(0, GROUND_Y + 38, GAME_W, GAME_H - GROUND_Y);
    if (!this.reducedMotion) {
      ctx.fillStyle = `${lvl.accent}${Math.floor(80 + pulse * 90).toString(16).padStart(2, '0')}`;
      ctx.fillRect(0, 0, GAME_W, 5 + pulse * 6);
    }
  }

  renderGame() {
    if (!this.current || this.state !== 'game') return;
    const ctx = this.ctx;
    const shake = this.reducedMotion ? 0 : this.camShake;
    this.camShake = Math.max(0, this.camShake - 0.9);
    ctx.save();
    ctx.clearRect(0, 0, GAME_W, GAME_H);
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    this.drawBackground();

    // Draw portals.
    for (const p of this.current.portals) {
      const x = p.x * 10 - this.worldX * 10 + this.player.x;
      if (x < -80 || x > GAME_W + 80) continue;
      ctx.strokeStyle = p.type === 'mode' ? '#00e8ff' : p.type === 'gravity' ? '#ff4fd8' : '#ffd84a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, p.y, 24, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Draw objects.
    for (const o of this.current.objects) {
      const x = o.x * 10 - this.worldX * 10 + this.player.x;
      if (x < -100 || x > GAME_W + 100) continue;
      const y = o.y + (o.moving ? Math.sin(this.time * 2 + o.x) * o.moving : 0);
      if (o.type === 'spike') {
        ctx.fillStyle = '#ff5f7f';
        ctx.beginPath();
        ctx.moveTo(x, y + o.h);
        ctx.lineTo(x + o.w / 2, y);
        ctx.lineTo(x + o.w, y + o.h);
        ctx.closePath();
        ctx.fill();
      } else if (o.type === 'saw') {
        ctx.strokeStyle = '#ff9db0';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x + o.r, y + o.r, o.r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const a = o.type === 'laser' ? 0.8 : 1;
        ctx.fillStyle = o.type === 'fake' ? '#6868aa99' : o.type === 'block' ? '#6fe7ff' : `rgba(255,88,88,${a})`;
        ctx.fillRect(x, y, o.w || o.r * 2, o.h || o.r * 2);
      }
    }

    // Coins.
    for (const c of this.current.coins) {
      if (c.collected) continue;
      const x = c.x * 10 - this.worldX * 10 + this.player.x;
      ctx.fillStyle = '#ffd84a';
      ctx.beginPath();
      ctx.arc(x, c.y, 11 + Math.sin(this.time * 8 + c.x) * 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Trail.
    this.trail.push({ x: this.player.x, y: this.player.y + this.player.h / 2, t: 0.6 });
    this.trail = this.trail.filter((p) => (p.t -= 0.016) > 0);
    for (const t of this.trail) {
      ctx.fillStyle = `rgba(0,232,255,${t.t})`;
      ctx.fillRect(t.x - t.t * 40, t.y, 10 * t.t, 4);
    }

    // Player.
    ctx.save();
    ctx.translate(this.player.x + this.player.w / 2, this.player.y + this.player.h / 2);
    ctx.rotate(this.player.rotation);
    ctx.fillStyle = this.current.accent;
    ctx.fillRect(-this.player.w / 2, -this.player.h / 2, this.player.w, this.player.h);
    ctx.fillStyle = '#fff';
    ctx.fillRect(-8, -8, 6, 6);
    ctx.restore();

    if (this.player.dualMirror) {
      ctx.fillStyle = '#ffffff44';
      ctx.fillRect(this.player.x + 120, GAME_H - this.player.y - 140, this.player.w, this.player.h);
    }

    ctx.restore();
  }

  persist() { this.storage.save(this.save); this.renderTopStats(); }

  loop(t) {
    const dt = clamp((t - (this.prev || t)) / 1000, 0, 0.033);
    this.prev = t;
    if (!document.getElementById('screen-complete').classList.contains('active')) this.update(dt);
    this.renderGame();
    requestAnimationFrame((n) => this.loop(n));
  }
}

new Game();

// Completion screen actions that should always close overlay.
document.getElementById('screen-complete').addEventListener('click', (e) => {
  if (e.target.id === 'screen-complete') e.currentTarget.classList.remove('active');
});
