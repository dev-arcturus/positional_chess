const express = require('express');
const cors = require('cors');
const api = require('./src/api');
const engine = require('./src/engine');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

app.use('/api', api);

engine.init().then(() => {
  console.log('Stockfish engine ready');
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}).catch(err => {
  console.error('Failed to initialize Stockfish:', err);
});
