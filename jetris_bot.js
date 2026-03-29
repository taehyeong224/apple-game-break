// ============================================================
//  JETRIS 자동화 봇 v12.0
//  순수 El-Tetris 알고리즘 + 게임 rotate() 직접 사용
//  사용법: https://jetris.up.railway.app/ 콘솔에 붙여넣기
//  정지: __jetrisBot.stop()
// ============================================================
(function () {
  if (window.__jetrisBot) {
    window.__jetrisBot.stop();
    setTimeout(main, 300);
    return;
  }
  main();

  function main() {

    // ── board를 0/1로 변환 ───────────────────────────────────
    function toBinary(brd) {
      return brd.map(row => row.map(v => v ? 1 : 0));
    }

    // ── 시뮬레이션 ───────────────────────────────────────────
    function simIsValid(brd, px, py, blocks) {
      const R = brd.length, C = brd[0].length;
      for (const [bx, by] of blocks) {
        const x = px + bx, y = py + by;
        if (x < 0 || x >= C || y >= R) return false;
        if (y >= 0 && brd[y][x]) return false;
      }
      return true;
    }

    function simDrop(brd, px, blocks) {
      let py = 0;
      while (simIsValid(brd, px, py + 1, blocks)) py++;
      return py;
    }

    function simPlace(brd, px, py, blocks) {
      const nb = brd.map(r => [...r]);
      for (const [bx, by] of blocks) {
        const x = px + bx, y = py + by;
        if (y >= 0 && y < nb.length && x >= 0 && x < nb[0].length) nb[y][x] = 1;
      }
      const cleared = nb.filter(row => !row.every(v => v));
      const lines   = nb.length - cleared.length;
      while (cleared.length < nb.length) cleared.unshift(Array(nb[0].length).fill(0));
      return { board: cleared, lines };
    }

    // ── 게임 rotate()로 실제 회전 상태 수집 후 원상복구 ─────
    function getRotatedStates() {
      const savedX = pieceX;
      const savedY = pieceY;

      const states = [];
      const seenKeys = new Set();

      for (let rot = 0; rot < 4; rot++) {
        const key = JSON.stringify([...piece.blocks].sort((a,b)=>a[0]-b[0]||a[1]-b[1]));
        if (seenKeys.has(key)) break;
        seenKeys.add(key);
        states.push({ rot, blocks: piece.blocks.map(b=>[...b]), px: pieceX });
        rotate(); // 다음 회전으로
      }

      // 원상복구 (남은 횟수만큼 회전)
      for (let i = states.length; i < 4; i++) rotate();
      pieceX = savedX;
      pieceY = savedY;

      return states;
    }

    // ── El-Tetris 평가 (순수, col9 편향 없음) ───────────────
    function evaluate(brd, lines) {
      const R = brd.length, C = brd[0].length;
      const h = Array.from({length:C}, (_,c) => {
        for (let r=0; r<R; r++) if (brd[r][c]) return R-r;
        return 0;
      });
      const aggH = h.reduce((a,b)=>a+b, 0);
      const bump = h.slice(0,-1).reduce((s,v,i)=>s+Math.abs(v-h[i+1]), 0);
      let holes = 0;
      for (let c=0; c<C; c++) {
        let found=false;
        for (let r=0; r<R; r++) {
          if (brd[r][c]) found=true;
          else if (found) holes++;
        }
      }
      // El-Tetris 논문 가중치
      return - 0.510066 * aggH
             + 0.760666 * lines
             - 0.356630 * holes
             - 0.184483 * bump;
    }

    // ── 최적 이동 탐색 ───────────────────────────────────────
    function bestMove() {
      const brd    = toBinary(board);
      const C      = brd[0].length;
      const states = getRotatedStates();

      let best = { score:-Infinity, rot:0, targetX:pieceX };

      states.forEach(({rot, blocks, px: spawnX}) => {
        const minBX = Math.min(...blocks.map(([x])=>x));
        const maxBX = Math.max(...blocks.map(([x])=>x));
        const minPX = -minBX;
        const maxPX = C - 1 - maxBX;

        // 모든 피스 동일하게 탐색
        for (let px = minPX; px <= maxPX; px++) {
          if (!simIsValid(brd, px, 0, blocks)) continue;
          const py  = simDrop(brd, px, blocks);
          const res = simPlace(brd, px, py, blocks);
          const s   = evaluate(res.board, res.lines);
          if (s > best.score) best = { score:s, rot, targetX:px };
        }
      });

      return best;
    }

    // ── 실행 ─────────────────────────────────────────────────
    const delay = ms => new Promise(r => setTimeout(r, ms));

    async function executeMove(move) {
      // 1) 회전
      for (let i = 0; i < move.rot; i++) {
        rotate();
        await delay(25);
      }
      // 2) 좌우 이동
      const diff = move.targetX - pieceX;
      const key  = diff < 0 ? moveLeft : moveRight;
      for (let i = 0; i < Math.abs(diff); i++) {
        key();
        await delay(18);
      }
      // 3) 하드드롭
      await delay(20);
      hardDrop();
      await delay(180);
    }

    // ── 메인 루프 ────────────────────────────────────────────
    let running = true, busy = false, lastKey = null;

    async function tick() {
      if (!running) return;
      if (busy) { setTimeout(tick, 40); return; }
      busy = true;
      try {
        const k = JSON.stringify(piece?.blocks) + pieceY;
        if (k === lastKey) { busy=false; setTimeout(tick,50); return; }
        lastKey = k;

        const isI = piece.blocks.length===4 && (
          new Set(piece.blocks.map(([x])=>x)).size===1 ||
          new Set(piece.blocks.map(([,y])=>y)).size===1
        );
        const move = bestMove();
        console.log(`${isI?"🟦 I":"🎮"} rot:${move.rot} x:${move.targetX} (${move.score.toFixed(1)})`);
        await executeMove(move);
      } catch(e) { console.warn("오류:", e.message); }
      busy = false;
      setTimeout(tick, 40);
    }

    window.__jetrisBot = { stop:()=>{ running=false; console.log("🛑 봇 정지"); } };
    console.log(`
  ╔══════════════════════════════════════╗
  ║   JETRIS 자동화 봇 v12.0 🎮         ║
  ║   순수 El-Tetris 알고리즘            ║
  ║   정지: __jetrisBot.stop()           ║
  ╚══════════════════════════════════════╝`);
    tick();
  }
})();
