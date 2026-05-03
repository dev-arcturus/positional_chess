// End-to-end audit harness.
//
// For each seed FEN:
//   1. Stockfish multipv 5 → ground-truth eval + top moves.
//   2. WASM evaluate_fen → our HCE breakdown for the position.
//   3. WASM explain_position → structured "why" blob.
//   4. For each candidate move:
//        a. WASM analyze(fen, uci) → motifs + fen_after.
//        b. WASM evaluate_fen(fen_after) → our HCE after.
//        c. Lichess-style quality from SF win-rate loss.
//   5. Append a structured record. Emit JSON + Markdown.
//
// Run: `node tools/audit/audit.mjs [count]`
//
// The audit is read-only — no app side-effects, no commits. The whole point
// is to iterate the analyzer until the report says it explains Stockfish
// correctly position-by-position.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Stockfish } from './stockfish.mjs';
import { loadWasm } from './wasm.mjs';
import { SEED } from './seed.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_JSON = join(HERE, 'report.json');
const OUT_MD = join(HERE, 'report.md');

const DEPTH = parseInt(process.env.SF_DEPTH || '18');

// ── Lichess win-rate model (same constants as client/src/engine/explainer.js)
function winRate(cpWhite) {
  const k = -0.00368208;
  const x = Math.max(-1000, Math.min(1000, cpWhite));
  return 50 + 50 * (2 / (1 + Math.exp(k * x)) - 1);
}

function classifyLoss(wrLoss) {
  if (wrLoss < 1) return 'best';
  if (wrLoss < 4) return 'excellent';
  if (wrLoss < 8) return 'good';
  if (wrLoss < 12) return 'neutral';
  if (wrLoss < 20) return 'inaccuracy';
  if (wrLoss < 30) return 'mistake';
  return 'blunder';
}

function fmtCp(v) {
  if (v == null) return '   – ';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${(v / 100).toFixed(2)}`;
}

function fmtMate(mate) {
  if (mate == null) return null;
  return mate > 0 ? `M${mate}` : `M-${-mate}`;
}

function fmtScore(scoreCp, mate) {
  return mate != null ? fmtMate(mate) : fmtCp(scoreCp);
}

function uciToSquares(uci) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promo: uci.slice(4) || null };
}

// serde-wasm-bindgen sometimes returns plain objects, sometimes JS Maps
// (notably when serialising `serde_json::Value` instances).  Normalise so
// downstream code can use plain `.field` access either way.
function unwrap(v) {
  if (v == null) return v;
  if (v instanceof Map) {
    const out = {};
    for (const [k, val] of v) out[k] = unwrap(val);
    return out;
  }
  if (Array.isArray(v)) return v.map(unwrap);
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = unwrap(v[k]);
    return out;
  }
  return v;
}

async function auditOne(sf, w, entry, idx) {
  const { fen, note, kind } = entry;
  const stm = fen.split(' ')[1];

  // Stockfish ground truth.
  const gt = await sf.analyse(fen, DEPTH);
  const sfEvalWhite = gt.multipv[0]?.score ?? 0;
  const sfMate = gt.multipv[0]?.mate ?? null;

  // Our HCE evaluation.
  const ourEval = unwrap(w.evaluate_fen(fen));
  const ourExpl = unwrap(w.explain_position(fen));
  if (ourEval?.error) {
    return { idx, note, kind, fen, stm, error: `evaluate_fen: ${ourEval.error}` };
  }

  // Per-move records.
  const moves = [];
  for (const c of gt.multipv) {
    const a = unwrap(w.analyze(fen, c.pv[0]));
    if (!a || a.error) {
      moves.push({ rank: c.rank, uci: c.pv[0], error: a?.error || 'no result' });
      continue;
    }
    let ourAfterWhite = null;
    try {
      const evAfter = unwrap(w.evaluate_fen(a.fen_after));
      ourAfterWhite = evAfter?.final_cp ?? null;
    } catch {}

    // Quality vs SF best.
    const sfAfter = c.score;
    const wrBest = winRate(gt.multipv[0].score ?? 0);
    const wrPlayed = winRate(sfAfter ?? 0);
    // For STM: loss is from THEIR perspective. winRate is white-POV;
    // black "loss" = wrPlayed - wrBest (positive when they let white gain).
    const wrLoss = stm === 'w'
      ? Math.max(0, wrBest - wrPlayed)
      : Math.max(0, wrPlayed - wrBest);
    const quality = c.rank === 1 ? 'best' : classifyLoss(wrLoss);

    moves.push({
      rank: c.rank,
      uci: c.pv[0],
      san: a.san,
      quality,
      sf_cp_white_after: sfAfter,
      sf_mate: c.mate,
      our_cp_white_after: ourAfterWhite,
      sf_delta_stm: stm === 'w' ? (sfAfter - sfEvalWhite) : (sfEvalWhite - sfAfter),
      our_delta_stm: stm === 'w' ? (ourAfterWhite - ourEval.final_cp) : (ourEval.final_cp - ourAfterWhite),
      wr_loss: +wrLoss.toFixed(2),
      motifs: (a.motifs || []).map(m => ({ id: m.id, priority: m.priority, phrase: m.phrase })),
      pv: c.pv.slice(0, 6),
    });
  }

  return {
    idx,
    note,
    kind,
    fen,
    stm,
    sf_eval_white: sfEvalWhite,
    our_eval_white: ourEval.final_cp,
    our_phase: ourEval.phase,
    our_breakdown: {
      material: { mg: ourEval.white.material.mg - ourEval.black.material.mg,
                  eg: ourEval.white.material.eg - ourEval.black.material.eg },
      psqt: { mg: ourEval.white.psqt.mg - ourEval.black.psqt.mg,
              eg: ourEval.white.psqt.eg - ourEval.black.psqt.eg },
      mobility: { mg: ourEval.white.mobility.mg - ourEval.black.mobility.mg,
                  eg: ourEval.white.mobility.eg - ourEval.black.mobility.eg },
      pawns: { mg: ourEval.white.pawns.mg - ourEval.black.pawns.mg,
               eg: ourEval.white.pawns.eg - ourEval.black.pawns.eg },
      king_safety: { mg: ourEval.white.king_safety.mg - ourEval.black.king_safety.mg,
                     eg: ourEval.white.king_safety.eg - ourEval.black.king_safety.eg },
      threats: { mg: ourEval.white.threats.mg - ourEval.black.threats.mg,
                 eg: ourEval.white.threats.eg - ourEval.black.threats.eg },
      imbalance: { mg: ourEval.white.imbalance.mg - ourEval.black.imbalance.mg,
                   eg: ourEval.white.imbalance.eg - ourEval.black.imbalance.eg },
    },
    verdict: ourExpl.verdict,
    themes: (ourExpl.themes || []).map(t => t.text || t.id || JSON.stringify(t)),
    tactics_summary: ourExpl.tactics?.summary || '',
    moves,
  };
}

function fmtRecordMd(r) {
  const lines = [];
  const sfPawns = (r.sf_eval_white / 100).toFixed(2);
  const ourPawns = (r.our_eval_white / 100).toFixed(2);
  const diff = r.sf_eval_white - r.our_eval_white;
  const diffPawns = (diff / 100).toFixed(2);
  const evalNote = Math.abs(diff) >= 100 ? '  ⚠️ |Δ|≥1.0 pawn' : '';

  lines.push(`### ${r.idx + 1}. ${r.note}  _(${r.kind}, ${r.stm} to move)_`);
  lines.push('');
  lines.push('```');
  lines.push(`fen:      ${r.fen}`);
  lines.push(`SF eval:  ${sfPawns} (white-POV)`);
  lines.push(`HCE eval: ${ourPawns} (white-POV)   diff=${diffPawns}${evalNote}`);
  lines.push(`phase:    ${r.our_phase}/24`);
  lines.push(`verdict:  ${r.verdict}`);
  lines.push('```');
  lines.push('');
  lines.push('**HCE breakdown (white − black, mg/eg):**');
  lines.push('');
  lines.push('| term | mg | eg |');
  lines.push('|---|---|---|');
  for (const k of Object.keys(r.our_breakdown)) {
    const v = r.our_breakdown[k];
    lines.push(`| ${k} | ${v.mg} | ${v.eg} |`);
  }
  lines.push('');

  if (r.themes.length) {
    lines.push('**Themes:** ' + r.themes.slice(0, 5).join('; '));
    lines.push('');
  }
  if (r.tactics_summary) {
    lines.push('**Tactics:** ' + r.tactics_summary);
    lines.push('');
  }

  lines.push('**Top moves:**');
  lines.push('');
  lines.push('| # | move | quality | sfΔ | hceΔ | motifs |');
  lines.push('|---|---|---|---|---|---|');
  for (const m of r.moves) {
    if (m.error) {
      lines.push(`| ${m.rank} | ${m.uci} | _err_ | – | – | ${m.error} |`);
      continue;
    }
    const sfd = fmtCp(m.sf_delta_stm);
    const hced = fmtCp(m.our_delta_stm);
    const mots = m.motifs.length === 0 ? '–'
      : m.motifs.slice(0, 6).map(x => x.id).join(', ')
        + (m.motifs.length > 6 ? `, +${m.motifs.length - 6}` : '');
    lines.push(`| ${m.rank} | ${m.san} (${m.uci}) | **${m.quality}** | ${sfd} | ${hced} | ${mots} |`);
  }
  lines.push('');

  // Full motif phrases for top-3 (so we can read taglines)
  const top3 = r.moves.filter(m => !m.error).slice(0, 3);
  for (const m of top3) {
    if (m.motifs.length === 0) continue;
    lines.push(`<details><summary>Phrases for ${m.san}</summary>`);
    lines.push('');
    for (const mo of m.motifs) {
      lines.push(`- (${mo.priority}) **${mo.id}** — ${mo.phrase}`);
    }
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  const limit = parseInt(process.argv[2] || '999');
  const corpus = SEED.slice(0, limit);

  const sf = new Stockfish();
  await sf.init();
  const w = await loadWasm();

  const records = [];
  for (let i = 0; i < corpus.length; i++) {
    const e = corpus[i];
    process.stderr.write(`[${i + 1}/${corpus.length}] ${e.note.slice(0, 50)}\n`);
    try {
      await sf.newgame();
      const r = await auditOne(sf, w, e, i);
      records.push(r);
    } catch (err) {
      process.stderr.write(`  ERROR: ${err.message}\n`);
      records.push({ idx: i, note: e.note, kind: e.kind, fen: e.fen, error: err.message });
    }
  }
  sf.quit();

  await writeFile(OUT_JSON, JSON.stringify(records, null, 2));

  const md = [
    `# HCE-vs-Stockfish position-by-position audit`,
    '',
    `Stockfish depth: ${DEPTH}.  Generated: ${new Date().toISOString()}.  Positions: ${records.length}.`,
    '',
    'For each position the table shows our top-5 candidate moves alongside the',
    'Stockfish eval delta (`sfΔ`, side-to-move POV) and the HCE eval delta',
    '(`hceΔ`).  When `|hceΔ − sfΔ|` is large the HCE is mis-attributing the',
    'value of the move; when motifs are wrong the tagline will be wrong.',
    '',
    '---',
    '',
    ...records.filter(r => !r.error).map(fmtRecordMd),
  ].join('\n');

  await writeFile(OUT_MD, md);
  process.stderr.write(`\nwrote ${OUT_JSON} and ${OUT_MD}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
