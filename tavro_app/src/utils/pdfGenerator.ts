/**
 * pdfGenerator.ts
 *
 * Markdown-aware, Unicode-safe PDF generation using jsPDF.
 * Handles: H1–H4 headings, inline bold, bullet/numbered lists,
 *          markdown tables, code blocks, horizontal rules.
 *
 * No-op when content is empty — callers must only invoke after a
 * successful API response.
 */
// @ts-ignore — jspdf is installed in the Docker container; no local node_modules
import { jsPDF } from 'jspdf';

// ── Page geometry (A4 mm) ─────────────────────────────────────────────────────
const PAGE_H = 297;
const MX     = 20;   // left/right margin
const MT     = 22;   // top margin (first page content start)
const MB     = 20;   // bottom margin
const CW     = 170;  // content width (210 - 2*MX)

// ── Font sizes (pt) ───────────────────────────────────────────────────────────
const FS = { h1: 17, h2: 13, h3: 11, h4: 10.5, body: 10.5, code: 9 } as const;

// ── Baseline-to-baseline distances (mm) ──────────────────────────────────────
const LH = { h1: 8.5, h2: 7, h3: 6, h4: 5.5, body: 5.5, code: 5 } as const;

// ── Unicode / emoji sanitiser ─────────────────────────────────────────────────
// jsPDF's built-in Helvetica uses WinAnsiEncoding (Latin-1).  Anything outside
// that range causes the garbled "Ø=ÜË" corruption.  Strip emoji and
// supplementary-plane characters, then map common symbols to ASCII.
function sanitize(s: string): string {
  return s
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')
    .replace(/[\u{2300}-\u{23FF}]/gu, '')
    .replace(/[\u{FE00}-\u{FEFF}]/gu, '')
    .replace(/[​-‍﻿]/g,  '')
    // Common symbols → ASCII equivalents
    .replace(/[✓✔]/g,              '(x)')
    .replace(/[✗✘]/g,              '( )')
    .replace(/[•·]/g,              '-')
    .replace(/→/g,            '->')
    .replace(/←/g,            '<-')
    .replace(/≥/g,            '>=')
    .replace(/≤/g,            '<=')
    .replace(/≠/g,            '!=')
    .replace(/[“”]/g,    '"')
    .replace(/[‘’]/g,    "'")
    .replace(/[—–]/g,    '-')
    .replace(/…/g,            '...')
    // Drop everything else outside Latin-1
    .replace(/[^\x00-\xFF]/g, '');
}

// ── Inline segment ────────────────────────────────────────────────────────────
interface Seg { text: string; bold: boolean; }

/** Parse a markdown inline string into bold / normal segments. */
function parseInline(raw: string): Seg[] {
  const segs: Seg[] = [];
  // Split on **bold** or __bold__ spans
  const parts = raw.split(/(\*\*(?:[^*]|\*(?!\*))+\*\*|__(?:[^_]|_(?!_))+__)/);
  for (const p of parts) {
    const bm = p.match(/^\*\*(.+)\*\*$/) ?? p.match(/^__(.+)__$/);
    const cleaned = sanitize(
      (bm ? bm[1] : p)
        .replace(/\*(.+?)\*/g,          '$1')  // strip *italic*
        .replace(/_(.+?)_/g,            '$1')  // strip _italic_
        .replace(/`(.+?)`/g,            '$1')  // strip `code`
        .replace(/\[(.+?)\]\([^)]*\)/g, '$1')  // strip [link](url)
    );
    if (cleaned) segs.push({ text: cleaned, bold: !!bm });
  }
  return segs;
}

// ── AST ───────────────────────────────────────────────────────────────────────
type Node =
  | { kind: 'h1' | 'h2' | 'h3' | 'h4'; text: string }
  | { kind: 'body';   segs: Seg[] }
  | { kind: 'bullet'; segs: Seg[]; level: number; prefix: string }
  | { kind: 'code';   lines: string[] }
  | { kind: 'table';  headers: string[]; rows: string[][] }
  | { kind: 'hr' }
  | { kind: 'gap';    mm: number };

// ── Markdown → AST ────────────────────────────────────────────────────────────
function parseMarkdown(md: string): Node[] {
  const rawLines = md.split('\n');
  const out: Node[] = [];
  let i = 0;
  let inCode = false;
  const codeAcc: string[] = [];

  while (i < rawLines.length) {
    const raw = rawLines[i].trimEnd();

    // Code fence
    if (/^\s*```/.test(raw)) {
      if (!inCode) {
        inCode = true;
        codeAcc.length = 0;
      } else {
        inCode = false;
        if (codeAcc.length) out.push({ kind: 'code', lines: [...codeAcc] });
      }
      i++; continue;
    }
    if (inCode) { codeAcc.push(raw); i++; continue; }

    // Headings (strip inline markers for clean bold heading text)
    const hm = raw.match(/^(#{1,4}) (.+)/);
    if (hm) {
      const lvl  = hm[1].length as 1 | 2 | 3 | 4;
      const kind = (['h1', 'h2', 'h3', 'h4'] as const)[lvl - 1];
      const text = sanitize(hm[2].replace(/\*\*(.+?)\*\*/g, '$1').replace(/_(.+?)_/g, '$1'));
      out.push({ kind, text });
      i++; continue;
    }

    // HR
    if (/^[-*_]{3,}\s*$/.test(raw.trim())) {
      out.push({ kind: 'hr' }); i++; continue;
    }

    // Table — consume all consecutive pipe-containing lines
    if (raw.trim().startsWith('|') && raw.includes('|')) {
      const tl: string[] = [];
      while (i < rawLines.length && rawLines[i].includes('|')) {
        tl.push(rawLines[i].trimEnd());
        i++;
      }
      // Drop separator rows (only dashes/colons/pipes)
      const data = tl.filter(l => !/^\s*\|?[\s|:-]+\|?\s*$/.test(l));
      if (data.length >= 1) {
        const cells = (l: string) => l.split('|').map(c => sanitize(c.trim())).filter(Boolean);
        out.push({ kind: 'table', headers: cells(data[0]), rows: data.slice(1).map(cells) });
      }
      continue;
    }

    // Unordered list
    const ulm = raw.match(/^(\s*)[*\-+] (.+)/);
    if (ulm) {
      out.push({ kind: 'bullet', segs: parseInline(ulm[2]), level: Math.floor(ulm[1].length / 2) + 1, prefix: '-' });
      i++; continue;
    }

    // Ordered list
    const olm = raw.match(/^(\s*)(\d+)\. (.+)/);
    if (olm) {
      out.push({ kind: 'bullet', segs: parseInline(olm[3]), level: Math.floor(olm[1].length / 2) + 1, prefix: `${olm[2]}.` });
      i++; continue;
    }

    // Empty line → small gap (de-duplicate consecutive gaps)
    if (!raw.trim()) {
      const last = out[out.length - 1];
      if (!last || last.kind !== 'gap') out.push({ kind: 'gap', mm: 3 });
      i++; continue;
    }

    // Body text
    out.push({ kind: 'body', segs: parseInline(raw) });
    i++;
  }

  return out;
}

// ── Renderer helpers ──────────────────────────────────────────────────────────

/** Add a page if `need` mm won't fit; return updated y. */
function pb(doc: jsPDF, y: number, need: number): number {
  if (y + need > PAGE_H - MB) { doc.addPage(); return MT; }
  return y;
}

/**
 * Word-wrap and render inline segments with mixed bold/normal text.
 *
 * `skipFirstBreak`: when true, the first line is rendered at the supplied y
 * without calling pb() (used by bullets so prefix and text share one baseline).
 */
function renderSegs(
  doc: jsPDF,
  segs: Seg[],
  lx: number,
  y: number,
  maxW: number,
  fs: number,
  lh: number,
  skipFirstBreak = false,
): number {
  doc.setFontSize(fs);
  if (!segs.length) return y + lh;

  // Flatten segments → word tokens, preserving bold flag per word
  type W = { w: string; bold: boolean };
  const words: W[] = segs.flatMap(s =>
    s.text.split(/\s+/).filter(Boolean).map(w => ({ w, bold: s.bold }))
  );
  if (!words.length) return y + lh;

  // Build wrapped line buffers: each entry is a list of {word, bold, xOffset}
  type LW = { w: string; bold: boolean; x: number };
  const lines: LW[][] = [];
  let cur: LW[] = [];
  let cx   = 0;

  for (const { w, bold } of words) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    const ww = doc.getTextWidth(w);
    const sw = doc.getTextWidth(' ');
    if (cx === 0) {
      cur.push({ w, bold, x: 0 }); cx = ww;
    } else if (cx + sw + ww <= maxW + 0.5) {
      cur.push({ w, bold, x: cx + sw }); cx += sw + ww;
    } else {
      if (cur.length) lines.push(cur);
      cur = [{ w, bold, x: 0 }]; cx = ww;
    }
  }
  if (cur.length) lines.push(cur);

  for (let li = 0; li < lines.length; li++) {
    if (li > 0 || !skipFirstBreak) y = pb(doc, y, lh);
    for (const lw of lines[li]) {
      doc.setFont('helvetica', lw.bold ? 'bold' : 'normal');
      doc.text(lw.w, lx + lw.x, y);
    }
    y += lh;
  }
  return y;
}

/** Clip text to fit within maxW mm — used only for code blocks. */
function clip(doc: jsPDF, text: string, maxW: number): string {
  if (doc.getTextWidth(text) <= maxW) return text;
  let t = text;
  while (t.length > 0 && doc.getTextWidth(t + '...') > maxW) t = t.slice(0, -1);
  return t + '...';
}

// ── Table renderer ────────────────────────────────────────────────────────────
//
// Coordinate convention (self-contained, consistent with page geometry):
//   y  = TOP of the current cell's background rectangle.
//   T_PTOP mm below y is the baseline of the first text line in the cell.
//   T_LH   mm separates consecutive baselines inside a cell.
//   T_PBOT mm below the last baseline is the bottom of the rectangle.
//
//   cell height for n lines = T_PTOP + (n-1)*T_LH + T_PBOT
//
// This matches jsPDF's coordinate origin (top-left, y increases downward) and
// avoids any magic offsets.

const T_FS   = 9;     // table font size (pt)
const T_LH   = 5.0;   // line height within cells (mm)
const T_HPAD = 2.5;   // horizontal padding: cell left edge → text start (mm)
const T_PTOP = 3.2;   // cell top → first text baseline (mm)  ← room for ascenders
const T_PBOT = 1.8;   // last text baseline → cell bottom (mm) ← room for descenders

function cellH(nLines: number): number {
  return T_PTOP + Math.max(nLines - 1, 0) * T_LH + T_PBOT;
}

/**
 * Render a table with auto-height rows (text wraps, never clips).
 *
 * y in  = TOP of the table (will be treated as rect-top, not a baseline).
 * y out = position immediately below the table, ready for the next element.
 */
function renderTable(doc: jsPDF, headers: string[], rows: string[][], y: number): number {
  if (!headers.length) return y;

  const cols  = headers.length;
  const colW  = CW / cols;          // equal column widths
  const textW = colW - T_HPAD * 2;  // usable text width per column

  doc.setFontSize(T_FS);

  // Wrap a cell value to fit textW, measuring with the correct font weight.
  const wrapCell = (text: string, bold: boolean): string[] => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    const lines = doc.splitTextToSize(sanitize((text ?? '').trim()), textW) as string[];
    return lines.length ? lines : [''];
  };

  // Pre-compute wrapped text for every cell so we know row heights up front.
  const hCells   = headers.map(h => wrapCell(h, true));
  const headerH  = cellH(Math.max(...hCells.map(c => c.length)));

  const dCells: string[][][] = rows.map(row =>
    Array.from({ length: cols }, (_, c) => wrapCell(row[c] ?? '', false))
  );
  const rowHeights = dCells.map(row =>
    cellH(Math.max(...row.map(c => c.length)))
  );

  // ── Header row ──────────────────────────────────────────────────────────────
  y = pb(doc, y, headerH + 4);

  doc.setFillColor(228, 233, 248);
  doc.rect(MX, y, CW, headerH, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(T_FS);
  doc.setTextColor(25, 50, 120);

  for (let c = 0; c < cols; c++) {
    let lineY = y + T_PTOP;
    for (const line of hCells[c]) {
      doc.text(line, MX + c * colW + T_HPAD, lineY);
      lineY += T_LH;
    }
  }

  y += headerH;
  doc.setLineWidth(0.5);
  doc.setDrawColor(90, 115, 195);
  doc.line(MX, y, MX + CW, y);
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);

  // ── Data rows ───────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(T_FS);

  for (let r = 0; r < rows.length; r++) {
    const rh = rowHeights[r];

    // Guard: if the row doesn't fit on the current page, start a new one.
    // On the new page y resets to MT; we must also redraw the header so the
    // table is readable across pages.
    if (y + rh > PAGE_H - MB) {
      doc.addPage();
      y = MT;
      // Reprint a continuation header
      doc.setFillColor(228, 233, 248);
      doc.rect(MX, y, CW, headerH, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(T_FS);
      doc.setTextColor(25, 50, 120);
      for (let c = 0; c < cols; c++) {
        let lineY = y + T_PTOP;
        for (const line of hCells[c]) {
          doc.text(line, MX + c * colW + T_HPAD, lineY);
          lineY += T_LH;
        }
      }
      y += headerH;
      doc.setLineWidth(0.3);
      doc.setDrawColor(90, 115, 195);
      doc.line(MX, y, MX + CW, y);
      doc.setTextColor(0, 0, 0);
      doc.setDrawColor(0, 0, 0);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(T_FS);
    }

    // Alternating row background
    if (r % 2 === 1) {
      doc.setFillColor(246, 248, 253);
      doc.rect(MX, y, CW, rh, 'F');
    }

    // Cell text — each line of wrapped text rendered at the correct baseline
    for (let c = 0; c < cols; c++) {
      let lineY = y + T_PTOP;
      for (const line of dCells[r][c]) {
        doc.text(line, MX + c * colW + T_HPAD, lineY);
        lineY += T_LH;
      }
    }

    y += rh;

    // Light row separator
    doc.setLineWidth(0.1);
    doc.setDrawColor(210, 215, 230);
    doc.line(MX, y, MX + CW, y);
    doc.setDrawColor(0, 0, 0);
  }

  return y + 4;   // 4mm breathing room below table
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate a PDF from markdown content and trigger a browser download.
 *
 * Silently returns without generating a file when `markdown` is empty — this
 * prevents accidental empty PDFs when an API call fails or returns no content.
 */
export function generateMarkdownPdf(title: string, markdown: string, filename: string): void {
  if (!markdown.trim()) return;

  const doc   = new jsPDF({ unit: 'mm', format: 'a4' });
  const nodes = parseMarkdown(markdown);
  let   y     = MT;

  // ── Document header ────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(20, 50, 130);
  for (const tl of doc.splitTextToSize(sanitize(title), CW)) {
    doc.text(tl, MX, y); y += 8;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(130, 130, 130);
  doc.text(`Generated: ${new Date().toLocaleString()}`, MX, y);
  y += 3;

  doc.setLineWidth(0.6);
  doc.setDrawColor(40, 90, 200);
  doc.line(MX, y, MX + CW, y);
  y += 7;

  // Reset colours for body content
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);

  // ── Render each AST node ───────────────────────────────────────────────────
  // The first heading (h1/h2/h3) is already shown as the document title above.
  // Skip it to avoid a duplicate heading at the top of the body.
  let firstHeadingSkipped = false;

  for (const node of nodes) {
    if (!firstHeadingSkipped &&
        (node.kind === 'h1' || node.kind === 'h2' || node.kind === 'h3')) {
      firstHeadingSkipped = true;
      continue;
    }

    switch (node.kind) {

      // ── Headings ──────────────────────────────────────────────────────────
      case 'h1': {
        y = pb(doc, y, LH.h1 + 5);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(FS.h1);
        doc.setTextColor(20, 55, 140);
        const wl = doc.splitTextToSize(node.text, CW);
        for (const ln of wl) { doc.text(ln, MX, y); y += LH.h1; }
        // Decorative underline under last line
        doc.setLineWidth(0.35);
        doc.setDrawColor(20, 55, 140);
        doc.line(MX, y - LH.h1 + 2, MX + CW * 0.65, y - LH.h1 + 2);
        y += 2;
        doc.setTextColor(0, 0, 0);
        doc.setDrawColor(0, 0, 0);
        break;
      }
      case 'h2': {
        y = pb(doc, y, LH.h2 + 3);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(FS.h2);
        doc.setTextColor(40, 75, 160);
        for (const ln of doc.splitTextToSize(node.text, CW)) { doc.text(ln, MX, y); y += LH.h2; }
        y += 1;
        doc.setTextColor(0, 0, 0);
        break;
      }
      case 'h3': {
        y = pb(doc, y, LH.h3 + 2);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(FS.h3);
        doc.setTextColor(55, 90, 170);
        for (const ln of doc.splitTextToSize(node.text, CW)) { doc.text(ln, MX, y); y += LH.h3; }
        y += 0.5;
        doc.setTextColor(0, 0, 0);
        break;
      }
      case 'h4': {
        y = pb(doc, y, LH.h4 + 1);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(FS.h4);
        for (const ln of doc.splitTextToSize(node.text, CW)) { doc.text(ln, MX, y); y += LH.h4; }
        break;
      }

      // ── Body text ──────────────────────────────────────────────────────────
      case 'body': {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(FS.body);
        y = renderSegs(doc, node.segs, MX, y, CW, FS.body, LH.body);
        break;
      }

      // ── Bullet / ordered list item ─────────────────────────────────────────
      case 'bullet': {
        doc.setFontSize(FS.body);
        doc.setFont('helvetica', 'normal');
        // Indent based on nesting level; leave room for prefix
        const ix  = MX + (node.level - 1) * 5;
        const pw  = doc.getTextWidth(node.prefix + ' ');
        const tx  = ix + pw;
        const tw  = CW - (ix - MX) - pw;
        // Guard page break once for this item, then render prefix + text inline
        y = pb(doc, y, LH.body);
        doc.text(node.prefix, ix, y);
        y = renderSegs(doc, node.segs, tx, y, tw, FS.body, LH.body, true);
        break;
      }

      // ── Fenced code block ──────────────────────────────────────────────────
      case 'code': {
        // Render as many lines as fit on the current page (long blocks are cropped)
        const avail  = PAGE_H - (pb(doc, y, 12)) - MB - 4;
        y            = pb(doc, y, 12);
        const visN   = Math.min(node.lines.length, Math.floor(avail / LH.code));
        if (visN <= 0) break;

        doc.setFillColor(244, 244, 250);
        doc.setDrawColor(200, 200, 215);
        doc.setLineWidth(0.2);
        doc.rect(MX - 1, y - 3.5, CW + 2, visN * LH.code + 4, 'FD');

        doc.setFont('courier', 'normal');
        doc.setFontSize(FS.code);
        doc.setTextColor(50, 50, 90);
        for (let ci = 0; ci < visN; ci++) {
          doc.text(clip(doc, sanitize(node.lines[ci]), CW - 4), MX + 1, y);
          y += LH.code;
        }
        if (visN < node.lines.length) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(110, 110, 130);
          doc.text(`[...${node.lines.length - visN} more lines omitted]`, MX + 1, y);
          y += 4;
        }
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0, 0, 0);
        doc.setDrawColor(0, 0, 0);
        y += 3;
        break;
      }

      // ── Table ──────────────────────────────────────────────────────────────
      case 'table':
        y = pb(doc, y, 16);
        y = renderTable(doc, node.headers, node.rows, y);
        y += 2;
        break;

      // ── Horizontal rule ────────────────────────────────────────────────────
      case 'hr':
        y = pb(doc, y, 8);
        doc.setLineWidth(0.25);
        doc.setDrawColor(175, 180, 210);
        doc.line(MX, y, MX + CW, y);
        doc.setDrawColor(0, 0, 0);
        y += 6;
        break;

      // ── Spacing gap ────────────────────────────────────────────────────────
      case 'gap':
        y += node.mm;
        break;
    }
  }

  doc.save(filename);
}

/**
 * Returns true when the user's message is requesting a PDF export.
 * Matches both action-word + "pdf" patterns and explicit "in/as pdf" phrases.
 */
export function isPdfExportRequest(text: string): boolean {
  const msg = text.toLowerCase();
  if (!msg.includes('pdf')) return false;
  const phrases     = ['in pdf', 'as pdf', 'as a pdf', 'to pdf', 'into pdf'];
  const actionWords = ['generate', 'create', 'download', 'export', 'give', 'provide',
    'get', 'make', 'produce', 'output', 'save', 'report'];
  return phrases.some(p => msg.includes(p)) || actionWords.some(w => msg.includes(w));
}

// ── Content extraction ────────────────────────────────────────────────────────

// Patterns that indicate the LLM refused to generate PDF content.
// When matched, extractPdfBody returns '' so no file is created.
const REFUSAL_RE = [
  /i('m| am) (unable|not able|cannot|can't) to (create|generate|export|make|produce|build|provide) (a |the )?(pdf|pdf files?|pdf documents?)/i,
  /cannot (create|generate|export|produce|build) (a |the )?(pdf|pdf files?|pdf documents?)/i,
  /i (cannot|can't|am unable to) (directly )?(create|generate|export|build|provide) (a |the )?(pdf|pdf files?|pdf documents?)/i,
  /generating (pdf|pdf files?|reference documents?) is (not |)outside (my|this|our)/i,
  /pdf (generation|creation|export|files?) is (not|outside|beyond) (something|my|what)/i,
  /i (do not|don't) have the (ability|capability) to (generate|create|export) pdf/i,
  /as a (text-based|language|ai) (model|assistant|agent).*cannot (create|generate|export|produce) pdf/i,
];

// Patterns that mark the START of a preamble line (LLM acknowledgements /
// meta-commentary that must be stripped before the actual report begins).
const PREAMBLE_RE = [
  /^(here is|here's|below is|the following is|following is)\b/i,
  /^(sure[,!]?|certainly[,!]?|of course[,!]?|absolutely[,!]?|great[,!]?)\s/i,
  /^(i appreciate (your|this)|thank you for)\b/i,
  /^(i('ve| have| will|'ll| am|'m))\s+(generated?|created?|produced?|drafted?|built|prepared?|provided?|written?|compiled?|put\s+together)\b/i,
  /^(let me|generating|creating|producing|drafting|building|preparing|writing|compiling)\b/i,
  /^(as (requested|asked|per your request))\b/i,
  /^---?\s*pdf[\s_-]?(start|begin|content)\s*---?$/i,
  /^\[?\s*pdf[\s_-]?(start|begin|content)\s*\]?$/i,
];

// Patterns that mark a POSTAMBLE line (closing remarks / download notes that
// must be stripped from the end of the report).
const POSTAMBLE_RE = [
  /your pdf (has been|will be|is|was) (generated?|created?|downloaded?|ready)/i,
  /pdf (has been|will be|is|was|will) (generated?|created?|downloaded?|ready|available)/i,
  /(download(ed|ing)?|generat(ed|ing)?|creat(ed|ing)?) (automatically|now|successfully)/i,
  /i hope (this helps|this is helpful|this meets|this covers|the above)/i,
  /let me know if (you have|you need|there('s| is)|you would)/i,
  /(feel free to|please (let me|feel free|don't hesitate)|don't hesitate to)/i,
  /^---?\s*pdf[\s_-]?(end|stop|done|finish)\s*---?$/i,
  /^\[?\s*pdf[\s_-]?(end|stop|done)\s*\]?$/i,
];

/**
 * Strip preamble and postamble from an LLM response so the PDF contains
 * only the report body.
 *
 * Preamble  = introductory/acknowledgement sentences before the first heading
 *             or meaningful content (up to 8 lines from the start).
 * Postamble = closing remarks / download notes (up to 8 lines from the end).
 *
 * Conservative by design: if nothing is identified as preamble/postamble the
 * original string is returned unchanged.
 */
export function extractPdfBody(raw: string): string {
  if (!raw.trim()) return raw;

  // If the response is a refusal ("I cannot create PDFs…"), return empty so
  // the caller skips PDF generation entirely instead of saving a useless file.
  if (REFUSAL_RE.some(re => re.test(raw))) return '';

  const lines = raw.split('\n');
  let start = 0;
  let end   = lines.length;

  // ── Strip preamble ────────────────────────────────────────────────────────
  // Search at most the first 8 non-blank lines.
  let scanned = 0;
  for (let i = 0; i < lines.length && scanned < 8; i++) {
    const line = lines[i].trim();
    if (!line) continue;                   // blank → skip but don't count
    scanned++;

    const isPreamble =
      PREAMBLE_RE.some(re => re.test(line)) ||
      // Intro line that ends with ":" and isn't a heading / table row
      (!line.startsWith('#') && !line.includes('|') && line.endsWith(':'));

    if (isPreamble) {
      start = i + 1;
    } else {
      break;                               // first non-preamble line found
    }
  }

  // Skip any blank lines immediately after the preamble
  while (start < lines.length && !lines[start].trim()) start++;

  // ── Strip postamble ───────────────────────────────────────────────────────
  // Search at most the last 8 lines going backwards.
  scanned = 0;
  for (let i = lines.length - 1; i >= start && scanned < 8; i--) {
    const line = lines[i].trim();
    if (!line) { end = i; continue; }     // blank → move end up, don't count
    scanned++;

    if (POSTAMBLE_RE.some(re => re.test(line))) {
      end = i;
    } else {
      break;                               // first non-postamble line found
    }
  }

  // Trim any trailing blank lines within the selected range
  while (end > start && !lines[end - 1].trim()) end--;

  return lines.slice(start, end).join('\n').trim();
}

/**
 * Derive a PDF title from the first markdown heading in the content.
 * Falls back to the first non-empty line, then to `fallback`.
 */
export function extractPdfTitle(content: string, fallback: string): string {
  for (const line of content.split('\n')) {
    const m = line.match(/^#{1,3}\s+(.+)/);
    if (m) {
      return m[1]
        .replace(/\*\*(.+?)\*\*/g, '$1')  // strip **bold**
        .replace(/[*_`#]/g, '')            // strip remaining markers
        .trim()
        .slice(0, 120);
    }
  }
  // No heading — use first non-empty line
  const first = content.split('\n').find(l => l.trim());
  if (first) return first.replace(/^#+\s*/, '').trim().slice(0, 120);
  return fallback;
}
