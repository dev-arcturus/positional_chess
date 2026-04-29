require('dotenv').config();

const express = require('express');
const cors = require('cors');
const api = require('./src/api');
const engine = require('./src/engine');

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);

app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
}));
app.use(express.json({ limit: '64kb' }));

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/api', api);

let server = null;

engine.init()
  .then(() => {
    console.log(`Stockfish engine ready (pool size ${engine.size})`);
    server = app.listen(port, () => {
      console.log(`Server listening on http://localhost:${port}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize Stockfish:', err.message);
    console.error('Hint: install stockfish (`brew install stockfish` / `apt-get install stockfish`)');
    console.error('      or set STOCKFISH_PATH=/absolute/path/to/stockfish');
    process.exit(1);
  });

function shutdown(signal) {
  console.log(`\nReceived ${signal}, shutting down...`);
  const done = () => {
    try { engine.shutdown(); } catch { /* ignore */ }
    process.exit(0);
  };
  if (server) {
    server.close(done);
    setTimeout(done, 5000).unref();
  } else {
    done();
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
