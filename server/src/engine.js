const { spawn } = require('child_process');
const path = require('path');

class StockfishEngine {
  constructor() {
    this.process = null;
    this.ready = false;
    this.queue = [];
    this.working = false;
  }

  init() {
    return new Promise((resolve, reject) => {
      try {
        const stockfishPath = process.env.STOCKFISH_PATH || 'stockfish';
        this.process = spawn(stockfishPath);

        this.process.stdout.on('data', (data) => {
          this.onData(data.toString());
        });

        this.process.stderr.on('data', (data) => {
          console.error(`Stockfish Error: ${data}`);
        });

        this.process.on('close', (code) => {
          console.log(`Stockfish process exited with code ${code}`);
        });

        this.sendCommand('uci');
        this.initResolve = resolve;
      } catch (e) {
        reject(e);
      }
    });
  }

  sendCommand(cmd) {
    if (this.process) {
      this.process.stdin.write(cmd + '\n');
    }
  }

  onData(data) {
    const lines = data.split('\n');
    for (const line of lines) {
      if (line.trim() === 'uciok') {
        this.ready = true;
        if (this.initResolve) {
          this.initResolve();
          this.initResolve = null;
        }
      }

      if (line.startsWith('bestmove')) {
        this.finishJob(line);
      }
    }

    if (this.currentJob && this.currentJob.onData) {
      this.currentJob.onData(data);
    }
  }

  parseScore(line) {
    if (line.includes('score mate')) {
      const parts = line.split(' ');
      const mateIndex = parts.indexOf('mate');
      if (mateIndex !== -1 && parts[mateIndex + 1]) {
        const mateIn = parseInt(parts[mateIndex + 1]);
        return { type: 'mate', value: mateIn, cp: mateIn > 0 ? 10000 - mateIn : -10000 - mateIn };
      }
    } else if (line.includes('score cp')) {
      const parts = line.split(' ');
      const scoreIndex = parts.indexOf('cp');
      if (scoreIndex !== -1 && parts[scoreIndex + 1]) {
        const cp = parseInt(parts[scoreIndex + 1]);
        return { type: 'cp', value: cp, cp };
      }
    }
    return null;
  }

  parsePV(line) {
    const pvIndex = line.indexOf(' pv ');
    if (pvIndex !== -1) {
      return line.substring(pvIndex + 4).trim().split(' ');
    }
    return [];
  }

  parseMultiPVIndex(line) {
    const match = line.match(/multipv (\d+)/);
    return match ? parseInt(match[1]) : 1;
  }

  async evaluate(fen, depth = 12) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        fen,
        depth,
        resolve,
        reject,
        type: 'eval'
      });
      this.processQueue();
    });
  }

  async analyzeMultiPV(fen, numLines = 5, depth = 12) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        fen,
        depth,
        numLines,
        resolve,
        reject,
        type: 'multipv'
      });
      this.processQueue();
    });
  }

  async getBestMove(fen, depth = 12) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        fen,
        depth,
        resolve,
        reject,
        type: 'bestmove'
      });
      this.processQueue();
    });
  }

  processQueue() {
    if (this.working || this.queue.length === 0) return;

    this.working = true;
    this.currentJob = this.queue.shift();

    this.currentJob.score = null;
    this.currentJob.bestMove = null;
    this.currentJob.ponderMove = null;
    this.currentJob.lines = {};

    if (this.currentJob.type === 'multipv') {
      this.sendCommand(`setoption name MultiPV value ${this.currentJob.numLines}`);

      this.currentJob.onData = (data) => {
        const lines = data.split('\n');
        for (const line of lines) {
          if (line.startsWith('info') && line.includes('score') && line.includes(' pv ')) {
            const mpvIndex = this.parseMultiPVIndex(line);
            const score = this.parseScore(line);
            const pv = this.parsePV(line);

            if (score && pv.length > 0) {
              this.currentJob.lines[mpvIndex] = {
                rank: mpvIndex,
                move: pv[0],
                pv: pv.slice(0, 5),
                score: score.cp,
                isMate: score.type === 'mate',
                mateIn: score.type === 'mate' ? score.value : null
              };
            }
          }
        }
      };
    } else if (this.currentJob.type === 'bestmove') {
      this.currentJob.onData = (data) => {
        const lines = data.split('\n');
        for (const line of lines) {
          if (line.startsWith('info') && line.includes('score') && line.includes(' pv ')) {
            const score = this.parseScore(line);
            const pv = this.parsePV(line);
            if (score) {
              this.currentJob.score = score.cp;
              this.currentJob.pv = pv;
            }
          }
        }
      };
    } else {
      // Standard eval
      this.currentJob.onData = (data) => {
        const lines = data.split('\n');
        for (const line of lines) {
          if (line.startsWith('info') && line.includes('score')) {
            const score = this.parseScore(line);
            if (score) {
              this.currentJob.score = score.cp;
            }
          }
        }
      };
    }

    this.sendCommand(`position fen ${this.currentJob.fen}`);
    this.sendCommand(`go depth ${this.currentJob.depth}`);
  }

  finishJob(bestMoveLine) {
    if (!this.currentJob) return;

    const parts = bestMoveLine.split(' ');
    const bestMove = parts[1];
    const ponderMove = parts[3] || null;

    if (this.currentJob.type === 'multipv') {
      // Reset MultiPV to 1 for other analyses
      this.sendCommand('setoption name MultiPV value 1');

      const results = Object.values(this.currentJob.lines)
        .sort((a, b) => a.rank - b.rank)
        .slice(0, this.currentJob.numLines);

      this.currentJob.resolve({
        moves: results,
        bestMove,
        score: results[0]?.score ?? 0
      });
    } else if (this.currentJob.type === 'bestmove') {
      this.currentJob.resolve({
        bestMove,
        ponderMove,
        score: this.currentJob.score ?? 0,
        pv: this.currentJob.pv || [bestMove]
      });
    } else {
      this.currentJob.resolve(this.currentJob.score ?? 0);
    }

    this.currentJob = null;
    this.working = false;
    this.processQueue();
  }
}

module.exports = new StockfishEngine();

