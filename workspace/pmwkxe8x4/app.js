(function () {
  'use strict';

  // ---------------------------------------------------------------
  // Canvas / core setup
  // ---------------------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const TILE = 16;
  const CELL = TILE / 8;         // 2px per pattern cell

  // internal resolution tracks the real viewport aspect ratio so portrait
  // phones get a full-height view instead of a letterboxed 16:9 strip.
  const PIXEL_SCALE = 3; // 1 internal px = 3 CSS px, keeps the chunky pixel look on any screen
  let GAME_W, GAME_H;
  function resizeCanvas() {
    GAME_W = Math.max(160, Math.round(window.innerWidth / PIXEL_SCALE));
    GAME_H = Math.max(120, Math.round(window.innerHeight / PIXEL_SCALE));
    canvas.width = GAME_W;
    canvas.height = GAME_H;
    ctx.imageSmoothingEnabled = false;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', resizeCanvas);

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dist(x1, y1, x2, y2) { return Math.hypot(x1 - x2, y1 - y2); }

  // deterministic RNG so the world is the same every time it loads
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rng = mulberry32(20260517);

  // ---------------------------------------------------------------
  // Tiles
  // ---------------------------------------------------------------
  const T = {
    GRASS: 0, WATER: 1, SAND: 2, TREE: 3, ROCK: 4, PATH: 5, FLOWER: 6,
    WALL: 7, ROOF: 8, DOOR: 9, CAVE_FLOOR: 10, CAVE_WALL: 11,
    CAVE_ENTRANCE: 12, CAVE_EXIT: 13
  };
  const SOLID = new Set([T.WATER, T.TREE, T.ROCK, T.WALL, T.ROOF, T.CAVE_WALL]);

  // ---------------------------------------------------------------
  // Pixel-art patterns (8x8 "big pixels", drawn with code — no image files)
  // ---------------------------------------------------------------
  function drawPattern(x, y, pattern, colors) {
    for (let r = 0; r < 8; r++) {
      const row = pattern[r];
      for (let c = 0; c < 8; c++) {
        const ch = row[c];
        if (ch === ' ') continue;
        ctx.fillStyle = colors[ch];
        ctx.fillRect(Math.round(x + c * CELL), Math.round(y + r * CELL), CELL, CELL);
      }
    }
  }

  const SPECK = [
    ['........', '...x....', '........', '........', '....x...', '........', 'x.......', '........'],
    ['........', '........', 'x....x..', '........', '........', '...x....', '........', '......x.'],
    ['..x.....', '........', '........', 'x....x..', '........', '........', '.....x..', '........'],
    ['........', '.....x..', '...x....', '........', 'x.......', '........', '........', '...x....']
  ];
  function drawGround(x, y, base, dark, variant) {
    ctx.fillStyle = base;
    ctx.fillRect(x, y, TILE, TILE);
    const mask = SPECK[variant & 3];
    ctx.fillStyle = dark;
    for (let r = 0; r < 8; r++) {
      const row = mask[r];
      for (let c = 0; c < 8; c++) {
        if (row[c] === 'x') ctx.fillRect(x + c * CELL, y + r * CELL, CELL, CELL);
      }
    }
  }

  const FLOWER_PAT = ['        ', '        ', '   r r  ', '    y   ', '   r r  ', '        ', '        ', '        '];
  const FLOWER_COL = { r: '#ff6fa5', y: '#ffe066' };

  const TREE_PAT = ['   gg   ', '  gGGg  ', ' gGGGGg ', 'gGGGGGGg', 'gGGGGGGg', ' gGGGGg ', '   tt   ', '   tt   '];
  const TREE_COL = { g: '#1e6e2e', G: '#3fae4a', t: '#6b4423' };

  const ROCK_PAT = ['  ####  ', ' #RRRR# ', '#RRrrRR#', '#RrrrrR#', '#RRrrRR#', ' #RRRR# ', '  ####  ', '        '];
  const ROCK_COL = { '#': '#2e2e2e', R: '#8c8c8c', r: '#b5b5b5' };

  const WALL_PAT = ['WWWWWWWW', 'W==W==W=', 'WWWWWWWW', '=W==W==W', 'WWWWWWWW', 'W==W==W=', 'WWWWWWWW', '=W==W==W'];
  const WALL_COL = { W: '#b05a3c', '=': '#7a3c26' };

  const ROOF_PAT = ['   oo   ', '  oooo  ', ' oooooo ', 'oooooooo', 'OOOOOOOO', 'OOOOOOOO', '        ', '        '];
  const ROOF_COL = { o: '#c0432f', O: '#8a2a20' };

  const DOOR_PAT = ['dddddddd', 'dAAAAAAd', 'dAAAAAAd', 'dAAAAAAd', 'dAAAAAAd', 'dAAAkAAd', 'dAAAAAAd', 'dddddddd'];
  const DOOR_COL = { d: '#5a3420', A: '#8a5a34', k: '#e8c468' };

  const CAVEWALL_PAT = ['########', '#rrrrrr#', '#r####r#', '#r#rr#r#', '#r#rr#r#', '#r####r#', '#rrrrrr#', '########'];
  const CAVEWALL_COL = { '#': '#1c1c22', r: '#35353e' };

  const CAVE_MOUTH_PAT = ['  ####  ', ' #0000# ', '#000000#', '#000000#', '#000000#', '#000000#', ' ###### ', '        '];
  const CAVE_MOUTH_COL = { '#': '#2a2a2a', '0': '#0a0a0a' };

  const CAVE_EXIT_PAT = ['  ####  ', ' #LLLL# ', '#LLLLLL#', '#LLLLLL#', '#LLLLLL#', '#LLLLLL#', ' ###### ', '        '];
  const CAVE_EXIT_COL = { '#': '#2a2a2a', L: '#cdd98a' };

  const CHEST_PAT = ['        ', '  CCCC  ', ' CCCCCC ', ' CkkkkC ', ' CCCCCC ', ' CCCCCC ', '        ', '        '];
  const CHEST_COL = { C: '#7a4a26', k: '#e8c468' };
  const CHEST_COL_OPEN = { C: '#9a6a3a', k: '#fff4a3' };

  const PLAYER_FRAMES = [
    ['  hhhh  ', ' hffffh ', ' hffffh ', '  bbbb  ', ' bbbbbb ', ' bbbbbb ', '  LLLL  ', '  LLLL  '],
    ['  hhhh  ', ' hffffh ', ' hffffh ', '  bbbb  ', ' bbbbbb ', ' bbbbbb ', ' LL  LL ', ' L    L ']
  ];
  const PLAYER_COL = { h: '#3a2a1e', f: '#f0c8a0', b: '#2e6fb3', L: '#28201a' };

  const COIN_PAT = ['        ', '  oooo  ', ' oYYYYo ', ' oYyyYo ', ' oYyyYo ', ' oYYYYo ', '  oooo  ', '        '];
  const COIN_COL = { o: '#8a6a1a', Y: '#ffd34d', y: '#fff1ab' };
  const GEM_PAT = ['        ', '   gg   ', '  gGGg  ', ' gGGGGg ', ' gggggg ', '  gggg  ', '   gg   ', '        '];
  const GEM_COL = { g: '#1f7fd1', G: '#7fd1ff' };

  // ---------------------------------------------------------------
  // World generation
  // ---------------------------------------------------------------
  const OW_W = 48, OW_H = 36;
  const TOWN = { x0: 30, y0: 20, x1: 45, y1: 32 };
  const LAKE = { x: 20, y: 14 };
  const MOUNTAIN_BOX = { x0: 2, y0: 2, x1: 14, y1: 14 };
  const CAVE_ENTRANCE_TILE = { x: 8, y: 8 };

  let overworld, owDecor;

  function makeGrid(w, h, fill) {
    const g = [];
    for (let y = 0; y < h; y++) g.push(new Array(w).fill(fill));
    return g;
  }

  function buildOverworld() {
    const g = makeGrid(OW_W, OW_H, T.GRASS);

    // lake + sand ring
    for (let y = LAKE.y - 8; y <= LAKE.y + 8; y++) {
      for (let x = LAKE.x - 8; x <= LAKE.x + 8; x++) {
        if (x < 0 || y < 0 || x >= OW_W || y >= OW_H) continue;
        const d = dist(x, y, LAKE.x, LAKE.y);
        if (d <= 6) g[y][x] = T.WATER;
        else if (d <= 7.4) g[y][x] = T.SAND;
      }
    }

    // forest clusters
    const forestCenters = [[14, 28], [25, 5], [41, 5], [3, 27], [18, 30], [8, 18], [44, 15]];
    for (const [cx0, cy0] of forestCenters) {
      let x = cx0, y = cy0;
      for (let i = 0; i < 35; i++) {
        if (x >= 0 && y >= 0 && x < OW_W && y < OW_H && g[y][x] === T.GRASS) g[y][x] = T.TREE;
        x = clamp(x + Math.round(rng() * 2 - 1), 0, OW_W - 1);
        y = clamp(y + Math.round(rng() * 2 - 1), 0, OW_H - 1);
      }
    }

    // mountain rocks
    let mx = 8, my = 8;
    for (let i = 0; i < 90; i++) {
      if (g[my][mx] === T.GRASS && !(mx === CAVE_ENTRANCE_TILE.x && my === CAVE_ENTRANCE_TILE.y)) g[my][mx] = T.ROCK;
      mx = clamp(mx + Math.round(rng() * 2 - 1), MOUNTAIN_BOX.x0, MOUNTAIN_BOX.x1);
      my = clamp(my + Math.round(rng() * 2 - 1), MOUNTAIN_BOX.y0, MOUNTAIN_BOX.y1);
    }

    // flowers
    for (let y = 0; y < OW_H; y++) {
      for (let x = 0; x < OW_W; x++) {
        if (g[y][x] === T.GRASS && rng() < 0.035) g[y][x] = T.FLOWER;
      }
    }

    // path: town <-> cave entrance
    for (let x = 8; x <= 30; x++) g[24][x] = T.PATH;
    for (let y = 8; y <= 24; y++) g[y][8] = T.PATH;
    g[CAVE_ENTRANCE_TILE.y][CAVE_ENTRANCE_TILE.x] = T.CAVE_ENTRANCE;

    // town square
    for (let y = TOWN.y0; y < TOWN.y1; y++) {
      for (let x = TOWN.x0; x < TOWN.x1; x++) g[y][x] = T.PATH;
    }
    placeHouse(g, 32, 21);
    placeHouse(g, 40, 21);
    placeHouse(g, 36, 27);

    return g;
  }

  function placeHouse(g, x, roofY) {
    g[roofY][x] = T.ROOF; g[roofY][x + 1] = T.ROOF; g[roofY][x + 2] = T.ROOF;
    g[roofY + 1][x] = T.WALL; g[roofY + 1][x + 1] = T.DOOR; g[roofY + 1][x + 2] = T.WALL;
  }

  function buildDecor(w, h) {
    const d = [];
    for (let y = 0; y < h; y++) {
      const row = [];
      for (let x = 0; x < w; x++) row.push((x * 13 + y * 7) % 4);
      d.push(row);
    }
    return d;
  }

  // cave (built with plain loops, not hand-counted ASCII, to avoid off-by-one bugs)
  const CV_W = 20, CV_H = 14;
  let cave, cvDecor;
  const CHEST_POS = { x: 10, y: 6 };
  const CAVE_SPAWN = { x: 10, y: 2 };
  const CAVE_EXIT_POS = { x: 10, y: 12 };

  function buildCave() {
    const g = makeGrid(CV_W, CV_H, T.CAVE_FLOOR);
    for (let y = 0; y < CV_H; y++) {
      for (let x = 0; x < CV_W; x++) {
        if (x === 0 || y === 0 || x === CV_W - 1 || y === CV_H - 1) g[y][x] = T.CAVE_WALL;
      }
    }
    const pillarRows = [3, 4, 8, 9];
    const pillarCols = [5, 6, 13, 14];
    for (const py of pillarRows) for (const px of pillarCols) g[py][px] = T.CAVE_WALL;
    g[CHEST_POS.y][CHEST_POS.x] = T.CAVE_FLOOR;
    g[CAVE_EXIT_POS.y][CAVE_EXIT_POS.x] = T.CAVE_EXIT;
    return g;
  }

  overworld = buildOverworld();
  owDecor = buildDecor(OW_W, OW_H);
  cave = buildCave();
  cvDecor = buildDecor(CV_W, CV_H);

  // ---------------------------------------------------------------
  // Active zone state
  // ---------------------------------------------------------------
  let map = overworld, decor = owDecor, mapW = OW_W, mapH = OW_H;
  let worldPxW = mapW * TILE, worldPxH = mapH * TILE;
  let currentZone = 'overworld';
  let triggerCooldown = 0;

  function tileAt(px, py) {
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    if (tx < 0 || ty < 0 || tx >= mapW || ty >= mapH) return T.ROCK;
    return map[ty][tx];
  }
  function isSolidPoint(px, py) { return SOLID.has(tileAt(px, py)); }
  function collidesBox(cx, cy, hw, hh) {
    const left = cx - hw, right = cx + hw - 1, top = cy - hh, bottom = cy - 1;
    return isSolidPoint(left, top) || isSolidPoint(right, top) || isSolidPoint(left, bottom) || isSolidPoint(right, bottom);
  }
  function clampToWorld(e) {
    e.x = clamp(e.x, e.hw, worldPxW - e.hw);
    e.y = clamp(e.y, e.hh, worldPxH - 1);
  }
  function tryMove(e, dx, dy) {
    if (dx !== 0) { const nx = e.x + dx; if (!collidesBox(nx, e.y, e.hw, e.hh)) e.x = nx; }
    if (dy !== 0) { const ny = e.y + dy; if (!collidesBox(e.x, ny, e.hw, e.hh)) e.y = ny; }
  }

  // ---------------------------------------------------------------
  // Entities
  // ---------------------------------------------------------------
  const overworldSpawn = { x: 37 * TILE + 8, y: 24 * TILE + 8 };
  const caveSpawnPx = { x: CAVE_SPAWN.x * TILE + 8, y: CAVE_SPAWN.y * TILE + 8 };
  const caveExitBackPx = { x: 8 * TILE + 8, y: 9 * TILE + 8 };

  const player = {
    x: overworldSpawn.x, y: overworldSpawn.y, hw: 5, hh: 6,
    speed: 1.05, facing: 'down', moving: false,
    animTimer: 0, animFrame: 0, hp: 3, maxHp: 3, invuln: 0
  };

  function makeNpc(name, tx, ty, lines, shirt) {
    return {
      name, x: tx * TILE + 8, y: ty * TILE + 8, home: { x: tx * TILE + 8, y: ty * TILE + 8 },
      hw: 5, hh: 6, lines, lineIndex: -1,
      colors: { h: '#2a1a12', f: '#f0c8a0', b: shirt, L: '#2a1a12' },
      vx: 0, vy: 0, changeTimer: 0, radius: 16
    };
  }
  const npcs = [
    makeNpc('ลุงไพบูลย์', 34, 24, [
      'สวัสดีนักเดินทาง! เมืองนี้สงบดีนะ',
      'ถ้าเจอสไลม์ในป่า ระวังตัวด้วยล่ะ',
      'ได้ยินว่าในถ้ำทางเหนือมีสมบัติซ่อนอยู่นะ'
    ], '#b33a3a'),
    makeNpc('ป้าสมศรี', 41, 24, [
      'เก็บเหรียญทองกับเพชรให้ครบๆ นะลูก',
      'ระวังทางน้ำนะ เดินข้ามไม่ได้จ้ะ',
      'แวะมาคุยกับป้าได้เรื่อยๆ นะ'
    ], '#6a3ab3'),
    makeNpc('เด็กชายต้นกล้า', 37, 30, [
      'พี่ๆ ลองไปสำรวจถ้ำดูสิ มีของดีอยู่ในนั้น!',
      'ผมไม่กล้าไปเองหรอก สไลม์มันน่ากลัว',
      'สู้ๆ นะพี่นักผจญภัย!'
    ], '#3ab36a')
  ];

  function makeSlime(tx, ty, colorSet) {
    const x = tx * TILE + 8, y = ty * TILE + 8;
    return { x, y, hw: 5, hh: 5, home: { x, y }, radius: 26, speed: 0.55, vx: 0, vy: 0, changeTimer: 0, squish: 0, colors: colorSet };
  }
  const FOREST_SLIME_COL = { s: '#4fc26a', d: '#2f8f4a' };
  const CAVE_SLIME_COL = { s: '#7a5fc2', d: '#4a3a8f' };
  const slimes = [
    makeSlime(14, 27, FOREST_SLIME_COL), makeSlime(26, 6, FOREST_SLIME_COL),
    makeSlime(42, 6, FOREST_SLIME_COL), makeSlime(4, 26, FOREST_SLIME_COL),
    makeSlime(19, 29, FOREST_SLIME_COL), makeSlime(9, 19, FOREST_SLIME_COL)
  ];
  const caveSlimes = [makeSlime(6, 6, CAVE_SLIME_COL), makeSlime(8, 9, CAVE_SLIME_COL)];

  const items = [];
  (function scatterItems() {
    let tries = 0, coinsWanted = 20, gemsWanted = 6;
    const used = new Set();
    while ((coinsWanted > 0 || gemsWanted > 0) && tries < 2000) {
      tries++;
      const tx = Math.floor(rng() * OW_W), ty = Math.floor(rng() * OW_H);
      const key = tx + ',' + ty;
      if (used.has(key)) continue;
      const t = overworld[ty][tx];
      if (SOLID.has(t) || t === T.CAVE_ENTRANCE) continue;
      used.add(key);
      const isCoin = coinsWanted > 0 && (gemsWanted === 0 || rng() < 0.78);
      if (isCoin) { coinsWanted--; } else { gemsWanted--; }
      items.push({ type: isCoin ? 'coin' : 'gem', x: tx * TILE + 8, y: ty * TILE + 8, taken: false });
    }
  })();

  const chest = { x: CHEST_POS.x * TILE + 8, y: CHEST_POS.y * TILE + 8, opened: false };

  let coins = 0, gems = 0;

  // ---------------------------------------------------------------
  // UI wiring
  // ---------------------------------------------------------------
  const heartsEl = document.getElementById('hearts');
  const coinCountEl = document.getElementById('coinCount');
  const gemCountEl = document.getElementById('gemCount');
  const dialogEl = document.getElementById('dialog');
  const dialogNameEl = document.getElementById('dialogName');
  const dialogTextEl = document.getElementById('dialogText');
  const toastEl = document.getElementById('toast');
  const startScreenEl = document.getElementById('startScreen');

  let dialogOpen = false;
  let toastTimer = 0;
  let startScreenVisible = true;

  function updateHud() {
    let hearts = '';
    for (let i = 0; i < player.maxHp; i++) hearts += (i < player.hp ? '❤️' : '🖤');
    heartsEl.textContent = hearts;
    coinCountEl.textContent = '🟡 ' + coins;
    gemCountEl.textContent = '💎 ' + gems;
  }
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    toastTimer = 2200;
  }
  function openDialog(npc) {
    dialogOpen = true;
    dialogEl.classList.remove('hidden');
    npc.lineIndex = (npc.lineIndex + 1) % npc.lines.length;
    dialogNameEl.textContent = npc.name;
    dialogTextEl.textContent = npc.lines[npc.lineIndex];
  }
  function closeDialog() {
    dialogOpen = false;
    dialogEl.classList.add('hidden');
  }

  function interact() {
    if (dialogOpen) { closeDialog(); return; }
    if (currentZone === 'overworld') {
      let nearest = null, best = 20;
      for (const n of npcs) {
        const d = dist(player.x, player.y - 6, n.x, n.y - 6);
        if (d < best) { best = d; nearest = n; }
      }
      if (nearest) { openDialog(nearest); return; }
    } else {
      if (!chest.opened && dist(player.x, player.y - 6, chest.x, chest.y - 6) < 18) {
        chest.opened = true; gems += 5; updateHud();
        showToast('พบสมบัติในหีบ! +5 เพชร 💎');
        return;
      }
    }
    showToast('ไม่มีอะไรให้ทำตรงนี้');
  }

  // ---------------------------------------------------------------
  // Zone transitions
  // ---------------------------------------------------------------
  function enterCave() {
    currentZone = 'cave';
    map = cave; decor = cvDecor; mapW = CV_W; mapH = CV_H;
    worldPxW = mapW * TILE; worldPxH = mapH * TILE;
    player.x = caveSpawnPx.x; player.y = caveSpawnPx.y;
    triggerCooldown = 700;
    showToast('เข้าสู่ถ้ำลึกลับ...');
  }
  function exitCave() {
    currentZone = 'overworld';
    map = overworld; decor = owDecor; mapW = OW_W; mapH = OW_H;
    worldPxW = mapW * TILE; worldPxH = mapH * TILE;
    player.x = caveExitBackPx.x; player.y = caveExitBackPx.y;
    triggerCooldown = 700;
    showToast('ออกจากถ้ำ กลับสู่โลกกว้าง');
  }
  function respawnPlayer() {
    player.hp = player.maxHp;
    player.invuln = 1500;
    if (currentZone === 'overworld') { player.x = overworldSpawn.x; player.y = overworldSpawn.y; }
    else { player.x = caveSpawnPx.x; player.y = caveSpawnPx.y; }
  }

  // ---------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------
  const keys = { up: false, down: false, left: false, right: false };
  const KEY_MAP = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right'
  };
  window.addEventListener('keydown', (e) => {
    if (KEY_MAP[e.code]) { keys[KEY_MAP[e.code]] = true; e.preventDefault(); }
    if (e.code === 'KeyE' || e.code === 'Space') { interact(); e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => {
    if (KEY_MAP[e.code]) { keys[KEY_MAP[e.code]] = false; e.preventDefault(); }
  });

  function bindHold(id, key) {
    const el = document.getElementById(id);
    const on = (e) => { keys[key] = true; e.preventDefault(); };
    const off = (e) => { keys[key] = false; if (e) e.preventDefault(); };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointerleave', off);
    el.addEventListener('pointercancel', off);
  }
  bindHold('btnUp', 'up'); bindHold('btnDown', 'down');
  bindHold('btnLeft', 'left'); bindHold('btnRight', 'right');
  document.getElementById('btnAction').addEventListener('pointerdown', (e) => { interact(); e.preventDefault(); });
  dialogEl.addEventListener('pointerdown', () => closeDialog());

  document.getElementById('btnStart').addEventListener('click', () => {
    startScreenVisible = false;
    startScreenEl.classList.add('hidden');
    updateHud();
    requestAnimationFrame((t) => { last = t; requestAnimationFrame(loop); });
  });

  // ---------------------------------------------------------------
  // AI: wandering NPCs / slimes
  // ---------------------------------------------------------------
  function updateWanderer(n, dt) {
    n.changeTimer -= dt;
    if (n.changeTimer <= 0) {
      n.changeTimer = 1200 + Math.random() * 1800;
      const a = Math.random() * Math.PI * 2;
      n.vx = Math.cos(a) * 0.35; n.vy = Math.sin(a) * 0.35;
      if (Math.random() < 0.4) { n.vx = 0; n.vy = 0; }
    }
    const spd = dt / 16.6667;
    const nx = n.x + n.vx * spd, ny = n.y + n.vy * spd;
    if (dist(nx, ny, n.home.x, n.home.y) < n.radius && !collidesBox(nx, ny, n.hw, n.hh)) { n.x = nx; n.y = ny; }
    else { n.changeTimer = 0; }
  }

  function updateSlime(s, dt) {
    s.changeTimer -= dt;
    if (s.changeTimer <= 0) {
      s.changeTimer = 700 + Math.random() * 1300;
      const a = Math.random() * Math.PI * 2;
      s.vx = Math.cos(a); s.vy = Math.sin(a);
    }
    const spd = s.speed * dt / 16.6667;
    const nx = s.x + s.vx * spd, ny = s.y + s.vy * spd;
    if (dist(nx, ny, s.home.x, s.home.y) < s.radius && !collidesBox(nx, ny, s.hw, s.hh)) { s.x = nx; s.y = ny; }
    else { s.changeTimer = 0; }
    s.squish = (s.squish + dt) % 1000;

    if (player.invuln <= 0) {
      const dx = player.x - s.x, dy = (player.y - 3) - s.y;
      if (Math.abs(dx) < 9 && Math.abs(dy) < 9) {
        player.hp--; player.invuln = 1200;
        const len = Math.hypot(dx, dy) || 1;
        player.x += (dx / len) * 12; player.y += (dy / len) * 12;
        clampToWorld(player);
        updateHud();
        if (player.hp <= 0) { respawnPlayer(); showToast('โดนสไลม์ชนจนสลบ... ฟื้นแล้วนะ!'); updateHud(); }
        else { showToast('โดนสไลม์ชน! ระวังตัวด้วย'); }
      }
    }
  }

  // ---------------------------------------------------------------
  // Update / Render
  // ---------------------------------------------------------------
  function update(dt) {
    if (startScreenVisible) return;
    if (triggerCooldown > 0) triggerCooldown -= dt;
    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) toastEl.classList.add('hidden'); }
    if (player.invuln > 0) player.invuln -= dt;

    if (!dialogOpen) {
      let vx = 0, vy = 0;
      if (keys.left) vx -= 1;
      if (keys.right) vx += 1;
      if (keys.up) vy -= 1;
      if (keys.down) vy += 1;
      if (vx !== 0 && vy !== 0) { vx *= 0.7071; vy *= 0.7071; }
      const spd = player.speed * dt / 16.6667;
      player.moving = (vx !== 0 || vy !== 0);
      if (vx !== 0) player.facing = vx < 0 ? 'left' : 'right';
      else if (vy !== 0) player.facing = vy < 0 ? 'up' : 'down';
      tryMove(player, vx * spd, vy * spd);
      clampToWorld(player);
    }

    if (player.moving) {
      player.animTimer += dt;
      if (player.animTimer > 160) { player.animTimer = 0; player.animFrame = 1 - player.animFrame; }
    } else { player.animFrame = 0; player.animTimer = 0; }

    if (currentZone === 'overworld') {
      for (const n of npcs) updateWanderer(n, dt);
      for (const s of slimes) updateSlime(s, dt);
      for (const it of items) {
        if (!it.taken && dist(player.x, player.y - 6, it.x, it.y) < 9) {
          it.taken = true;
          if (it.type === 'coin') coins++; else gems++;
          updateHud();
        }
      }
      if (triggerCooldown <= 0) {
        const t = tileAt(player.x, player.y - 2);
        if (t === T.CAVE_ENTRANCE) enterCave();
      }
    } else {
      for (const s of caveSlimes) updateSlime(s, dt);
      if (triggerCooldown <= 0) {
        const t = tileAt(player.x, player.y - 2);
        if (t === T.CAVE_EXIT) exitCave();
      }
    }
  }

  function drawGroundFor(t, sx, sy, tx, ty) {
    const v = decor[ty][tx];
    switch (t) {
      case T.GRASS: drawGround(sx, sy, '#4caf4f', '#3d8b3f', v); break;
      case T.FLOWER: drawGround(sx, sy, '#4caf4f', '#3d8b3f', v); drawPattern(sx, sy, FLOWER_PAT, FLOWER_COL); break;
      case T.WATER: drawGround(sx, sy, '#2a6fb3', '#1f5a94', (v + Math.floor(performance.now() / 250)) & 3); break;
      case T.SAND: drawGround(sx, sy, '#dfc27a', '#c9ab5c', v); break;
      case T.PATH: drawGround(sx, sy, '#b08a52', '#97713e', v); break;
      case T.CAVE_FLOOR: drawGround(sx, sy, '#4a4a52', '#3a3a42', v); break;
      case T.CAVE_ENTRANCE: drawGround(sx, sy, '#4caf4f', '#3d8b3f', v); drawPattern(sx, sy, CAVE_MOUTH_PAT, CAVE_MOUTH_COL); break;
      case T.CAVE_EXIT: drawGround(sx, sy, '#4a4a52', '#3a3a42', v); drawPattern(sx, sy, CAVE_EXIT_PAT, CAVE_EXIT_COL); break;
      case T.TREE: case T.ROCK: drawGround(sx, sy, '#4caf4f', '#3d8b3f', v); break;
      case T.WALL: case T.ROOF: case T.DOOR: drawGround(sx, sy, '#b08a52', '#97713e', v); break;
      case T.CAVE_WALL: drawGround(sx, sy, '#2a2a30', '#22222a', v); break;
      default: drawGround(sx, sy, '#4caf4f', '#3d8b3f', v);
    }
  }

  function drawProp(t, sx, sy) {
    switch (t) {
      case T.TREE: drawPattern(sx, sy, TREE_PAT, TREE_COL); break;
      case T.ROCK: drawPattern(sx, sy, ROCK_PAT, ROCK_COL); break;
      case T.WALL: drawPattern(sx, sy, WALL_PAT, WALL_COL); break;
      case T.ROOF: drawPattern(sx, sy, ROOF_PAT, ROOF_COL); break;
      case T.DOOR: drawPattern(sx, sy, DOOR_PAT, DOOR_COL); break;
      case T.CAVE_WALL: drawPattern(sx, sy, CAVEWALL_PAT, CAVEWALL_COL); break;
    }
  }

  function drawPlayer(sx, sy) {
    const frame = PLAYER_FRAMES[player.moving ? player.animFrame : 0];
    if (player.facing === 'left') {
      ctx.save();
      ctx.translate(sx, 0); ctx.scale(-1, 1); ctx.translate(-sx, 0);
      drawPattern(sx - 8, sy - 16, frame, PLAYER_COL);
      ctx.restore();
    } else {
      drawPattern(sx - 8, sy - 16, frame, PLAYER_COL);
    }
  }
  function drawHuman(sx, sy, colors) { drawPattern(sx - 8, sy - 16, PLAYER_FRAMES[0], colors); }
  function drawSlime(s, sx, sy) {
    const squish = s.squish < 500 ? 1 : 0.82;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(1, squish);
    ctx.translate(-sx, -sy);
    drawPattern(sx - 8, sy - 15, ['        ', '  ssss  ', ' ssssss ', 'ssssssss', 'ssssssss', 'dssssssd', ' dddddd ', '        '], s.colors);
    ctx.restore();
  }
  function drawChestSprite(sx, sy) { drawPattern(sx - 8, sy - 14, CHEST_PAT, chest.opened ? CHEST_COL_OPEN : CHEST_COL); }
  function drawItem(it, sx, sy) {
    if (it.type === 'coin') drawPattern(sx - 8, sy - 8, COIN_PAT, COIN_COL);
    else drawPattern(sx - 8, sy - 8, GEM_PAT, GEM_COL);
  }

  function render() {
    ctx.clearRect(0, 0, GAME_W, GAME_H);
    if (startScreenVisible) return;

    const camX = clamp(player.x - GAME_W / 2, 0, Math.max(0, worldPxW - GAME_W));
    const camY = clamp(player.y - GAME_H / 2, 0, Math.max(0, worldPxH - GAME_H));

    const tx0 = Math.max(0, Math.floor(camX / TILE));
    const ty0 = Math.max(0, Math.floor(camY / TILE));
    const tx1 = Math.min(mapW - 1, Math.ceil((camX + GAME_W) / TILE));
    const ty1 = Math.min(mapH - 1, Math.ceil((camY + GAME_H) / TILE));

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        drawGroundFor(map[ty][tx], tx * TILE - camX, ty * TILE - camY, tx, ty);
      }
    }

    const drawables = [];
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = map[ty][tx];
        if (t === T.TREE || t === T.ROCK || t === T.WALL || t === T.ROOF || t === T.DOOR || t === T.CAVE_WALL) {
          const sx = tx * TILE - camX, sy = ty * TILE - camY;
          drawables.push({ y: ty * TILE + TILE, draw: () => drawProp(t, sx, sy) });
        }
      }
    }
    if (currentZone === 'overworld') {
      for (const n of npcs) drawables.push({ y: n.y, draw: () => drawHuman(n.x - camX, n.y - camY, n.colors) });
      for (const s of slimes) drawables.push({ y: s.y, draw: () => drawSlime(s, s.x - camX, s.y - camY) });
      for (const it of items) if (!it.taken) drawables.push({ y: it.y, draw: () => drawItem(it, it.x - camX, it.y - camY) });
    } else {
      for (const s of caveSlimes) drawables.push({ y: s.y, draw: () => drawSlime(s, s.x - camX, s.y - camY) });
      drawables.push({ y: chest.y, draw: () => drawChestSprite(chest.x - camX, chest.y - camY) });
    }
    drawables.push({ y: player.y, draw: () => drawPlayer(player.x - camX, player.y - camY) });

    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) d.draw();

    if (currentZone === 'overworld') {
      const amt = 0.12 + 0.06 * Math.sin(performance.now() / 15000);
      ctx.fillStyle = 'rgba(10,15,45,' + amt.toFixed(3) + ')';
      ctx.fillRect(0, 0, GAME_W, GAME_H);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.fillRect(0, 0, GAME_W, GAME_H);
      const px = player.x - camX, py = player.y - camY - 8;
      const grad = ctx.createRadialGradient(px, py, 10, px, py, 65);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(px, py, 65, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // ---------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------
  let last = 0;
  function loop(ts) {
    const dt = Math.min(32, ts - last);
    last = ts;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  updateHud();
})();
