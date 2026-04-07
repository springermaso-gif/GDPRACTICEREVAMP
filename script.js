'use strict';

const GAME_W = 1280;
const GAME_H = 720;
const FLOOR_Y = 560;

const DIFF_CLS = {
  Easy: 'diff-easy',
  Normal: 'diff-normal',
  Hard: 'diff-hard',
  Harder: 'diff-harder',
  Insane: 'diff-insane',
  Demon: 'diff-demon'
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

class SaveSystem {
  constructor(levelCount) {
    this.key = 'neonRush_save_v2';
    this.state = this.load(levelCount);
  }
  emptyLevel() {
    return {
      bestPercent: 0,
      bestTime: null,
      normalClear: false,
      practiceClear: false,
      attempts: 0,
      deaths: 0,
      runDeaths: 0,
      coins: [false, false, false],
      noDeathClear: false,
      firstTryClear: false
    };
  }
  load(levelCount) {
    const base = {
      unlocked: 1,
      settings: { muted: false, reducedMotion: false },
      stats: { totalAttempts: 0, totalDeaths: 0, totalCoins: 0, levelsCompleted: 0 },
      levels: Array.from({ length: levelCount }, () => this.emptyLevel())
    };
    const raw = localStorage.getItem(this.key);
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
    } catch {
      return base;
    }
  }
  persist() { localStorage.setItem(this.key, JSON.stringify(this.state)); }
}

class InputSystem {
  constructor() {
    this.down = false;
    this.justPressed = false;
    this.buffer = 0;

    const downHandler = (e) => {
      const validKey = e.type.startsWith('pointer') || e.type.startsWith('touch') || ['Space', 'ArrowUp'].includes(e.code);
      if (!validKey) return;
      e.preventDefault?.();
      if (!this.down) this.justPressed = true;
      this.down = true;
      this.buffer = 0.12;
    };

    const upHandler = (e) => {
      const validKey = e.type.startsWith('pointer') || e.type.startsWith('touch') || ['Space', 'ArrowUp'].includes(e.code);
      if (!validKey) return;
      this.down = false;
    };

    window.addEventListener('keydown', downHandler);
    window.addEventListener('keyup', upHandler);
    window.addEventListener('pointerdown', downHandler, { passive: false });
    window.addEventListener('pointerup', upHandler);
    window.addEventListener('touchstart', downHandler, { passive: false });
    window.addEventListener('touchend', upHandler);
  }
  tick(dt) { this.buffer = Math.max(0, this.buffer - dt); }
  consumePress() {
    if (this.justPressed || this.buffer > 0) {
      this.justPressed = false;
      this.buffer = 0;
      return true;
    }
    return false;
  }
}

class AudioSystem {
  constructor(muted = false) {
    this.muted = muted;
    this.ctx = null;
  }
  init() { this.ctx ??= new (window.AudioContext || window.webkitAudioContext)(); }
  play(freq = 500, dur = 0.07, wave = 'sine', gain = 0.03) {
    if (this.muted) return;
    this.init();
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = wave;
    osc.frequency.value = freq;
    amp.gain.value = gain;
    osc.connect(amp);
    amp.connect(this.ctx.destination);
    osc.start();
    amp.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
    osc.stop(this.ctx.currentTime + dur);
  }
  sfx(type) {
    const map = {
      jump: [560, 0.06, 'triangle'],
      death: [170, 0.15, 'sawtooth', 0.05],
      coin: [900, 0.07, 'square'],
      portal: [680, 0.08, 'sine'],
      checkpoint: [330, 0.08, 'triangle'],
      complete: [1000, 0.18, 'sine'],
      menu: [440, 0.05, 'square']
    };
    this.play(...(map[type] || [500, 0.05, 'sine']));
  }
}

class LevelRegistry {
  static build() {
    const base = [
      ['Pulse Start', 'Easy', 'Foundational rhythm jumps and spacing.', ['cube'], 128, '#1e2e75', '#2ff4ff'],
      ['Grid Sprint', 'Easy', 'Pads, rings, and confidence builders.', ['cube', 'robot'], 134, '#103866', '#56ffbf'],
      ['Flip Theory', 'Normal', 'Gravity flip lanes and mirrored reads.', ['cube', 'ball'], 140, '#351d61', '#ff85ff'],
      ['Drift Tunnel', 'Normal', 'Ship precision through compressed gaps.', ['ship', 'cube'], 146, '#14304b', '#74e2ff'],
      ['Voltage Sync', 'Hard', 'Speed shifts and trap transitions.', ['cube', 'ship', 'ball'], 152, '#3f1e2f', '#ff6b94'],
      ['Shatter Line', 'Hard', 'Moving blocks and bait geometry.', ['cube', 'robot', 'dash'], 158, '#2f3419', '#d8ff5e'],
      ['Dual Pressure', 'Harder', 'Mirrored dual segments and fake safety.', ['dual', 'cube', 'wave'], 164, '#1d2f4d', '#79beff'],
      ['Circuit Spiral', 'Harder', 'Wave + ship handoff sections.', ['wave', 'ship', 'cube'], 170, '#1b2e30', '#70ffe8'],
      ['Helix Break', 'Insane', 'Dense routing and fake blocks.', ['ball', 'spider', 'cube'], 176, '#42204a', '#ff7de0'],
      ['Reactor Blackout', 'Insane', 'Pulse lasers and vanish windows.', ['cube', 'wave', 'dash'], 182, '#3d2017', '#ffbc71'],
      ['Omega Gauntlet', 'Demon', 'Relentless mode chains and fast reads.', ['ship', 'dual', 'spider'], 188, '#1d1d1f', '#ff647f'],
      ['Overdrive Finale', 'Demon', 'Cinematic final with phase climax.', ['cube', 'ship', 'wave', 'dash'], 194, '#1b133d', '#b299ff']
    ];
    return base.map((entry, i) => this.generate(i, ...entry));
  }

  static generate(index, title, difficulty, description, modes, bpm, bg, accent) {
    const beat = 60 / bpm;
    const length = 260 + index * 34;
    const objs = [];
    const portals = [];
    const checkpoints = [];
    const coins = [];

    for (let x = 18; x < length - 10; x += 8) {
      const m = (Math.floor(x / 8) + index) % 9;
      if (m <= 2) objs.push({ kind: 'spike', x, y: FLOOR_Y - 28, w: 28, h: 28 });
      if (m === 4) objs.push({ kind: 'block', x, y: FLOOR_Y - 84, w: 36, h: 36, moveAmp: index > 4 ? 18 : 0 });
      if (m === 6 && index > 2) objs.push({ kind: 'laser', x, y: FLOOR_Y - 150, w: 18, h: 150, pulse: true });
      if (m === 7 && index > 5) objs.push({ kind: 'saw', x, y: FLOOR_Y - 64, r: 18 + (index % 3) * 5 });
      if (m === 1 && index > 7) objs.push({ kind: 'fake', x, y: FLOOR_Y - 36, w: 34, h: 34 });
    }

    const modeOrder = ['cube', 'ship', 'ball', 'wave', 'robot', 'spider', 'dash', 'dual'];
    for (let x = 40; x < length - 16; x += 34) {
      portals.push({ kind: 'mode', mode: modeOrder[(Math.floor(x / 34) + index) % modeOrder.length], x, y: FLOOR_Y - 128 });
      if (x % 68 === 0) portals.push({ kind: 'gravity', x: x + 8, y: FLOOR_Y - 180 });
      if (x % 102 === 0) portals.push({ kind: 'speed', x: x + 14, y: FLOOR_Y - 100, mul: 1 + ((x + index) % 3) * 0.2 });
    }

    for (let cp = 48; cp < length; cp += 46) checkpoints.push(cp);
    for (let c = 56; c < length - 14; c += Math.floor(length / 4)) {
      coins.push({ x: c, y: FLOOR_Y - 180 - ((c * 7 + index * 20) % 110), collected: false });
    }

    return {
      id: index,
      title,
      difficulty,
      description,
      modes,
      bpm,
      beat,
      bg,
      accent,
      length,
      startSpeed: 300 + index * 16,
      objects: objs,
      portals,
      checkpoints,
      coins
    };
  }
}

class Player {
  constructor() { this.reset(); }
  reset() {
    this.x = 220;
    this.y = FLOOR_Y - 38;
    this.w = 38;
    this.h = 38;
    this.vy = 0;
    this.mode = 'cube';
    this.gravity = 1;
    this.rotation = 0;
    this.coyote = 0;
    this.alive = true;
    this.dashTimer = 0;
    this.showDualGhost = false;
  }
  onGround() {
    return this.gravity > 0 ? this.y + this.h >= FLOOR_Y : this.y <= 82;
  }
  jump(force = 760) {
    this.vy = -force * this.gravity;
  }
  tick(dt, input, speed) {
    this.coyote = this.onGround() ? 0.09 : Math.max(0, this.coyote - dt);
    const press = input.consumePress();
    this.showDualGhost = this.mode === 'dual';

    if (this.mode === 'cube' && press && (this.onGround() || this.coyote > 0)) this.jump(760);
    if (this.mode === 'ship') this.vy += (input.down ? -1600 : 1400) * dt * this.gravity;
    if (this.mode === 'ball' && press) this.gravity *= -1;
    if (this.mode === 'wave') this.vy = (input.down ? -520 : 520) * this.gravity;
    if (this.mode === 'robot' && press && (this.onGround() || this.coyote > 0)) this.jump(input.down ? 980 : 740);
    if (this.mode === 'spider' && press) this.y = this.gravity > 0 ? 112 : FLOOR_Y - this.h - 6;
    if (this.mode === 'dash') {
      if (press && this.dashTimer <= 0) this.dashTimer = 0.18;
      this.dashTimer = Math.max(0, this.dashTimer - dt);
    }
    if (this.mode === 'dual' && press && (this.onGround() || this.coyote > 0)) this.jump(770);

    if (!['ship', 'wave'].includes(this.mode)) this.vy += 2200 * dt * this.gravity;
    const vx = this.mode === 'dash' && this.dashTimer > 0 ? speed * 1.65 : speed;

    this.x += vx * dt;
    this.y += this.vy * dt;
    this.rotation += dt * (this.mode === 'ship' ? 2.2 : 8) * Math.sign(this.vy || 1);

    if (this.gravity > 0 && this.y + this.h > FLOOR_Y) { this.y = FLOOR_Y - this.h; this.vy = 0; }
    if (this.gravity < 0 && this.y < 82) { this.y = 82; this.vy = 0; }

    if (this.y < -180 || this.y > GAME_H + 180) this.alive = false;
  }
}

class NeonRushGame {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.ctx = this.canvas.getContext('2d');

    this.levels = LevelRegistry.build();
    this.save = new SaveSystem(this.levels.length);
    this.input = new InputSystem();
    this.audio = new AudioSystem(this.save.state.settings.muted);

    this.player = new Player();
    this.currentLevel = null;
    this.state = 'main';
    this.practice = false;
    this.paused = false;

    this.worldUnits = 0;
    this.speed = 320;
    this.time = 0;
    this.lastBeat = 0;
    this.shake = 0;
    this.lastCheckpoint = 0;
    this.coinsRun = 0;
    this.trail = [];

    this.bindUI();
    this.renderTopStats();
    this.openScreen('main');
    this.loop(performance.now());
  }

  bindUI() {
    document.querySelectorAll('[data-nav]').forEach((btn) => btn.addEventListener('click', () => this.openScreen(btn.dataset.nav)));
    document.getElementById('resumeBtn').onclick = () => this.setPause(false);
    document.getElementById('restartBtn').onclick = () => this.restartLevel();
    document.getElementById('pauseMenuBtn').onclick = () => { this.setPause(false); this.openScreen('levels'); };
    document.getElementById('nextLevelBtn').onclick = () => this.startLevel(Math.min(this.currentLevel.id + 1, this.levels.length - 1), false);
    document.getElementById('replayLevelBtn').onclick = () => this.startLevel(this.currentLevel.id, this.practice);
    document.getElementById('completeMenuBtn').onclick = () => this.openScreen('levels');

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyR' && this.currentLevel) this.restartLevel();
      if (e.code === 'Escape' && this.currentLevel) this.setPause(!this.paused);
    });

    const tapBtn = document.getElementById('tapBtn');
    tapBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.input.down = true; this.input.justPressed = true; });
    tapBtn.addEventListener('pointerup', () => { this.input.down = false; });
  }

  openScreen(name) {
    const map = {
      main: 'screen-main',
      levels: 'screen-levels',
      stats: 'screen-stats',
      settings: 'screen-settings',
      credits: 'screen-credits',
      game: 'screen-game'
    };
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    document.getElementById(map[name]).classList.add('active');
    this.state = name;
    this.audio.sfx('menu');

    if (name === 'levels') this.renderLevelSelect();
    if (name === 'stats') this.renderStats();
    if (name === 'settings') this.renderSettings();
    if (name === 'credits') this.renderCredits();
  }

  renderTopStats() {
    const s = this.save.state.stats;
    document.getElementById('topStats').innerHTML = `Levels ${s.levelsCompleted}/${this.levels.length}<br>Coins ${s.totalCoins} • Attempts ${s.totalAttempts}`;
  }

  renderLevelSelect() {
    const root = document.getElementById('screen-levels');
    root.innerHTML = `
      <div class="actions" style="margin-bottom:10px">
        <button class="btn" data-back>Main Menu</button>
        <button class="btn" data-practice>Practice: ${this.practice ? 'ON' : 'OFF'}</button>
      </div>
      <div class="level-grid"></div>
    `;
    root.querySelector('[data-back]').onclick = () => this.openScreen('main');
    root.querySelector('[data-practice]').onclick = () => { this.practice = !this.practice; this.renderLevelSelect(); };

    const grid = root.querySelector('.level-grid');
    this.levels.forEach((level, i) => {
      const progress = this.save.state.levels[i];
      const locked = i + 1 > this.save.state.unlocked;
      const coins = progress.coins.filter(Boolean).length;
      const card = document.createElement('article');
      card.className = `card level-card ${locked ? 'locked' : ''}`;
      card.innerHTML = `
        <span class="badge ${DIFF_CLS[level.difficulty]}">${level.difficulty}</span>
        <h3>${i + 1}. ${level.title}</h3>
        <p>${level.description}</p>
        <p>Modes: ${level.modes.join(', ')}</p>
        <p>Best ${Math.floor(progress.bestPercent)}% • Coins ${coins}/3</p>
        <div class="progress"><span style="width:${progress.bestPercent}%"></span></div>
        <div class="actions"><button class="btn primary" ${locked ? 'disabled' : ''}>Play</button></div>
      `;
      card.querySelector('button').onclick = () => this.startLevel(i, this.practice);
      grid.appendChild(card);
    });
  }

  renderStats() {
    const stats = this.save.state.stats;
    const achievements = [
      ['Complete 5 levels', stats.levelsCompleted >= 5],
      ['Collect 10 coins', stats.totalCoins >= 10],
      ['Beat a Demon level', this.levels.some((l, i) => l.difficulty === 'Demon' && this.save.state.levels[i].normalClear)],
      ['Practice clear any level', this.save.state.levels.some((l) => l.practiceClear)]
    ];
    document.getElementById('screen-stats').innerHTML = `
      <div class="card hero">
        <h2>Stats</h2>
        <p>Total Attempts: ${stats.totalAttempts} | Total Deaths: ${stats.totalDeaths} | Coins: ${stats.totalCoins}</p>
        <ul>${achievements.map((a) => `<li>${a[1] ? '✅' : '⬜'} ${a[0]}</li>`).join('')}</ul>
        <button class="btn" data-back>Back</button>
      </div>
    `;
    document.querySelector('#screen-stats [data-back]').onclick = () => this.openScreen('main');
  }

  renderSettings() {
    const settings = this.save.state.settings;
    document.getElementById('screen-settings').innerHTML = `
      <div class="card hero">
        <h2>Settings</h2>
        <div class="actions">
          <button class="btn" data-mute>Mute: ${settings.muted ? 'ON' : 'OFF'}</button>
          <button class="btn" data-motion>Reduced Motion: ${settings.reducedMotion ? 'ON' : 'OFF'}</button>
          <button class="btn" data-full>Fullscreen</button>
        </div>
        <p>Controls: Space / Up / Click / Tap = action. Hold for ship/wave/robot strength. R restart. Esc pause.</p>
        <button class="btn" data-back>Back</button>
      </div>
    `;

    document.querySelector('#screen-settings [data-mute]').onclick = () => {
      settings.muted = !settings.muted;
      this.audio.muted = settings.muted;
      this.save.persist();
      this.renderSettings();
    };
    document.querySelector('#screen-settings [data-motion]').onclick = () => {
      settings.reducedMotion = !settings.reducedMotion;
      this.save.persist();
      this.renderSettings();
    };
    document.querySelector('#screen-settings [data-full]').onclick = () => document.documentElement.requestFullscreen?.();
    document.querySelector('#screen-settings [data-back]').onclick = () => this.openScreen('main');
  }

  renderCredits() {
    document.getElementById('screen-credits').innerHTML = `
      <div class="card hero">
        <h2>Credits</h2>
        <p>Neon Rush created as a polished, fully browser-playable rhythm platformer.</p>
        <p>Design, systems, and code by Codex.</p>
        <button class="btn" data-back>Back</button>
      </div>
    `;
    document.querySelector('#screen-credits [data-back]').onclick = () => this.openScreen('main');
  }

  startLevel(index, practiceMode) {
    document.getElementById('screen-complete').classList.remove('active');
    document.getElementById('screen-pause').classList.remove('active');

    this.currentLevel = JSON.parse(JSON.stringify(this.levels[index]));
    this.practice = practiceMode;
    this.player.reset();
    this.worldUnits = 0;
    this.speed = this.currentLevel.startSpeed;
    this.time = 0;
    this.lastBeat = 0;
    this.shake = 0;
    this.lastCheckpoint = 0;
    this.coinsRun = 0;
    this.trail = [];
    this.paused = false;

    const profile = this.save.state.levels[index];
    profile.attempts++;
    profile.runDeaths = 0;
    this.save.state.stats.totalAttempts++;
    this.save.persist();
    this.renderTopStats();

    this.openScreen('game');
  }

  restartLevel() {
    if (!this.currentLevel) return;
    if (this.practice && this.lastCheckpoint > 0) {
      this.worldUnits = this.lastCheckpoint;
      this.player.reset();
      this.player.x = 220 + this.lastCheckpoint * 10;
      this.audio.sfx('checkpoint');
      return;
    }
    this.startLevel(this.currentLevel.id, this.practice);
  }

  setPause(v) {
    this.paused = v;
    document.getElementById('screen-pause').classList.toggle('active', v);
  }

  failLevel() {
    this.audio.sfx('death');
    this.shake = 12;
    const p = this.save.state.levels[this.currentLevel.id];
    p.deaths++;
    p.runDeaths++;
    this.save.state.stats.totalDeaths++;
    this.save.persist();
    this.renderTopStats();
    this.restartLevel();
  }

  collectCoin(c) {
    if (c.collected) return;
    c.collected = true;
    this.coinsRun++;
    this.audio.sfx('coin');
  }

  finishLevel() {
    const run = this.save.state.levels[this.currentLevel.id];
    run.bestPercent = 100;
    run[this.practice ? 'practiceClear' : 'normalClear'] = true;
    if (!run.bestTime || this.time < run.bestTime) run.bestTime = this.time;

    this.currentLevel.coins.forEach((coin, i) => {
      if (coin.collected && !run.coins[i]) {
        run.coins[i] = true;
        this.save.state.stats.totalCoins++;
      }
    });

    if (!this.practice && run.runDeaths === 0) run.noDeathClear = true;
    if (!this.practice && run.attempts === 1) run.firstTryClear = true;

    this.save.state.unlocked = Math.max(this.save.state.unlocked, this.currentLevel.id + 2);
    this.save.state.stats.levelsCompleted = this.save.state.levels.filter((l) => l.normalClear).length;
    this.save.persist();
    this.renderTopStats();

    const medals = [
      run.normalClear && 'Normal Clear',
      run.practiceClear && 'Practice Clear',
      run.coins.every(Boolean) && 'Coin Clear',
      run.noDeathClear && 'No Death',
      run.firstTryClear && 'First Try'
    ].filter(Boolean);

    document.getElementById('completeTitle').textContent = `${this.currentLevel.title} Complete`;
    document.getElementById('completeMeta').textContent = `${this.practice ? 'Practice' : 'Normal'} run • ${this.coinsRun}/3 coins • ${this.time.toFixed(2)}s`;
    document.getElementById('completeBadges').innerHTML = medals.map((m) => `<span class="badge diff-normal">${m}</span>`).join('');
    document.getElementById('screen-complete').classList.add('active');
    this.audio.sfx('complete');
  }

  tick(dt) {
    if (!this.currentLevel || this.paused || this.state !== 'game') return;

    this.time += dt;
    this.input.tick(dt);
    this.worldUnits += this.speed * dt / 100;

    const beatIndex = Math.floor(this.time / this.currentLevel.beat);
    if (beatIndex > this.lastBeat) {
      this.lastBeat = beatIndex;
      if (!this.save.state.settings.reducedMotion) this.shake = Math.min(8, this.shake + 2);
    }

    if (this.practice) {
      const nextCp = this.currentLevel.checkpoints.find((cp) => cp > this.lastCheckpoint && cp <= this.worldUnits);
      if (nextCp) {
        this.lastCheckpoint = nextCp;
        this.audio.sfx('checkpoint');
      }
    }

    for (const p of this.currentLevel.portals) {
      if (p.triggered) continue;
      if (Math.abs(this.worldUnits - p.x) < 0.6) {
        p.triggered = true;
        if (p.kind === 'gravity') this.player.gravity *= -1;
        if (p.kind === 'speed') this.speed = this.currentLevel.startSpeed * p.mul;
        if (p.kind === 'mode') this.player.mode = p.mode;
        this.audio.sfx('portal');
      }
    }

    this.player.tick(dt, this.input, this.speed);

    for (const c of this.currentLevel.coins) {
      const sx = c.x * 10 - this.worldUnits * 10 + this.player.x;
      if (!c.collected && Math.hypot(sx - this.player.x, c.y - this.player.y) < 35) this.collectCoin(c);
    }

    for (const o of this.currentLevel.objects) {
      const sx = o.x * 10 - this.worldUnits * 10 + this.player.x;
      const sy = o.y + (o.moveAmp ? Math.sin(this.time * 2 + o.x) * o.moveAmp : 0);
      const sw = o.w || o.r * 2;
      const sh = o.h || o.r * 2;

      const hit = sx < this.player.x + this.player.w && sx + sw > this.player.x && sy < this.player.y + this.player.h && sy + sh > this.player.y;
      if (!hit) continue;

      if (o.kind === 'block') {
        const prevBottom = this.player.y - this.player.vy * dt + this.player.h;
        if (this.player.gravity > 0 && prevBottom <= sy + 10) {
          this.player.y = sy - this.player.h;
          this.player.vy = 0;
          continue;
        }
      }

      if (o.kind === 'laser' && o.pulse && Math.sin(this.time * 10 + o.x) < 0) continue;
      this.failLevel();
      return;
    }

    const progress = clamp(this.worldUnits / this.currentLevel.length * 100, 0, 100);
    const profile = this.save.state.levels[this.currentLevel.id];
    profile.bestPercent = Math.max(profile.bestPercent, progress);

    document.getElementById('hudLevel').textContent = `${this.currentLevel.id + 1}. ${this.currentLevel.title}`;
    document.getElementById('hudMode').textContent = `${this.practice ? 'Practice' : 'Normal'} • ${this.player.mode.toUpperCase()}`;
    document.getElementById('hudProgress').textContent = `${Math.floor(progress)}%`;
    document.getElementById('hudCoins').textContent = `◈ ${this.coinsRun}/3`;

    if (progress >= 100) this.finishLevel();
    if (!this.player.alive) this.failLevel();
  }

  drawBackground() {
    const ctx = this.ctx;
    const lvl = this.currentLevel;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * Math.PI * 2 / lvl.beat);

    ctx.fillStyle = lvl.bg;
    ctx.fillRect(0, 0, GAME_W, GAME_H);
    for (let i = 0; i < 24; i++) {
      const y = (i * 88 + this.worldUnits * (5 + i * 0.2)) % (GAME_H + 88);
      const x = (i * 130 - this.worldUnits * 18) % (GAME_W + 180);
      ctx.fillStyle = `rgba(255,255,255,${0.02 + (i % 4) * 0.01})`;
      ctx.fillRect(x, y, 2, 70);
    }
    ctx.fillStyle = `${lvl.accent}22`;
    ctx.fillRect(0, FLOOR_Y + 38, GAME_W, GAME_H - FLOOR_Y);

    if (!this.save.state.settings.reducedMotion) {
      ctx.fillStyle = `${lvl.accent}${Math.floor(90 + pulse * 90).toString(16).padStart(2, '0')}`;
      ctx.fillRect(0, 0, GAME_W, 6 + pulse * 5);
    }
  }

  drawLevel() {
    if (!this.currentLevel || this.state !== 'game') return;

    const ctx = this.ctx;
    const cameraShake = this.save.state.settings.reducedMotion ? 0 : this.shake;
    this.shake = Math.max(0, this.shake - 1.0);

    ctx.save();
    ctx.clearRect(0, 0, GAME_W, GAME_H);
    ctx.translate((Math.random() - 0.5) * cameraShake, (Math.random() - 0.5) * cameraShake);

    this.drawBackground();

    for (const p of this.currentLevel.portals) {
      const x = p.x * 10 - this.worldUnits * 10 + this.player.x;
      if (x < -100 || x > GAME_W + 100) continue;
      ctx.lineWidth = 4;
      ctx.strokeStyle = p.kind === 'mode' ? '#00e7ff' : p.kind === 'gravity' ? '#ff4ec9' : '#ffd659';
      ctx.beginPath();
      ctx.arc(x, p.y, 24, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const o of this.currentLevel.objects) {
      const x = o.x * 10 - this.worldUnits * 10 + this.player.x;
      if (x < -120 || x > GAME_W + 120) continue;
      const y = o.y + (o.moveAmp ? Math.sin(this.time * 2 + o.x) * o.moveAmp : 0);

      if (o.kind === 'spike') {
        ctx.fillStyle = '#ff6c8a';
        ctx.beginPath();
        ctx.moveTo(x, y + o.h);
        ctx.lineTo(x + o.w / 2, y);
        ctx.lineTo(x + o.w, y + o.h);
        ctx.closePath();
        ctx.fill();
      } else if (o.kind === 'saw') {
        ctx.strokeStyle = '#ff9cb0';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x + o.r, y + o.r, o.r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const sw = o.w || o.r * 2;
        const sh = o.h || o.r * 2;
        ctx.fillStyle = o.kind === 'block' ? '#6de9ff' : o.kind === 'fake' ? '#7171af99' : '#ff6666cc';
        ctx.fillRect(x, y, sw, sh);
      }
    }

    for (const c of this.currentLevel.coins) {
      if (c.collected) continue;
      const x = c.x * 10 - this.worldUnits * 10 + this.player.x;
      const r = 10 + Math.sin(this.time * 9 + c.x) * 2;
      ctx.fillStyle = '#ffd84b';
      ctx.beginPath();
      ctx.arc(x, c.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    this.trail.push({ x: this.player.x, y: this.player.y + this.player.h / 2, t: 0.6 });
    this.trail = this.trail.filter((p) => (p.t -= 0.016) > 0);
    for (const t of this.trail) {
      ctx.fillStyle = `rgba(0,231,255,${t.t})`;
      ctx.fillRect(t.x - 30 * t.t, t.y, 12 * t.t, 4);
    }

    ctx.save();
    ctx.translate(this.player.x + this.player.w / 2, this.player.y + this.player.h / 2);
    ctx.rotate(this.player.rotation);
    ctx.fillStyle = this.currentLevel.accent;
    ctx.fillRect(-this.player.w / 2, -this.player.h / 2, this.player.w, this.player.h);
    ctx.fillStyle = '#fff';
    ctx.fillRect(-8, -8, 6, 6);
    ctx.restore();

    if (this.player.showDualGhost) {
      ctx.fillStyle = '#ffffff3a';
      ctx.fillRect(this.player.x + 120, GAME_H - this.player.y - 142, this.player.w, this.player.h);
    }

    ctx.restore();
  }

  loop(now) {
    const dt = clamp((now - (this.prev || now)) / 1000, 0, 0.033);
    this.prev = now;

    if (!document.getElementById('screen-complete').classList.contains('active')) this.tick(dt);
    this.drawLevel();
    requestAnimationFrame((t) => this.loop(t));
  }
}

new NeonRushGame();
