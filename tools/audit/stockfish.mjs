// Stockfish UCI client.
//
// Maintains an in-memory queue of lines emitted by the engine. `waitFor` pops
// the FIRST line that matches the predicate, leaves the rest queued — so a
// caller can ingest every `info ...` line in order without ever losing one
// when several arrive in a single chunk.
//
// Score reported by UCI is side-to-move-POV centipawns. We translate to
// white-POV before returning so the caller can pass it to white-POV
// evaluators / classifiers without re-checking the sign convention.

import { spawn } from 'node:child_process';

const SF = '/opt/homebrew/bin/stockfish';

function whiteCp(stmIsWhite, scoreCp) {
  return stmIsWhite ? scoreCp : -scoreCp;
}

export class Stockfish {
  constructor() {
    this.proc = spawn(SF, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.lines = [];
    this.partial = '';
    this.proc.stdout.on('data', (chunk) => {
      this.partial += chunk.toString();
      const parts = this.partial.split('\n');
      this.partial = parts.pop(); // last is incomplete
      for (const p of parts) this.lines.push(p.replace(/\r$/, ''));
    });
    this.proc.stderr.on('data', () => {});
  }

  send(line) { this.proc.stdin.write(line + '\n'); }

  async waitFor(pred, timeoutMs = 60000) {
    const start = Date.now();
    while (true) {
      // Scan queue for the first matching line; pop only that.
      for (let i = 0; i < this.lines.length; i++) {
        if (pred(this.lines[i])) {
          const matched = this.lines[i];
          this.lines.splice(i, 1);
          return matched;
        }
      }
      if (Date.now() - start > timeoutMs) throw new Error('Stockfish timeout');
      await new Promise(r => setTimeout(r, 3));
    }
  }

  // Drain ALL currently-queued lines that match `pred` (e.g. all "info" lines
  // collected so far), leaving non-matching lines in the queue.
  drainMatching(pred) {
    const out = [];
    this.lines = this.lines.filter(line => {
      if (pred(line)) { out.push(line); return false; }
      return true;
    });
    return out;
  }

  async init() {
    this.send('uci');
    await this.waitFor(l => l === 'uciok');
    this.send('setoption name MultiPV value 5');
    this.send('setoption name Threads value 2');
    this.send('setoption name Hash value 64');
    this.send('isready');
    await this.waitFor(l => l === 'readyok');
  }

  async newgame() {
    this.send('ucinewgame');
    this.send('isready');
    await this.waitFor(l => l === 'readyok');
  }

  parseInfo(line) {
    const tok = line.split(/\s+/);
    const info = { rank: 1, cp: null, mate: null, depth: 0, pv: [] };
    for (let i = 0; i < tok.length; i++) {
      const t = tok[i];
      if (t === 'multipv') info.rank = parseInt(tok[++i]);
      else if (t === 'depth') info.depth = parseInt(tok[++i]);
      else if (t === 'cp') info.cp = parseInt(tok[++i]);
      else if (t === 'mate') info.mate = parseInt(tok[++i]);
      else if (t === 'pv') { info.pv = tok.slice(i + 1); break; }
    }
    return info;
  }

  // Search at fixed depth; collect ALL info lines, return per-rank deepest.
  async analyse(fen, depth = 18) {
    const stm = fen.split(' ')[1] === 'w';
    this.send(`position fen ${fen}`);
    this.send(`go depth ${depth}`);

    // Wait for the bestmove line to appear in the queue (gives the search
    // up to 90s wall time at the engine settings we use).
    const bestmoveLine = await this.waitFor(l => l.startsWith('bestmove'), 90000);
    const bestmove = bestmoveLine.split(/\s+/)[1];
    const infoLines = this.drainMatching(l => l.startsWith('info') && l.includes(' multipv '));
    const byRank = new Map();
    for (const l of infoLines) {
      const info = this.parseInfo(l);
      if (info.cp === null && info.mate === null) continue; // bound-only updates
      if (!info.pv.length) continue;
      const prev = byRank.get(info.rank);
      if (!prev || prev.depth < info.depth) byRank.set(info.rank, info);
    }
    const multipv = [...byRank.values()]
      .sort((a, b) => a.rank - b.rank)
      .map(i => ({
        rank: i.rank,
        score: i.mate !== null ? null : whiteCp(stm, i.cp),
        cp_stm: i.cp,
        mate: i.mate !== null ? (stm ? i.mate : -i.mate) : null,
        depth: i.depth,
        pv: i.pv,
      }));
    return { bestmove, multipv };
  }

  quit() {
    try { this.send('quit'); } catch {}
    try { this.proc.kill(); } catch {}
  }
}
