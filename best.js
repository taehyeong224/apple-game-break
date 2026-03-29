(function() {
  const COLS = 17, ROWS = 10;
  const TARGET = 10;
  const GL = 0.0752, GR = 0.9199;
  const GT = 0.0888, GB = 0.9132;

  function getCanvas() {
    for (const c of document.querySelectorAll('canvas')) {
      const r = c.getBoundingClientRect();
      if (r.width > 400 && r.height > 300) return c;
    }
    return null;
  }

  function getBoard() {
    const canvas = getCanvas();
    if (!canvas) return null;
    const key = Object.keys(canvas).find(k => k.startsWith('__reactFiber'));
    if (!key) return null;
    let f = canvas[key], depth = 0;
    while (f && depth < 80) {
      let cur = f.memoizedState, i = 0;
      while (cur && i < 25) {
        const v = cur.memoizedState;
        if (v && typeof v === 'object' && typeof v.board === 'string' &&
            v.board.length === 170 && /^[0-9]+$/.test(v.board)) return v.board;
        if (typeof v === 'string' && v.length === 170 && /^[0-9]+$/.test(v)) return v;
        cur = cur.next; i++;
      }
      f = f.return; depth++;
    }
    return null;
  }

  function boardToGrid(board) {
    const g = new Uint8Array(ROWS * COLS);
    for (let i = 0; i < ROWS * COLS; i++) g[i] = Number(board[i]);
    return g;
  }

  function copyGrid(g) { return new Uint8Array(g); }
  function get(g, r, c) { return g[r * COLS + c]; }
  function countApples(g) { let n=0; for(let i=0;i<g.length;i++) if(g[i]) n++; return n; }
  function rectArea(rect) { return (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1); }

  function sortRectsByPriority(rects) {
    rects.sort((a, b) => {
      // count 우선, 그 다음 밀도(같은 count면 촘촘한 사각형 선호), 마지막은 작은 면적
      const byCount = b.count - a.count;
      if (byCount) return byCount;
      const dA = (a.count * 1000) / rectArea(a);
      const dB = (b.count * 1000) / rectArea(b);
      const byDensity = dB - dA;
      if (byDensity) return byDensity;
      return rectArea(a) - rectArea(b);
    });
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  // ★ 핵심 수정: 시작점 0 체크 제거, 대신 rect 안에 사과가 하나라도 있고 합=10이면 유효
  function findAllRects(g) {
    const res = [];
    for (let r1 = 0; r1 < ROWS; r1++)
      for (let c1 = 0; c1 < COLS; c1++)
        for (let r2 = r1; r2 < ROWS; r2++)
          for (let c2 = c1; c2 < COLS; c2++) {
            let sum = 0, count = 0;
            const cells = [];

            for (let r = r1; r <= r2; r++)
              for (let c = c1; c <= c2; c++) {
                const v = get(g, r, c);
                if (v) { sum += v; count++; cells.push(r * COLS + c); }
              }

            if (!count) continue;
            if (sum === TARGET) {
              res.push({ r1, c1, r2, c2, count, cells });
            }
            // 0 없이 합 초과면 c2 더 늘려봤자 의미없음
            if (sum > TARGET && count === (r2-r1+1)*(c2-c1+1)) break;
          }
    return res;
  }

  function applyRect(g, cells) {
    const ng = copyGrid(g);
    for (const idx of cells) ng[idx] = 0;
    return ng;
  }

  function greedyOnce(rects) {
    const used = new Uint8Array(ROWS * COLS);
    const selected = [];
    for (const rect of rects) {
      let overlap = false;
      for (const idx of rect.cells) {
        if (used[idx]) { overlap = true; break; }
      }
      if (overlap) continue;
      selected.push(rect);
      for (const idx of rect.cells) used[idx] = 1;
    }
    return selected;
  }

  function buildGreedyPlan(g, seedRects) {
    let curG = copyGrid(g);
    let curRects = seedRects ? [...seedRects] : findAllRects(curG);
    const totalPlan = [];
    let total = 0;

    while (curRects.length > 0) {
      // tie-break 다양성을 위해 먼저 섞고, 우선순위 정렬
      shuffle(curRects);
      sortRectsByPriority(curRects);

      const plan = greedyOnce(curRects);
      if (!plan.length) break;

      for (const move of plan) {
        curG = applyRect(curG, move.cells);
        total += move.count;
        totalPlan.push(move);
      }
      curRects = findAllRects(curG);
    }

    return { plan: totalPlan, total };
  }

  function simulate(g, rects) {
    // 전개는 다회 그리디로 수행해 "총 제거 수"를 직접 최대화
    return buildGreedyPlan(g, rects).total;
  }

  function mctsSearch(g, timeLimitMs) {
    const start = performance.now();
    const allRects = findAllRects(g);
    if (!allRects.length) return [];

    sortRectsByPriority(allRects);

    const candidates = allRects.slice(0, Math.min(40, allRects.length));
    const scores = new Float64Array(candidates.length);
    const counts = new Int32Array(candidates.length);

    let iter = 0;
    let totalVisits = 0;
    while (performance.now() - start < timeLimitMs * 0.85) {
      // UCB1 기반 후보 선택: 탐색/활용 균형
      let i = 0;
      let bestUcb = -Infinity;
      const logN = Math.log(totalVisits + 2);
      for (let k = 0; k < candidates.length; k++) {
        if (counts[k] === 0) { i = k; bestUcb = Infinity; break; }
        const avg = scores[k] / counts[k];
        const ucb = avg + 1.15 * Math.sqrt(logN / counts[k]);
        if (ucb > bestUcb) { bestUcb = ucb; i = k; }
      }

      const cand = candidates[i];
      const g2 = applyRect(g, cand.cells);
      const rects2 = findAllRects(g2);
      sortRectsByPriority(rects2);
      scores[i] += cand.count + simulate(g2, rects2);
      counts[i]++;
      totalVisits++;
      iter++;
    }

    let bestIdx = 0, bestAvg = -1;
    for (let i = 0; i < candidates.length; i++) {
      if (!counts[i]) continue;
      const avg = scores[i] / counts[i];
      if (avg > bestAvg) { bestAvg = avg; bestIdx = i; }
    }

    console.log(`[Bot] MCTS ${iter}회, 최선: count=${candidates[bestIdx].count} avg=${bestAvg.toFixed(1)}`);

    const firstMove = candidates[bestIdx];
    const g2 = applyRect(g, firstMove.cells);
    const remaining = findAllRects(g2);
    const restPlan = buildGreedyPlan(g2, remaining).plan;

    return [firstMove, ...restPlan];
  }

  function cellCorner(cr, row, col, isEnd) {
    const gL=cr.left+GL*cr.width, gR=cr.left+GR*cr.width;
    const gT=cr.top+GT*cr.height, gB=cr.top+GB*cr.height;
    const cW=(gR-gL)/COLS, cH=(gB-gT)/ROWS;
    return {
      x: isEnd ? gL+(col+1)*cW-1 : gL+col*cW+1,
      y: isEnd ? gT+(row+1)*cH-1 : gT+row*cH+1,
    };
  }

  async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function emitOn(el, type, cx, cy, buttons) {
    el.dispatchEvent(new PointerEvent(type, {
      bubbles:true, cancelable:true, view:window,
      clientX:cx, clientY:cy, buttons,
      button:type==='pointermove'?-1:0,
      pointerId:1, pointerType:'mouse', isPrimary:true,
      pressure:buttons>0?0.5:0,
    }));
    el.dispatchEvent(new MouseEvent(type.replace('pointer','mouse'), {
      bubbles:true, cancelable:true, view:window,
      clientX:cx, clientY:cy, buttons,
      button:type==='pointermove'?-1:0,
    }));
  }

  async function drag(el, cr, r1, c1, r2, c2) {
    const s = cellCorner(cr, r1, c1, false);
    const e = cellCorner(cr, r2, c2, true);
    emitOn(el, 'pointerdown', s.x, s.y, 1);
    await sleep(18);
    for (let i = 1; i <= 10; i++) {
      emitOn(el, 'pointermove', s.x+(e.x-s.x)*i/10, s.y+(e.y-s.y)*i/10, 1);
      await sleep(3);
    }
    emitOn(el, 'pointerup', e.x, e.y, 0);
    await sleep(18);
  }

  async function run() {
    const canvas = getCanvas();
    if (!canvas) { console.log('[Bot] 캔버스 없음'); return; }
    let cr = canvas.getBoundingClientRect();
    const el = document.elementFromPoint(cr.left+cr.width/2, cr.top+cr.height/2);
    console.log('[Bot] 시작! (MCTS + 전체 rect 탐색)');

    let lastBoard = '';
    let noProgressCount = 0;
    const gameStart = performance.now();

    while (window.__botRunning) {
      const elapsed = performance.now() - gameStart;
      if (elapsed > 118000) { console.log('[Bot] 시간 종료'); break; }

      const board = getBoard();
      if (!board) { await sleep(100); continue; }
      if (board === lastBoard) { await sleep(50); continue; }
      lastBoard = board;
      noProgressCount = 0;

      cr = canvas.getBoundingClientRect();
      const g = boardToGrid(board);
      const rem = countApples(g);
      console.log(`[Bot] 남은: ${rem}개 경과: ${(elapsed/1000).toFixed(1)}s`);

      const remainSec = 118 - elapsed/1000;
      const dragTimeSec = rem * 0.065;
      const searchMs = Math.max(80, Math.min(600, (remainSec - dragTimeSec) * 300));

      const plan = mctsSearch(g, searchMs);

      if (!plan.length) {
        noProgressCount++;
        if (noProgressCount > 5) { console.log('[Bot] 완료!'); break; }
        await sleep(100);
        continue;
      }

      for (const move of plan) {
        if (!window.__botRunning) break;
        cr = canvas.getBoundingClientRect();
        await drag(el, cr, move.r1, move.c1, move.r2, move.c2);
        await sleep(75);
      }

      let waited = 0;
      while (getBoard() === lastBoard && waited < 300) {
        await sleep(30); waited += 30;
      }
    }
    console.log('[Bot] 종료');
  }

  window.__botRunning = true;
  run();
  window.__stopBot = () => { window.__botRunning = false; console.log('[Bot] 중지'); };
  console.log('[Bot] 실행 중. 중지: __stopBot()');
})();
