# HCE-vs-Stockfish position-by-position audit

Stockfish depth: 16.  Generated: 2026-05-03T19:13:16.822Z.  Positions: 35.

For each position the table shows our top-5 candidate moves alongside the
Stockfish eval delta (`sfΔ`, side-to-move POV) and the HCE eval delta
(`hceΔ`).  When `|hceΔ − sfΔ|` is large the HCE is mis-attributing the
value of the move; when motifs are wrong the tagline will be wrong.

---

### 1. Starting position  _(opening, w to move)_

```
fen:      rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1
SF eval:  0.34 (white-POV)
HCE eval: 0.00 (white-POV)   diff=0.34
phase:    24/24
verdict:  Roughly equal
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 0 | 0 |
| psqt | 0 | 0 |
| mobility | 0 | 0 |
| pawns | 0 | 0 |
| king_safety | 0 | 0 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | e4 (e2e4) | **best** | +0.00 | +0.94 | centralizes |
| 2 | d4 (d2d4) | **best** | -0.08 | +0.93 | centralizes |
| 3 | Nf3 (g1f3) | **excellent** | -0.12 | +0.58 | develops |
| 4 | c4 (c2c4) | **excellent** | -0.13 | +0.31 | centralizes |
| 5 | e3 (e2e3) | **excellent** | -0.13 | +0.88 | – |

<details><summary>Phrases for e4</summary>

- (82) **centralizes** — Stakes a claim in the center

</details>

<details><summary>Phrases for d4</summary>

- (82) **centralizes** — Stakes a claim in the center

</details>

<details><summary>Phrases for Nf3</summary>

- (200) **develops** — Develops the knight

</details>

### 2. After 1.e4 e5  _(opening, w to move)_

```
fen:      rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2
SF eval:  0.33 (white-POV)
HCE eval: 0.00 (white-POV)   diff=0.33
phase:    24/24
verdict:  Roughly equal
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 0 | 0 |
| psqt | 0 | 0 |
| mobility | 0 | 0 |
| pawns | 0 | 0 |
| king_safety | 0 | 0 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | Nf3 (g1f3) | **best** | +0.00 | +0.42 | attacks_pawn, develops |
| 2 | Nc3 (b1c3) | **best** | -0.02 | +0.55 | develops |
| 3 | d4 (d2d4) | **excellent** | -0.19 | +0.83 | centralizes, pawn_lever |
| 4 | Ne2 (g1e2) | **excellent** | -0.29 | -0.22 | develops |
| 5 | Bc4 (f1c4) | **excellent** | -0.31 | +0.32 | pin, develops |

<details><summary>Phrases for Nf3</summary>

- (70) **attacks_pawn** — Threatens the e-pawn
- (200) **develops** — Develops the knight

</details>

<details><summary>Phrases for Nc3</summary>

- (200) **develops** — Develops the knight

</details>

<details><summary>Phrases for d4</summary>

- (82) **centralizes** — Stakes a claim in the center
- (91) **pawn_lever** — Creates a pawn lever

</details>

### 3. 1.e4 e5 2.Nf3 Nf6 — Petroff  _(opening, w to move)_

```
fen:      rnbqkb1r/pppp1ppp/5n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3
SF eval:  0.46 (white-POV)
HCE eval: 0.00 (white-POV)   diff=0.46
phase:    24/24
verdict:  Roughly equal
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 0 | 0 |
| psqt | 0 | 0 |
| mobility | 0 | 0 |
| pawns | 0 | 0 |
| king_safety | 0 | 0 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Themes:** hanging_pieces; hanging_pieces

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | Nxe5 (f3e5) | **best** | +0.00 | +1.40 | capture, attacks_king, centralizes |
| 2 | d4 (d2d4) | **excellent** | -0.14 | +0.86 | centralizes, pawn_lever |
| 3 | Nc3 (b1c3) | **excellent** | -0.25 | +0.55 | defends, develops |
| 4 | d3 (d2d3) | **good** | -0.49 | +0.59 | defends |
| 5 | c3 (c2c3) | **good** | -0.58 | +0.20 | – |

<details><summary>Phrases for Nxe5</summary>

- (19) **capture** — Captures the pawn
- (72) **attacks_king** — Knight on e5 attacks 2 squares around the king (d7, f7)
- (82) **centralizes** — Centralizes the piece

</details>

<details><summary>Phrases for d4</summary>

- (82) **centralizes** — Stakes a claim in the center
- (91) **pawn_lever** — Creates a pawn lever

</details>

<details><summary>Phrases for Nc3</summary>

- (83) **defends** — Defends the pawn
- (200) **develops** — Develops the knight

</details>

### 4. Italian: White Bc4 set up  _(opening, b to move)_

```
fen:      r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3
SF eval:  0.25 (white-POV)
HCE eval: 0.23 (white-POV)   diff=0.02
phase:    24/24
verdict:  Roughly equal
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 0 | 0 |
| psqt | 28 | 26 |
| mobility | -5 | 5 |
| pawns | 0 | 0 |
| king_safety | 0 | 0 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | Bc5 (f8c5) | **best** | +0.00 | +0.32 | develops |
| 2 | d6 (d7d6) | **best** | -0.09 | +0.47 | – |
| 3 | Nf6 (g8f6) | **best** | -0.09 | +0.42 | attacks_pawn, develops |
| 4 | Be7 (f8e7) | **excellent** | -0.15 | -0.03 | develops |
| 5 | a6 (a7a6) | **good** | -0.46 | +0.24 | – |

<details><summary>Phrases for Bc5</summary>

- (200) **develops** — Develops the bishop

</details>

<details><summary>Phrases for Nf6</summary>

- (70) **attacks_pawn** — Threatens the e-pawn
- (200) **develops** — Develops the knight

</details>

### 5. Pirc / KID-ish setup  _(opening, w to move)_

```
fen:      rnbqk2r/ppp1ppbp/3p1np1/8/3PP3/2N2N2/PPP2PPP/R1BQKB1R w KQkq - 0 5
SF eval:  0.54 (white-POV)
HCE eval: 0.66 (white-POV)   diff=-0.12
phase:    24/24
verdict:  Slight edge for White
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 0 | 0 |
| psqt | 47 | 24 |
| mobility | 35 | 43 |
| pawns | -16 | 0 |
| king_safety | 0 | 0 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Themes:** piece_activity; space_advantage; leading_factor

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | Be3 (c1e3) | **best** | +0.00 | +0.39 | develops |
| 2 | h3 (h2h3) | **best** | +0.00 | +0.25 | – |
| 3 | Bg5 (c1g5) | **best** | +0.00 | +0.68 | develops |
| 4 | Bf4 (c1f4) | **best** | -0.07 | +0.42 | develops |
| 5 | Bd3 (f1d3) | **excellent** | -0.12 | +0.31 | prepares_castling_kingside, develops |

<details><summary>Phrases for Be3</summary>

- (200) **develops** — Develops the bishop

</details>

<details><summary>Phrases for Bg5</summary>

- (200) **develops** — Develops the bishop

</details>

### 6. QGD-ish; both sides developed  _(middlegame, w to move)_

```
fen:      r1bq1rk1/pp1n1ppp/2pbpn2/3p4/2PP4/2NBPN2/PP1Q1PPP/R3K2R w KQ - 0 9
SF eval:  -4.79 (white-POV)
HCE eval: -3.96 (white-POV)   diff=-0.83
phase:    23/24
verdict:  Black winning (+4.0)
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | -365 | -297 |
| psqt | -29 | 46 |
| mobility | 29 | 64 |
| pawns | -8 | 0 |
| king_safety | 0 | 0 |
| threats | 0 | 0 |
| imbalance | -30 | -50 |

**Themes:** material_edge; bishop_pair; dark_complex; leading_factor

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | g4 (g2g4) | **best** | +0.00 | -0.26 | – |
| 2 | O-O-O (e1c1) | **best** | -0.01 | +0.39 | castles_queenside, connects_rooks |
| 3 | Qc2 (d2c2) | **best** | -0.22 | +0.21 | – |
| 4 | c5 (c4c5) | **excellent** | -0.23 | +1.22 | threatens, opens_diagonal_for, restricts |
| 5 | cxd5 (c4d5) | **excellent** | -0.36 | +1.05 | piece_trade, opens_diagonal_for, pawn_break |

<details><summary>Phrases for O-O-O</summary>

- (31) **castles_queenside** — Castles queenside
- (201) **connects_rooks** — 

</details>

### 7. KID structure, central tension  _(middlegame, w to move)_

```
fen:      r1bq1rk1/pp1n1pbp/2pp1np1/4p3/P1PPP3/2N2N2/1P2BPPP/R1BQ1RK1 w - - 0 9
SF eval:  0.48 (white-POV)
HCE eval: 0.28 (white-POV)   diff=0.20
phase:    24/24
verdict:  Slight edge for White
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 0 | 0 |
| psqt | 23 | 21 |
| mobility | 33 | 68 |
| pawns | -28 | -3 |
| king_safety | 0 | 0 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Themes:** piece_activity; space_advantage

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | a5 (a4a5) | **best** | +0.00 | +0.22 | – |
| 2 | d5 (d4d5) | **best** | -0.07 | +0.42 | pawn_lever |
| 3 | Be3 (c1e3) | **excellent** | -0.15 | +0.38 | develops |
| 4 | Re1 (f1e1) | **excellent** | -0.22 | +0.16 | – |
| 5 | dxe5 (d4e5) | **excellent** | -0.26 | +1.16 | piece_trade, fork, removes_defender, opens_file_for, backward_pawn_them, pawn_break |

<details><summary>Phrases for d5</summary>

- (91) **pawn_lever** — Creates a pawn lever

</details>

<details><summary>Phrases for Be3</summary>

- (200) **develops** — Develops the bishop

</details>

### 8. Variation of QGD  _(middlegame, w to move)_

```
fen:      r2q1rk1/pp1n1ppp/2pbpn2/3p4/2PP4/2NBPN2/PP1Q1PPP/R3K2R w KQ - 0 9
SF eval:  0.02 (white-POV)
HCE eval: -0.45 (white-POV)   diff=0.47
phase:    22/24
verdict:  Slight edge for Black
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 0 | 0 |
| psqt | -43 | 23 |
| mobility | -2 | 15 |
| pawns | -8 | 0 |
| king_safety | 0 | 0 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Themes:** opposite_color_bishops; light_complex; dark_complex

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | O-O (e1g1) | **best** | +0.00 | +0.55 | castles_kingside, connects_rooks |
| 2 | Rd1 (a1d1) | **best** | -0.04 | +0.27 | loses_castling |
| 3 | g3 (g2g3) | **best** | -0.05 | +0.07 | – |
| 4 | a3 (a2a3) | **best** | -0.09 | +0.19 | – |
| 5 | Qc2 (d2c2) | **excellent** | -0.14 | +0.19 | – |

<details><summary>Phrases for O-O</summary>

- (30) **castles_kingside** — Castles kingside
- (201) **connects_rooks** — 

</details>

<details><summary>Phrases for Rd1</summary>

- (88) **loses_castling** — Forfeits queenside castling

</details>

### 9. Benoni-style, locked centre  _(middlegame, w to move)_

```
fen:      r1bq1rk1/pp2ppbp/n2p1np1/2pP4/2P5/2N2NP1/PP2PPBP/R1BQ1RK1 w - - 0 9
SF eval:  1.01 (white-POV)
HCE eval: 0.85 (white-POV)   diff=0.16
phase:    24/24
verdict:  White better (+0.9)
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 0 | 0 |
| psqt | 66 | 26 |
| mobility | 10 | 16 |
| pawns | 9 | 10 |
| king_safety | 0 | 0 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | e4 (e2e4) | **best** | +0.00 | +0.33 | centralizes |
| 2 | Bf4 (c1f4) | **best** | -0.04 | +0.38 | develops |
| 3 | Re1 (f1e1) | **best** | -0.06 | +0.05 | – |
| 4 | Bg5 (c1g5) | **best** | -0.11 | +0.65 | develops |
| 5 | h3 (h2h3) | **excellent** | -0.13 | -0.01 | – |

<details><summary>Phrases for e4</summary>

- (82) **centralizes** — Stakes a claim in the center

</details>

<details><summary>Phrases for Bf4</summary>

- (200) **develops** — Develops the bishop

</details>

### 10. Royal fork: Nc2 forks K + R  _(tactic, b to move)_

```
fen:      2k5/8/8/8/8/n7/8/R3K3 b - - 0 1
SF eval:  0.01 (white-POV)
HCE eval: 2.89 (white-POV)   diff=-2.88  ⚠️ |Δ|≥1.0 pawn
phase:    3/24
verdict:  White winning (+2.9)
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 140 | 231 |
| psqt | 24 | 8 |
| mobility | -1 | 29 |
| pawns | 0 | 0 |
| king_safety | 0 | 0 |
| threats | 70 | 30 |
| imbalance | 0 | 0 |

**Themes:** material_edge; king_safety; open_file_control; hanging_pieces; leading_factor

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | Nc2+ (a3c2) | **best** | +0.00 | +0.62 | check, fork, knight_invasion, activates |
| 2 | Nb5 (a3b5) | **excellent** | -0.34 | +0.35 | activates |
| 3 | Nc4 (a3c4) | **blunder** | -4.29 | +0.66 | attacks_king, knight_invasion, activates |
| 4 | Kc7 (c8c7) | **blunder** | -4.31 | +0.19 | – |
| 5 | Kd7 (c8d7) | **blunder** | -4.47 | +0.20 | – |

<details><summary>Phrases for Nc2+</summary>

- (29) **check** — Gives check
- (5) **fork** — Forks rook and king
- (50) **knight_invasion** — Knight invades c2
- (86) **activates** — Activates the knight for the endgame

</details>

<details><summary>Phrases for Nb5</summary>

- (86) **activates** — Activates the knight for the endgame

</details>

<details><summary>Phrases for Nc4</summary>

- (72) **attacks_king** — Knight on c4 now attacks d2 (next to the king)
- (50) **knight_invasion** — Knight invades c4
- (86) **activates** — Activates the knight for the endgame

</details>

### 11. Re3 absolute pin on Ne5  _(tactic, w to move)_

```
fen:      4k3/8/8/4n3/8/8/8/4R2K w - - 0 1
SF eval:  4.92 (white-POV)
HCE eval: 2.65 (white-POV)   diff=2.27  ⚠️ |Δ|≥1.0 pawn
phase:    3/24
verdict:  White winning (+2.7)
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 140 | 231 |
| psqt | -6 | -36 |
| mobility | -1 | 49 |
| pawns | 0 | 0 |
| king_safety | 0 | 0 |
| threats | 70 | 30 |
| imbalance | 0 | 0 |

**Themes:** material_edge; king_safety; open_file_control; hanging_pieces; leading_factor

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | Kg2 (h1g2) | **best** | +0.00 | +0.36 | – |
| 2 | Kh2 (h1h2) | **best** | -0.01 | +0.26 | – |
| 3 | Re3 (e1e3) | **best** | -0.01 | +0.00 | pin, open_file |
| 4 | Rxe5+ (e1e5) | **best** | -0.01 | +2.98 | exchange_sacrifice, check, open_file, decisive_combination |
| 5 | Kg1 (h1g1) | **excellent** | -0.61 | +0.12 | – |

<details><summary>Phrases for Re3</summary>

- (7) **pin** — Pins the knight to the king
- (54) **open_file** — Posts the rook on the open e-file

</details>

### 12. Re1 pins Q to K (pin not skewer)  _(tactic, w to move)_

```
fen:      4k3/4q3/8/8/8/8/8/R5K1 w - - 0 1
SF eval:  -2.28 (white-POV)
HCE eval: -4.56 (white-POV)   diff=2.28  ⚠️ |Δ|≥1.0 pawn
phase:    6/24
verdict:  Black winning (+4.6)
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | -548 | -424 |
| psqt | -11 | 11 |
| mobility | -22 | -2 |
| pawns | 0 | 0 |
| king_safety | 0 | 0 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Themes:** material_edge; piece_activity; open_file_control; open_file_control; leading_factor

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | Rf1 (a1f1) | **best** | +0.00 | +0.03 | eyes_king_zone, open_file |
| 2 | Rd1 (a1d1) | **best** | -0.05 | +0.15 | eyes_king_zone, open_file |
| 3 | Ra8+ (a1a8) | **best** | -0.05 | +0.28 | check, open_file |
| 4 | Ra2 (a1a2) | **excellent** | -0.22 | -0.01 | open_file |
| 5 | Kg2 (g1g2) | **inaccuracy** | -2.79 | +0.13 | – |

<details><summary>Phrases for Rf1</summary>

- (71) **eyes_king_zone** — Eyes the king's file
- (54) **open_file** — Posts the rook on the open f-file

</details>

<details><summary>Phrases for Rd1</summary>

- (71) **eyes_king_zone** — Eyes the king's file
- (54) **open_file** — Posts the rook on the open d-file

</details>

<details><summary>Phrases for Ra8+</summary>

- (29) **check** — Gives check
- (54) **open_file** — Posts the rook on the open a-file

</details>

### 13. Nf6 discovered check from Rd1  _(tactic, w to move)_

```
fen:      3k4/8/8/3N4/8/8/8/3RK3 w - - 0 1
SF eval:  5.18 (white-POV)
HCE eval: 8.67 (white-POV)   diff=-3.49  ⚠️ |Δ|≥1.0 pawn
phase:    3/24
verdict:  White clearly winning (+8.7)
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 814 | 793 |
| psqt | 132 | 4 |
| mobility | 16 | 57 |
| pawns | 0 | 0 |
| king_safety | 0 | 0 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Themes:** material_edge; king_safety; piece_activity; open_file_control; leading_factor

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | Rb1 (d1b1) | **best** | +0.00 | +0.16 | open_file |
| 2 | Ra1 (d1a1) | **best** | -0.15 | +0.05 | open_file |
| 3 | Kd2 (e1d2) | **best** | -0.19 | +0.30 | – |
| 4 | Kf1 (e1f1) | **excellent** | -0.26 | +0.11 | – |
| 5 | Rc1 (d1c1) | **excellent** | -0.31 | +0.75 | eyes_king_zone, open_file |

<details><summary>Phrases for Rb1</summary>

- (54) **open_file** — Posts the rook on the open b-file

</details>

<details><summary>Phrases for Ra1</summary>

- (54) **open_file** — Posts the rook on the open a-file

</details>

### 14. Symmetrical-ish, look for tactics  _(tactic, w to move)_

```
fen:      r3k2r/ppp2ppp/2n2n2/3pp3/1b1P4/2N1PN2/PPPB1PPP/R2QKB1R w KQkq - 0 1
SF eval:  8.82 (white-POV)
HCE eval: 13.21 (white-POV)   diff=-4.39  ⚠️ |Δ|≥1.0 pawn
phase:    19/24
verdict:  White clearly winning (+13.2)
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 1390 | 1233 |
| psqt | -21 | -62 |
| mobility | -19 | -37 |
| pawns | 20 | 3 |
| king_safety | 0 | 0 |
| threats | -35 | -30 |
| imbalance | 30 | 50 |

**Themes:** material_edge; bishop_pair; light_complex; hanging_pieces; leading_factor

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | Bb5 (f1b5) | **best** | +0.00 | +0.62 | pin, prepares_castling_kingside, restricts, activates |
| 2 | a3 (a2a3) | **best** | -0.11 | +0.18 | threatens |
| 3 | Nxe5 (f3e5) | **best** | -0.22 | +1.38 | capture, attacks_king, centralizes, activates |
| 4 | dxe5 (d4e5) | **best** | -0.23 | +0.53 | simplifies, threatens, removes_defender, pawn_break |
| 5 | h4 (h2h4) | **excellent** | -0.85 | +0.10 | – |

<details><summary>Phrases for Bb5</summary>

- (7) **pin** — Pins the knight to the king
- (80) **prepares_castling_kingside** — Clears the way for kingside castle
- (84) **restricts** — Restricts the opponent's pieces
- (86) **activates** — Activates the bishop

</details>

<details><summary>Phrases for a3</summary>

- (26) **threatens** — Threatens the bishop

</details>

<details><summary>Phrases for Nxe5</summary>

- (19) **capture** — Captures the pawn
- (72) **attacks_king** — Knight on e5 attacks 2 squares around the king (d7, f7)
- (82) **centralizes** — Centralizes the piece
- (86) **activates** — Activates the knight

</details>

### 15. Kingside attack with sac chances  _(tactic, w to move)_

```
fen:      r4rk1/pp3ppp/2p1bn2/q2pP3/3P4/P1NB1Q2/1PP2PPP/R3R1K1 w - - 0 1
SF eval:  5.96 (white-POV)
HCE eval: 1.62 (white-POV)   diff=4.34  ⚠️ |Δ|≥1.0 pawn
phase:    20/24
verdict:  White better (+1.6)
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 82 | 94 |
| psqt | 32 | 45 |
| mobility | 25 | 48 |
| pawns | 17 | 10 |
| king_safety | 0 | 0 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Themes:** material_edge; piece_activity; dark_complex; hanging_pieces; leading_factor

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | exf6 (e5f6) | **best** | +0.00 | +3.25 | capture, opens_file_for, pawn_break, restricts |
| 2 | b4 (b2b4) | **excellent** | -0.39 | +0.70 | threatens |
| 3 | Ne2 (c3e2) | **inaccuracy** | -3.36 | -0.41 | – |
| 4 | a4 (a3a4) | **inaccuracy** | -3.44 | -0.03 | – |
| 5 | Qe3 (f3e3) | **inaccuracy** | -3.55 | -0.17 | – |

<details><summary>Phrases for exf6</summary>

- (19) **capture** — Captures the knight
- (64) **opens_file_for** — Opens the e-file for the rook
- (90) **pawn_break** — Pawn break
- (84) **restricts** — Restricts the opponent's pieces

</details>

<details><summary>Phrases for b4</summary>

- (26) **threatens** — Wins the queen

</details>

### 16. Q+R for Black, Q+B+R for White, threats  _(tactic, w to move)_

```
fen:      2r3k1/p4ppp/1p1q4/3p4/3Q4/2P3P1/P4PBP/3R2K1 w - - 0 1
SF eval:  5.47 (white-POV)
HCE eval: 2.66 (white-POV)   diff=2.81  ⚠️ |Δ|≥1.0 pawn
phase:    13/24
verdict:  White winning (+2.7)
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 283 | 203 |
| psqt | 24 | 13 |
| mobility | 15 | 5 |
| pawns | -5 | -15 |
| king_safety | 0 | 0 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Themes:** material_edge; iqp; light_complex; dark_complex; long_diagonal

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | Bxd5 (g2d5) | **best** | +0.00 | +1.15 | capture, pin, outpost, activates |
| 2 | h3 (h2h3) | **best** | -0.01 | +0.01 | luft |
| 3 | c4 (c3c4) | **best** | -0.01 | +0.04 | opens_diagonal_for, centralizes, pawn_lever |
| 4 | h4 (h2h4) | **best** | -0.18 | +0.07 | – |
| 5 | Bf3 (g2f3) | **excellent** | -0.30 | +0.07 | – |

<details><summary>Phrases for Bxd5</summary>

- (19) **capture** — Captures the pawn
- (7) **pin** — Pins the pawn to the king
- (60) **outpost** — Establishes an outpost on d5
- (86) **activates** — Activates the bishop

</details>

<details><summary>Phrases for h3</summary>

- (73) **luft** — Creates luft for the king

</details>

<details><summary>Phrases for c4</summary>

- (65) **opens_diagonal_for** — Opens a diagonal for the queen
- (82) **centralizes** — Stakes a claim in the center
- (91) **pawn_lever** — Creates a pawn lever

</details>

### 17. Rook ending: who is active?  _(tactic, w to move)_

```
fen:      6k1/5p1p/6p1/8/3R4/2r5/5PPP/6K1 w - - 0 1
SF eval:  0.45 (white-POV)
HCE eval: -0.05 (white-POV)   diff=0.50
phase:    4/24
verdict:  Roughly equal
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 0 | 0 |
| psqt | -22 | 0 |
| mobility | 0 | 0 |
| pawns | -8 | 0 |
| king_safety | 0 | 0 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Themes:** space_advantage; light_complex; open_file_control; open_file_control

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | h3 (h2h3) | **best** | +0.00 | +0.03 | luft |
| 2 | g3 (g2g3) | **excellent** | -0.35 | +0.00 | luft, color_complex_self |
| 3 | g4 (g2g4) | **excellent** | -0.36 | -0.06 | – |
| 4 | Rd1 (d4d1) | **good** | -0.45 | -0.03 | open_file |
| 5 | Rd8+ (d4d8) | **good** | -0.45 | +0.16 | check, open_file |

<details><summary>Phrases for h3</summary>

- (73) **luft** — Creates luft for the king

</details>

<details><summary>Phrases for g3</summary>

- (73) **luft** — Creates luft for the king
- (45) **color_complex_self** — Dark squares become permanently weak

</details>

### 18. Saavedra (1895) — White wins  _(endgame, w to move)_

```
fen:      8/8/1KP5/3r4/8/8/8/k7 w - - 0 1
SF eval:  2.21 (white-POV)
HCE eval: -1.50 (white-POV)   diff=3.71  ⚠️ |Δ|≥1.0 pawn
phase:    2/24
verdict:  Black better (+1.5)
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | -395 | -418 |
| psqt | 116 | 172 |
| mobility | -23 | -68 |
| pawns | 163 | 162 |
| king_safety | 0 | 0 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Themes:** material_edge; king_safety; piece_activity; open_file_control; leading_factor

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | c7 (c6c7) | **best** | +0.00 | +1.54 | passed_pawn |
| 2 | Kb7 (b6b7) | **inaccuracy** | -2.21 | -0.03 | – |
| 3 | Kc7 (b6c7) | **inaccuracy** | -2.21 | -0.07 | – |
| 4 | Ka6 (b6a6) | **inaccuracy** | -2.21 | -0.10 | – |
| 5 | Ka7 (b6a7) | **inaccuracy** | -2.21 | -0.27 | – |

<details><summary>Phrases for c7</summary>

- (92) **passed_pawn** — Creates a passed pawn

</details>

### 19. Réti (1921) — King double duty  _(endgame, w to move)_

```
fen:      7K/8/k1P5/7p/8/8/8/8 w - - 0 1
SF eval:  -0.05 (white-POV)
HCE eval: 2.24 (white-POV)   diff=-2.29  ⚠️ |Δ|≥1.0 pawn
phase:    0/24
verdict:  White winning (+2.2)
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 0 | 0 |
| psqt | 78 | 88 |
| mobility | 0 | 0 |
| pawns | 153 | 136 |
| king_safety | 0 | 0 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Themes:** square_of_pawn; square_of_pawn; leading_factor

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | Kg7 (h8g7) | **best** | +0.00 | +0.40 | – |
| 2 | c7 (c6c7) | **blunder** | -4.93 | +1.56 | passed_pawn |
| 3 | Kh7 (h8h7) | **blunder** | -4.96 | +0.28 | – |
| 4 | Kg8 (h8g8) | **blunder** | -5.10 | +0.21 | – |

<details><summary>Phrases for c7</summary>

- (92) **passed_pawn** — Creates a passed pawn

</details>

### 20. Lucena — bridge wins  _(endgame, w to move)_

```
fen:      1K6/1P6/k7/8/8/8/r7/2R5 w - - 0 1
SF eval:  8.90 (white-POV)
HCE eval: 4.92 (white-POV)   diff=3.98  ⚠️ |Δ|≥1.0 pawn
phase:    4/24
verdict:  White winning (+4.9)
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 82 | 94 |
| psqt | 145 | 149 |
| mobility | 8 | 2 |
| pawns | 271 | 245 |
| king_safety | 0 | 0 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Themes:** material_edge; open_file_control; open_file_control; seventh_rank; leading_factor

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | Kc7 (b8c7) | **best** | +0.00 | +0.31 | – |
| 2 | Kc8 (b8c8) | **excellent** | -1.77 | +0.12 | – |
| 3 | Rc3 (c1c3) | **neutral** | -4.02 | -0.09 | open_file |
| 4 | Rg1 (c1g1) | **neutral** | -4.04 | -0.05 | open_file |
| 5 | Rc6+ (c1c6) | **neutral** | -4.10 | +0.33 | check, open_file |

<details><summary>Phrases for Rc3</summary>

- (54) **open_file** — Posts the rook on the open c-file

</details>

### 21. Philidor — drawing technique  _(endgame, w to move)_

```
fen:      8/8/8/3k4/8/r7/4P3/4K2R w K - 0 1
SF eval:  0.00 (white-POV)
HCE eval: 0.38 (white-POV)   diff=-0.38
phase:    4/24
verdict:  Slight edge for White
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 82 | 94 |
| psqt | 11 | -66 |
| mobility | -12 | -12 |
| pawns | 5 | 13 |
| king_safety | 0 | 0 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Themes:** material_edge; king_safety; space_advantage; open_file_control; open_file_control

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | Kf2 (e1f2) | **best** | +0.00 | +0.35 | – |
| 2 | Rh5+ (h1h5) | **best** | +0.00 | +0.28 | check, open_file |
| 3 | Rh8 (h1h8) | **best** | +0.00 | +0.44 | open_file |
| 4 | Rh6 (h1h6) | **best** | +0.00 | +0.33 | eyes_king_zone, open_file |
| 5 | Rh2 (h1h2) | **best** | +0.00 | +0.07 | open_file |

<details><summary>Phrases for Rh5+</summary>

- (29) **check** — Gives check
- (54) **open_file** — Posts the rook on the open h-file

</details>

<details><summary>Phrases for Rh8</summary>

- (54) **open_file** — Posts the rook on the open h-file

</details>

### 22. KP vs K: opposition  _(endgame, w to move)_

```
fen:      8/8/8/3k4/3P4/3K4/8/8 w - - 0 1
SF eval:  0.35 (white-POV)
HCE eval: 1.21 (white-POV)   diff=-0.86
phase:    0/24
verdict:  White better (+1.2)
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 82 | 94 |
| psqt | 5 | -10 |
| mobility | 0 | 0 |
| pawns | 10 | 26 |
| king_safety | 11 | 11 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Themes:** opposition; material_edge; leading_factor

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | Kc3 (d3c3) | **best** | +0.00 | -0.10 | – |
| 2 | Ke3 (d3e3) | **excellent** | -0.18 | +0.02 | – |
| 3 | Kd2 (d3d2) | **excellent** | -0.35 | -0.19 | – |
| 4 | Ke2 (d3e2) | **excellent** | -0.35 | -0.18 | – |
| 5 | Kc2 (d3c2) | **excellent** | -0.35 | -0.28 | – |

### 23. KP vs K: square of pawn  _(endgame, w to move)_

```
fen:      8/4k3/8/8/8/3K4/4P3/8 w - - 0 1
SF eval:  5.22 (white-POV)
HCE eval: 1.27 (white-POV)   diff=3.95  ⚠️ |Δ|≥1.0 pawn
phase:    0/24
verdict:  White better (+1.3)
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 82 | 94 |
| psqt | -18 | 20 |
| mobility | 0 | 0 |
| pawns | 5 | 13 |
| king_safety | 0 | 0 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Themes:** material_edge; leading_factor

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | Ke4 (d3e4) | **best** | +0.00 | +0.06 | – |
| 2 | Kd4 (d3d4) | **best** | +0.00 | +0.03 | – |
| 3 | Kc4 (d3c4) | **best** | +0.00 | +0.00 | – |
| 4 | Ke3 (d3e3) | **best** | +0.00 | +0.02 | – |
| 5 | Kc3 (d3c3) | **best** | +0.00 | -0.10 | – |

### 24. Symmetrical pawn endgame  _(endgame, w to move)_

```
fen:      4k3/p7/8/8/8/8/P7/4K3 w - - 0 1
SF eval:  0.01 (white-POV)
HCE eval: 0.00 (white-POV)   diff=0.01
phase:    0/24
verdict:  Roughly equal
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 0 | 0 |
| psqt | 0 | 0 |
| mobility | 0 | 0 |
| pawns | 0 | 0 |
| king_safety | 0 | 0 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | Kd2 (e1d2) | **best** | +0.00 | +0.41 | – |
| 2 | Ke2 (e1e2) | **best** | -0.01 | +0.42 | – |
| 3 | a4 (a2a4) | **best** | -0.01 | +0.00 | – |
| 4 | Kd1 (e1d1) | **best** | -0.01 | +0.17 | – |
| 5 | a3 (a2a3) | **best** | -0.01 | -0.09 | – |

### 25. White advanced K + P, easy win  _(endgame, w to move)_

```
fen:      8/5k2/8/4PK2/8/8/8/8 w - - 0 1
SF eval:  0.00 (white-POV)
HCE eval: 1.89 (white-POV)   diff=-1.89  ⚠️ |Δ|≥1.0 pawn
phase:    0/24
verdict:  White better (+1.9)
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 82 | 94 |
| psqt | 14 | 27 |
| mobility | 0 | 0 |
| pawns | 57 | 57 |
| king_safety | 11 | 11 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Themes:** opposition; material_edge; space_advantage; leading_factor

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | Kg5 (f5g5) | **best** | +0.00 | -0.07 | – |
| 2 | Kf4 (f5f4) | **best** | +0.00 | -0.21 | – |
| 3 | e6+ (e5e6) | **best** | +0.00 | +1.63 | check, passed_pawn |
| 4 | Kg4 (f5g4) | **best** | +0.00 | -0.35 | – |
| 5 | Ke4 (f5e4) | **best** | +0.00 | -0.17 | – |

<details><summary>Phrases for e6+</summary>

- (29) **check** — Gives check
- (92) **passed_pawn** — Creates a passed pawn

</details>

### 26. Trébuchet: zugzwang loses  _(endgame, w to move)_

```
fen:      8/8/8/p7/P7/k7/8/K7 w - - 0 1
SF eval:  -0.22 (white-POV)
HCE eval: -0.63 (white-POV)   diff=0.41
phase:    0/24
verdict:  Slight edge for Black
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 0 | 0 |
| psqt | -6 | -63 |
| mobility | 0 | 0 |
| pawns | 0 | 0 |
| king_safety | 0 | 0 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Themes:** opposition; hanging_pieces; leading_factor

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | Kb1 (a1b1) | **best** | +0.00 | +0.19 | – |

### 27. Sharp middlegame: Q on a2  _(middlegame, b to move)_

```
fen:      r3r1k1/pp3pbp/2p3p1/3pP3/3P2P1/2P2N2/q2N1PB1/R2QR1K1 b - - 0 18
SF eval:  6.13 (white-POV)
HCE eval: 6.01 (white-POV)   diff=0.12
phase:    20/24
verdict:  White clearly winning (+6.0)
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 510 | 374 |
| psqt | 106 | -46 |
| mobility | -27 | -47 |
| pawns | 3 | -15 |
| king_safety | 0 | 0 |
| threats | 70 | 30 |
| imbalance | 0 | 0 |

**Themes:** material_edge; opposite_color_bishops; light_complex; dark_complex; hanging_pieces

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | Qb2 (a2b2) | **best** | +0.00 | +0.40 | attacks_pawn |
| 2 | Qxa1 (a2a1) | **excellent** | -0.86 | +4.94 | capture, removes_defender, hangs |
| 3 | Bxe5 (g7e5) | **excellent** | -1.57 | +1.50 | capture, hangs, back_rank_mate_threat, centralizes, hanging_pawns_them, activates |
| 4 | Rxe5 (e8e5) | **excellent** | -1.58 | +1.37 | capture, hangs, open_file, hanging_pawns_them |
| 5 | Qa6 (a2a6) | **good** | -1.76 | +0.14 | hangs |

<details><summary>Phrases for Qb2</summary>

- (70) **attacks_pawn** — Threatens the backward c-pawn

</details>

<details><summary>Phrases for Qxa1</summary>

- (19) **capture** — Captures the rook
- (13) **removes_defender** — Removes the defender of the pawn
- (103) **hangs** — Loses material in the exchange

</details>

<details><summary>Phrases for Bxe5</summary>

- (19) **capture** — Captures the pawn
- (103) **hangs** — Loses material in the exchange
- (9) **back_rank_mate_threat** — Threatens back-rank mate
- (82) **centralizes** — Centralizes the piece
- (42) **hanging_pawns_them** — Saddles the opponent with hanging cd pawns
- (86) **activates** — Activates the bishop

</details>

### 28. Late middlegame, balanced material  _(middlegame, w to move)_

```
fen:      2r1nrk1/pp3ppp/3p1q2/3Pp3/2P1P3/PP1B1Q1P/3N2P1/2R2RK1 w - - 0 22
SF eval:  5.67 (white-POV)
HCE eval: 4.55 (white-POV)   diff=1.12  ⚠️ |Δ|≥1.0 pawn
phase:    19/24
verdict:  White winning (+4.6)
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 365 | 297 |
| psqt | 47 | 17 |
| mobility | 26 | 54 |
| pawns | 37 | 13 |
| king_safety | 0 | 0 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Themes:** material_edge; king_safety; light_complex; dark_complex; leading_factor

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | Qxf6 (f3f6) | **best** | +0.00 | +10.73 | simplifies, pin, back_rank_mate_threat, restricts, decisive_combination |
| 2 | Qe3 (f3e3) | **excellent** | -0.35 | +0.67 | creates_threat, opens_file_for, attacks_pawn |
| 3 | Rfe1 (f1e1) | **excellent** | -0.53 | +0.29 | opens_file_for |
| 4 | Rce1 (c1e1) | **excellent** | -0.54 | -0.01 | – |
| 5 | Rc2 (c1c2) | **excellent** | -0.63 | -0.32 | – |

<details><summary>Phrases for Qxf6</summary>

- (15) **simplifies** — Trades queens to simplify the win
- (7) **pin** — Pins the pawn to the rook
- (9) **back_rank_mate_threat** — Threatens back-rank mate
- (84) **restricts** — Restricts the opponent's pieces
- (4) **decisive_combination** — Decisive combination — winning material and pressing on

</details>

<details><summary>Phrases for Qe3</summary>

- (25) **creates_threat** — Creates a threat on the queen
- (64) **opens_file_for** — Opens the f-file for the rook
- (70) **attacks_pawn** — Threatens the a-pawn

</details>

<details><summary>Phrases for Rfe1</summary>

- (64) **opens_file_for** — Opens the f-file for the queen

</details>

### 29. Rook + pawns ending, exchange-up  _(endgame, w to move)_

```
fen:      6k1/5ppp/8/8/8/8/5PPP/2R3K1 w - - 0 1
SF eval:  0.00 (white-POV)
HCE eval: 5.73 (white-POV)   diff=-5.73  ⚠️ |Δ|≥1.0 pawn
phase:    2/24
verdict:  White clearly winning (+5.7)
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 477 | 512 |
| psqt | 1 | 3 |
| mobility | 18 | 66 |
| pawns | 0 | 0 |
| king_safety | 0 | 0 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Themes:** material_edge; piece_activity; open_file_control; leading_factor

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | Rc8# (c1c8) | **best** | +0.00 | +0.18 | checkmate, back_rank_mate, check, open_file |
| 2 | Rb1 (c1b1) | **best** | +6.42 | -0.02 | open_file |
| 3 | Ra1 (c1a1) | **best** | +6.41 | -0.12 | open_file |
| 4 | Kf1 (g1f1) | **best** | +6.34 | +0.05 | – |
| 5 | f3 (f2f3) | **best** | +6.29 | -0.05 | – |

<details><summary>Phrases for Rc8#</summary>

- (0) **checkmate** — Delivers checkmate
- (0) **back_rank_mate** — Delivers back-rank mate
- (29) **check** — Gives check
- (54) **open_file** — Posts the rook on the open c-file

</details>

<details><summary>Phrases for Rb1</summary>

- (54) **open_file** — Posts the rook on the open b-file

</details>

<details><summary>Phrases for Ra1</summary>

- (54) **open_file** — Posts the rook on the open a-file

</details>

### 31. Defended pieces in line — should NOT call it skewer  _(tactic, w to move)_

```
fen:      4k3/4r3/4r3/4r3/8/8/8/4R2K w - - 0 1
SF eval:  0.00 (white-POV)
HCE eval: -11.10 (white-POV)   diff=11.10  ⚠️ |Δ|≥1.0 pawn
phase:    8/24
verdict:  Black clearly winning (-11.1)
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | -954 | -1024 |
| psqt | 11 | 1 |
| mobility | -15 | -98 |
| pawns | 0 | 0 |
| king_safety | 0 | 0 |
| threats | -70 | -30 |
| imbalance | 0 | 0 |

**Themes:** material_edge; king_safety; piece_activity; hanging_pieces; leading_factor

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | Rxe5 (e1e5) | **best** | +0.00 | +5.52 | trades_when_behind, open_file, restricts |
| 2 | Re4 (e1e4) | **best** | +0.00 | +0.12 | hangs, open_file, prophylaxis |
| 3 | Re3 (e1e3) | **best** | +0.00 | +0.06 | hangs, open_file |
| 4 | Kh2 (h1h2) | **best** | +0.00 | +0.19 | – |
| 5 | Rc1 (e1c1) | **best** | +0.00 | +0.50 | open_file |

<details><summary>Phrases for Rxe5</summary>

- (87) **trades_when_behind** — Trades into a worse ending
- (54) **open_file** — Posts the rook on the open e-file
- (84) **restricts** — Restricts the opponent's pieces

</details>

<details><summary>Phrases for Re4</summary>

- (103) **hangs** — Hangs the rook
- (54) **open_file** — Posts the rook on the open e-file
- (89) **prophylaxis** — Prophylactic move, restricting the opponent

</details>

<details><summary>Phrases for Re3</summary>

- (103) **hangs** — Hangs the rook
- (54) **open_file** — Posts the rook on the open e-file

</details>

### 32. Italian: Greek-gift territory  _(tactic, w to move)_

```
fen:      r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4
SF eval:  0.19 (white-POV)
HCE eval: -0.19 (white-POV)   diff=0.38
phase:    24/24
verdict:  Roughly equal
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 0 | 0 |
| psqt | -8 | -21 |
| mobility | -11 | -10 |
| pawns | 0 | 0 |
| king_safety | 0 | 0 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Themes:** hanging_pieces

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | Ng5 (f3g5) | **best** | +0.00 | +0.50 | defends, attacks_king, attacks_pawn |
| 2 | d3 (d2d3) | **best** | -0.02 | +0.82 | defends |
| 3 | d4 (d2d4) | **best** | -0.08 | +0.86 | centralizes, pawn_lever |
| 4 | Nc3 (b1c3) | **excellent** | -0.15 | +0.55 | defends, develops |
| 5 | Qe2 (d1e2) | **excellent** | -0.26 | +0.09 | defends |

<details><summary>Phrases for Ng5</summary>

- (83) **defends** — Defends the pawn
- (72) **attacks_king** — Knight on g5 now attacks f7 (next to the king)
- (70) **attacks_pawn** — Attacks the f-pawn

</details>

<details><summary>Phrases for d3</summary>

- (83) **defends** — Defends the pawn

</details>

<details><summary>Phrases for d4</summary>

- (82) **centralizes** — Stakes a claim in the center
- (91) **pawn_lever** — Creates a pawn lever

</details>

### 33. Pin-pretzel; sac chances  _(tactic, w to move)_

```
fen:      r1bq1rk1/pppp1ppp/2n5/4p3/1bB1P3/5N2/PPPP1PPP/RNBQK2R w KQ - 0 5
SF eval:  4.75 (white-POV)
HCE eval: 2.54 (white-POV)   diff=2.21  ⚠️ |Δ|≥1.0 pawn
phase:    23/24
verdict:  White winning (+2.5)
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 337 | 281 |
| psqt | -57 | -60 |
| mobility | -23 | -34 |
| pawns | 0 | 0 |
| king_safety | 0 | 0 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Themes:** material_edge; king_safety; leading_factor

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | c3 (c2c3) | **best** | +0.00 | +0.21 | threatens |
| 2 | Nc3 (b1c3) | **excellent** | -0.31 | +0.24 | develops |
| 3 | O-O (e1g1) | **excellent** | -0.36 | +0.49 | castles_kingside |
| 4 | h3 (h2h3) | **excellent** | -0.52 | +0.22 | – |
| 5 | a3 (a2a3) | **excellent** | -0.64 | +0.17 | threatens, opens_diagonal_for |

<details><summary>Phrases for c3</summary>

- (26) **threatens** — Threatens the bishop

</details>

<details><summary>Phrases for Nc3</summary>

- (200) **develops** — Develops the knight

</details>

<details><summary>Phrases for O-O</summary>

- (30) **castles_kingside** — Castles kingside

</details>

### 34. King-and-pawn endgame, drawn-ish  _(endgame, w to move)_

```
fen:      8/5pk1/4p1p1/3pP1Pp/3P3P/3K4/8/8 w - - 0 1
SF eval:  0.00 (white-POV)
HCE eval: -0.49 (white-POV)   diff=0.49
phase:    0/24
verdict:  Slight edge for Black
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | -82 | -94 |
| psqt | -75 | 42 |
| mobility | 0 | 0 |
| pawns | 9 | -4 |
| king_safety | 5 | 7 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Themes:** material_edge

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | Kc3 (d3c3) | **best** | +0.00 | -0.10 | – |
| 2 | Kd2 (d3d2) | **best** | +0.00 | -0.08 | – |
| 3 | Kc2 (d3c2) | **best** | +0.00 | -0.17 | – |
| 4 | Ke2 (d3e2) | **best** | +0.00 | -0.07 | – |
| 5 | Ke3 (d3e3) | **best** | +0.00 | +0.02 | – |

### 35. Italian: Bishop on c4 unblocked  _(opening, b to move)_

```
fen:      r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR b KQkq - 2 3
SF eval:  -0.45 (white-POV)
HCE eval: -0.23 (white-POV)   diff=-0.22
phase:    24/24
verdict:  Roughly equal
```

**HCE breakdown (white − black, mg/eg):**

| term | mg | eg |
|---|---|---|
| material | 0 | 0 |
| psqt | -8 | -21 |
| mobility | -15 | -28 |
| pawns | 0 | 0 |
| king_safety | 0 | 0 |
| threats | 0 | 0 |
| imbalance | 0 | 0 |

**Top moves:**

| # | move | quality | sfΔ | hceΔ | motifs |
|---|---|---|---|---|---|
| 1 | Nf6 (g8f6) | **best** | +0.00 | +0.42 | attacks_pawn, develops |
| 2 | Na5 (c6a5) | **excellent** | -0.24 | +0.39 | threatens, knight_on_rim |
| 3 | Qh4 (d8h4) | **excellent** | -0.25 | +0.15 | pin, attacks_pawn |
| 4 | Be7 (f8e7) | **excellent** | -0.25 | -0.03 | develops |
| 5 | Nge7 (g8e7) | **excellent** | -0.42 | -0.30 | develops |

<details><summary>Phrases for Nf6</summary>

- (70) **attacks_pawn** — Threatens the e-pawn
- (200) **develops** — Develops the knight

</details>

<details><summary>Phrases for Na5</summary>

- (26) **threatens** — Wins the bishop
- (100) **knight_on_rim** — Knight drifts to the rim

</details>

<details><summary>Phrases for Qh4</summary>

- (7) **pin** — Pins the pawn to the bishop
- (70) **attacks_pawn** — Threatens the e-pawn

</details>
