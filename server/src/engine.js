const { spawn } = require('child_process');

const DEFAULT_DEPTH = 12;
const DEFAULT_JOB_TIMEOUT_MS = 15_000;
const DEFAULT_INIT_TIMEOUT_MS = 10_000;
const DEFAULT_POOL_SIZE = 1;
const DEFAULT_CACHE_SIZE = 1000;

class LRU {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.map = new Map();
  }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.maxSize) {
      this.map.delete(this.map.keys().next().value);
    }
  }
  clear() { this.map.clear(); }
}

function parseScore(line) {
  const m = line.match(/score (cp|mate) (-?\d+)/);
  if (!m) return null;
  const value = parseInt(m[2], 10);
  if (m[1] === 'mate') {
    const cp = value > 0 ? 100_000 - value : -100_000 - value;
    return { type: 'mate', value, cp };
  }
  return { type: 'cp', value, cp: value };
}

function parsePV(line) {
  const idx = line.indexOf(' pv ');
  if (idx === -1) return [];
  return line.substring(idx + 4).trim().split(/\s+/);
}

function parseMultiPV(line) {
  const m = line.match(/multipv (\d+)/);
  return m ? parseInt(m[1], 10) : 1;
}

class StockfishWorker {
  constructor(stockfishPath, jobTimeoutMs, initTimeoutMs) {
    this.stockfishPath = stockfishPath;
    this.jobTimeoutMs = jobTimeoutMs;
    this.initTimeoutMs = initTimeoutMs;
    this.process = null;
    this.ready = false;
    this.buffer = '';
    this.queue = [];
    this.currentJob = null;
    this.working = false;
    this.lastMultiPV = 1;
    this._initResolve = null;
    this._initReject = null;
    this._initTimer = null;
  }

  init() {
    return new Promise((resolve, reject) => {
      this._initResolve = resolve;
      this._initReject = reject;

      try {
        this.process = spawn(this.stockfishPath);
      } catch (err) {
        return reject(new Error(
          `Failed to spawn Stockfish at "${this.stockfishPath}": ${err.message}`
        ));
      }

      this.process.on('error', err => {
        if (this._initReject) {
          this._initReject(new Error(
            `Stockfish failed to start at "${this.stockfishPath}" (set STOCKFISH_PATH or install stockfish): ${err.message}`
          ));
          this._clearInit();
        } else {
          this._failCurrentJob(err);
        }
      });

      this.process.stdout.on('data', chunk => this._onChunk(chunk));
      this.process.stderr.on('data', d => console.error(`[stockfish stderr] ${d}`));

      this.process.on('close', code => {
        if (this._initReject) {
          this._initReject(new Error(`Stockfish exited during init (code ${code})`));
          this._clearInit();
        }
        this.ready = false;
        this._failCurrentJob(new Error(`Stockfish exited (code ${code})`));
      });

      this._initTimer = setTimeout(() => {
        if (this._initReject) {
          this._initReject(new Error(
            `Stockfish init timed out after ${this.initTimeoutMs}ms (no readyok)`
          ));
          this._clearInit();
        }
      }, this.initTimeoutMs);

      this._send('uci');
      this._send('isready');
    });
  }

  _clearInit() {
    if (this._initTimer) clearTimeout(this._initTimer);
    this._initTimer = null;
    this._initResolve = null;
    this._initReject = null;
  }

  shutdown() {
    if (this.process && !this.process.killed) {
      try { this._send('quit'); } catch { /* ignore */ }
      try { this.process.kill(); } catch { /* ignore */ }
    }
    this.ready = false;
  }

  _send(cmd) {
    if (this.process && !this.process.killed && this.process.stdin.writable) {
      this.process.stdin.write(cmd + '\n');
    }
  }

  _onChunk(chunk) {
    this.buffer += chunk.toString();
    const parts = this.buffer.split('\n');
    this.buffer = parts.pop();
    for (const raw of parts) {
      const line = raw.replace(/\r$/, '').trim();
      if (line) this._onLine(line);
    }
  }

  _onLine(line) {
    if (line === 'readyok') {
      if (this._initResolve) {
        this.ready = true;
        this._initResolve();
        this._clearInit();
        setImmediate(() => this._processQueue());
      }
      return;
    }
    if (line.startsWith('bestmove')) {
      this._finishJob(line);
      return;
    }
    if (this.currentJob && this.currentJob.onLine) {
      this.currentJob.onLine(line);
    }
  }

  busyScore() {
    return this.queue.length + (this.working ? 1 : 0);
  }

  evaluate(fen, depth = DEFAULT_DEPTH) {
    return this._enqueue({ type: 'eval', fen, depth });
  }

  analyzeMultiPV(fen, numLines = 5, depth = DEFAULT_DEPTH) {
    return this._enqueue({
      type: 'multipv',
      fen,
      depth,
      numLines: Math.max(1, Math.min(numLines, 10)),
    });
  }

  getBestMove(fen, depth = DEFAULT_DEPTH) {
    return this._enqueue({ type: 'bestmove', fen, depth });
  }

  _enqueue(job) {
    return new Promise((resolve, reject) => {
      this.queue.push({ ...job, resolve, reject });
      this._processQueue();
    });
  }

  _processQueue() {
    if (this.working || !this.ready || this.queue.length === 0) return;

    this.working = true;
    const job = this.queue.shift();
    this.currentJob = job;
    job.scoreObj = null;
    job.bestPV = [];
    job.lines = {};

    if (job.type === 'multipv') {
      this._send(`setoption name MultiPV value ${job.numLines}`);
      this.lastMultiPV = job.numLines;

      job.onLine = (line) => {
        if (line.startsWith('info') && line.includes(' score ') && line.includes(' pv ')) {
          const mpv = parseMultiPV(line);
          const score = parseScore(line);
          const pv = parsePV(line);
          if (score && pv.length > 0) {
            job.lines[mpv] = {
              rank: mpv,
              move: pv[0],
              pv: pv.slice(0, 5),
              score: score.cp,
              cp: score.type === 'cp' ? score.value : null,
              mate: score.type === 'mate' ? score.value : null,
              isMate: score.type === 'mate',
            };
          }
        }
      };
    } else {
      if (this.lastMultiPV !== 1) {
        this._send('setoption name MultiPV value 1');
        this.lastMultiPV = 1;
      }
      job.onLine = (line) => {
        if (line.startsWith('info') && line.includes(' score ')) {
          const score = parseScore(line);
          if (score) job.scoreObj = score;
          if (job.type === 'bestmove') {
            const pv = parsePV(line);
            if (pv.length > 0) job.bestPV = pv;
          }
        }
      };
    }

    job._timer = setTimeout(() => {
      job._timedOut = true;
      this._send('stop');
      job._guardTimer = setTimeout(() => {
        this._abortCurrentJob(new Error(
          `Stockfish job timed out after ${this.jobTimeoutMs}ms`
        ));
      }, 2000);
    }, this.jobTimeoutMs);

    this._send(`position fen ${job.fen}`);
    this._send(`go depth ${job.depth}`);
  }

  _abortCurrentJob(err) {
    const job = this.currentJob;
    if (!job) return;
    if (job._timer) clearTimeout(job._timer);
    if (job._guardTimer) clearTimeout(job._guardTimer);
    try { job.reject(err); } catch { /* ignore */ }
    this.currentJob = null;
    this.working = false;
    setImmediate(() => this._processQueue());
  }

  _failCurrentJob(err) {
    this._abortCurrentJob(err);
  }

  _finishJob(line) {
    const job = this.currentJob;
    if (!job) return;
    if (job._timer) clearTimeout(job._timer);
    if (job._guardTimer) clearTimeout(job._guardTimer);

    if (job._timedOut) {
      try { job.reject(new Error('Stockfish search aborted (timeout)')); } catch { /* ignore */ }
      this.currentJob = null;
      this.working = false;
      setImmediate(() => this._processQueue());
      return;
    }

    const parts = line.split(/\s+/);
    const bestMove = parts[1];
    const ponderMove = parts[3] || null;
    const so = job.scoreObj;
    const cp = so ? so.cp : 0;
    const mate = so && so.type === 'mate' ? so.value : null;

    if (job.type === 'multipv') {
      const results = Object.values(job.lines)
        .sort((a, b) => a.rank - b.rank)
        .slice(0, job.numLines);
      const top = results[0] || {};
      job.resolve({
        moves: results,
        bestMove,
        score: top.score ?? 0,
        cp: top.cp ?? null,
        mate: top.mate ?? null,
      });
    } else if (job.type === 'bestmove') {
      job.resolve({
        bestMove,
        ponderMove,
        score: cp,
        cp: so && so.type === 'cp' ? so.value : null,
        mate,
        pv: job.bestPV.length > 0 ? job.bestPV : [bestMove],
      });
    } else {
      job.resolve({
        cp,
        mate,
        score: cp,
      });
    }

    this.currentJob = null;
    this.working = false;
    setImmediate(() => this._processQueue());
  }
}

class StockfishPool {
  constructor(opts = {}) {
    const stockfishPath =
      opts.stockfishPath ?? process.env.STOCKFISH_PATH ?? 'stockfish';
    const size = Math.max(1, opts.size ?? parseInt(
      process.env.STOCKFISH_POOL_SIZE || `${DEFAULT_POOL_SIZE}`, 10
    ));
    const jobTimeoutMs = opts.jobTimeoutMs ?? parseInt(
      process.env.STOCKFISH_TIMEOUT_MS || `${DEFAULT_JOB_TIMEOUT_MS}`, 10
    );
    const initTimeoutMs = opts.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS;
    const cacheSize = opts.cacheSize ?? parseInt(
      process.env.STOCKFISH_CACHE_SIZE || `${DEFAULT_CACHE_SIZE}`, 10
    );

    this.stockfishPath = stockfishPath;
    this.size = size;
    this.workers = Array.from({ length: size }, () =>
      new StockfishWorker(stockfishPath, jobTimeoutMs, initTimeoutMs)
    );
    this.cache = new LRU(cacheSize);
    this._rr = 0;
  }

  async init() {
    await Promise.all(this.workers.map(w => w.init()));
  }

  shutdown() {
    for (const w of this.workers) w.shutdown();
  }

  _pickWorker() {
    let minBusy = Infinity;
    let best = this.workers[0];
    for (const w of this.workers) {
      const b = w.busyScore();
      if (b < minBusy) {
        minBusy = b;
        best = w;
      }
    }
    if (this.size > 1) {
      this._rr = (this._rr + 1) & 0x7fffffff;
    }
    return best;
  }

  async evaluate(fen, depth = DEFAULT_DEPTH) {
    const key = `e|${fen}|${depth}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const result = await this._pickWorker().evaluate(fen, depth);
    this.cache.set(key, result);
    return result;
  }

  async analyzeMultiPV(fen, numLines = 5, depth = DEFAULT_DEPTH) {
    const n = Math.max(1, Math.min(numLines, 10));
    const key = `m|${fen}|${n}|${depth}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const result = await this._pickWorker().analyzeMultiPV(fen, n, depth);
    this.cache.set(key, result);
    return result;
  }

  async getBestMove(fen, depth = DEFAULT_DEPTH) {
    const key = `b|${fen}|${depth}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const result = await this._pickWorker().getBestMove(fen, depth);
    this.cache.set(key, result);
    return result;
  }
}

const pool = new StockfishPool();
pool.StockfishPool = StockfishPool;
pool.StockfishWorker = StockfishWorker;
pool.LRU = LRU;

module.exports = pool;
