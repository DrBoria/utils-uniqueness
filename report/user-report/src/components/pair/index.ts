"use strict";

// The pair view, split by what it draws:
//   PairView.jsx — composition (bar, legend, head, board, detail)
//   Board.jsx    — the scrolling grid + the painter
//   columns.js   — column descriptors and their modifiers
//   Code.jsx     — one highlighted source line
//   Labels.jsx   — one label per run in the middle column
//   Detail.jsx   — the open run / the selected matcher
//   model.js     — rows → runs
//   palette.js   — every colour
//   paint/       — the bands themselves
//   code/        — Prism syntax highlighting
export { PairView, PairView as Diff } from "./PairView";
export { PairView as default } from "./PairView";
