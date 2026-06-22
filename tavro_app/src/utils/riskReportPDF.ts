import { jsPDF } from 'jspdf';
import tavrLogoUrl from '../assets/travo_logo.png';
import { PDF_VISUAL_FORMAT } from './pdfTemplate';

function savePdf(doc: jsPDF, filename: string): void {
  try {
    doc.save(filename);
  } catch {
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }
}

/* ── Block types ──────────────────────────────────────────────────────────── */
type Block =
  | { kind: 'h2'; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'kv'; key: string; value: string }
  | { kind: 'li'; text: string }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'hr' }
  | { kind: 'spacer' };

/* ── Proportional column widths ───────────────────────────────────────────── */
function calcColWidths(headers: string[], rows: string[][], totalW: number): number[] {
  const n = Math.max(headers.length, ...rows.map(row => row.length), 0);
  if (n === 0) return [];
  const lens = Array.from({ length: n }, (_, i) => {
    let max = (headers[i] ?? '').length;
    rows.forEach(row => { max = Math.max(max, (row[i] ?? '').length); });
    return Math.max(max, 4);
  });
  const total = lens.reduce((a, b) => a + b, 0);
  const minW = totalW / n / 3;
  const raw = lens.map(l => Math.max((l / total) * totalW, minW));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map(w => (w / sum) * totalW);
}

/* ── Markdown helpers ─────────────────────────────────────────────────────── */
function stripInlineMd(text: string): string {
  return text
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u2192/g, '->')
    .replace(/\u2190/g, '<-')
    .replace(/\u2022/g, '-')
    .replace(/\u00a0/g, ' ')
    // Paired markdown spans
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')   // ***bold italic***
    .replace(/\*\*(.+?)\*\*/g, '$1')        // **bold**
    .replace(/\*(.+?)\*/g, '$1')            // *italic*
    .replace(/___(.+?)___/g, '$1')          // ___bold italic___
    .replace(/__(.+?)__/g, '$1')            // __bold__
    .replace(/_(.+?)_/g, '$1')              // _italic_
    .replace(/~~(.+?)~~/g, '$1')            // ~~strikethrough~~
    .replace(/```[\s\S]*?```/g, '')            // ```fenced code blocks``` → remove
    .replace(/`([^`]+)`/g, '$1')            // `inline code`
    .replace(/`/g, '')                      // stray unpaired backticks
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')    // [link](url)
    .replace(/!\[.*?\]\(.+?\)/g, '')        // ![image](url) → remove
    // Normalize common Unicode that jsPDF built-in fonts can't render
    .replace(/[‘’ʼ]/g, "'")  // curly single quotes / apostrophe
    .replace(/[“”]/g, '"')         // curly double quotes
    .replace(/–/g, '-')                 // en-dash
    .replace(/—/g, '--')               // em-dash
    .replace(/→/g, '->')               // → right arrow
    .replace(/←/g, '<-')              // ← left arrow
    .replace(/•/g, '-')               // • bullet
    .replace(/·/g, '.')               // · middle dot
    .replace(/ /g, ' ')              // non-breaking space
    .replace(/[^\x00-\xFF]/g, '')          // drop anything outside Latin-1
    .trim();
}

function registerRiskPdfFont(doc: jsPDF): string {
  return 'helvetica';
}

function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!trimmed) { i++; continue; }

    // ATX headings: # / ##
    const h2m = trimmed.match(/^#{1,2}\s+(.+)$/);
    if (h2m) { blocks.push({ kind: 'h2', text: stripInlineMd(h2m[1]) }); i++; continue; }

    // ATX headings: ### – ######
    const h3m = trimmed.match(/^#{3,6}\s+(.+)$/);
    if (h3m) { blocks.push({ kind: 'h3', text: stripInlineMd(h3m[1]) }); i++; continue; }

    // Setext h2: next line is all =
    const next = lines[i + 1]?.trim() ?? '';
    if (next && /^=+$/.test(next)) {
      blocks.push({ kind: 'h2', text: stripInlineMd(trimmed) });
      i += 2; continue;
    }
    // Setext h3: next line is all - (but not HR)
    if (next && /^-+$/.test(next) && next.length >= 2) {
      blocks.push({ kind: 'h3', text: stripInlineMd(trimmed) });
      i += 2; continue;
    }

    // Horizontal rule
    if (/^[-_*]{3,}$/.test(trimmed)) { blocks.push({ kind: 'hr' }); i++; continue; }

    // Unordered list item
    const ulm = trimmed.match(/^[-*+]\s+(.+)$/);
    if (ulm) { blocks.push({ kind: 'li', text: stripInlineMd(ulm[1]) }); i++; continue; }

    // Ordered list item
    const olm = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (olm) { blocks.push({ kind: 'li', text: stripInlineMd(olm[1]) }); i++; continue; }

    // Bold key-value: **Key**: Value or **Key:** Value
    const kvBold = trimmed.match(/^\*\*([^*]+?)\*\*:?\s+(.+)$/);
    if (kvBold) {
      blocks.push({ kind: 'kv', key: kvBold[1].trim(), value: stripInlineMd(kvBold[2]) });
      i++; continue;
    }

    // Blockquote — strip the > prefix
    const bq = trimmed.match(/^>{1,}\s*(.+)$/);
    if (bq) { blocks.push({ kind: 'p', text: stripInlineMd(bq[1]) }); i++; continue; }

    // Regular paragraph
    blocks.push({ kind: 'p', text: stripInlineMd(trimmed) });
    i++;
  }

  return blocks;
}

/* ── HTML → blocks ────────────────────────────────────────────────────────── */
function parseHtml(html: string): Block[] {
  const blocks: Block[] = [];
  const dom = new DOMParser().parseFromString(html, 'text/html');

  function walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = stripInlineMd(node.textContent?.trim() ?? '');
      if (t) blocks.push({ kind: 'p', text: t });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const text = stripInlineMd(el.textContent?.trim() ?? '');

    if (tag === 'h1' || tag === 'h2') {
      if (text) blocks.push({ kind: 'h2', text });
    } else if (/^h[3-6]$/.test(tag)) {
      if (text) blocks.push({ kind: 'h3', text });
    } else if (tag === 'hr') {
      blocks.push({ kind: 'hr' });
    } else if (tag === 'br') {
      blocks.push({ kind: 'spacer' });
    } else if (tag === 'li') {
      if (text) blocks.push({ kind: 'li', text });
    } else if (tag === 'ul' || tag === 'ol') {
      el.childNodes.forEach(walk);
    } else if (tag === 'table') {
      const headers: string[] = [];
      const rows: string[][] = [];
      el.querySelectorAll('thead th, tr:first-child th').forEach(th =>
        headers.push(stripInlineMd(th.textContent?.trim() ?? ''))
      );
      el.querySelectorAll('tr').forEach((tr, idx) => {
        if (idx === 0 && headers.length > 0) return;
        const cells: string[] = [];
        tr.querySelectorAll('td').forEach(td =>
          cells.push(stripInlineMd(td.textContent?.trim() ?? ''))
        );
        if (cells.some(c => c.length > 0)) rows.push(cells);
      });
      if (headers.length > 0 || rows.length > 0) {
        blocks.push({ kind: 'table', headers, rows });
      }
    } else if (tag === 'p' || tag === 'div' || tag === 'section' || tag === 'article') {
      const hasBlock = el.querySelector('table, h1, h2, h3, h4, ul, ol, p');
      if (hasBlock) el.childNodes.forEach(walk);
      else if (text) blocks.push({ kind: 'p', text });
    } else {
      el.childNodes.forEach(walk);
    }
  }

  dom.body.childNodes.forEach(walk);
  return blocks.filter((b, i) => {
    if (i === 0) return true;
    const prev = blocks[i - 1];
    return !(b.kind === 'p' && prev.kind === 'p' && b.text === prev.text);
  });
}

/* ── Plain text → blocks ──────────────────────────────────────────────────── */
function parsePlainText(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!trimmed) { i++; continue; }

    // Divider-only line (=== or ---): skip
    if (/^[=\-]{5,}\s*$/.test(trimmed)) { i++; continue; }

    // ASCII table border row: +---+---+
    if (/^\+-[-+]+\+\s*$/.test(trimmed)) {
      const dataRows: string[] = [];
      while (i < lines.length) {
        const tl = lines[i].trim();
        if (/^\+-[-+]+\+\s*$/.test(tl)) { i++; continue; }
        if (/^\|/.test(tl)) { dataRows.push(tl); i++; continue; }
        break;
      }
      if (dataRows.length > 0) {
        const parseRow = (r: string): string[] =>
          r.split('|').slice(1, -1).map(c => stripInlineMd(c.trim()));
        const headers = parseRow(dataRows[0]);
        const rows = dataRows.slice(1).map(parseRow).filter(r => r.some(c => c));
        blocks.push({ kind: 'table', headers, rows });
      }
      continue;
    }

    // Section heading: current line followed immediately by === divider
    const nextTrimmed = lines[i + 1]?.trim() ?? '';
    if (/^[=\-]{5,}\s*$/.test(nextTrimmed)) {
      blocks.push({ kind: 'h2', text: stripInlineMd(trimmed) });
      i += 2;
      continue;
    }

    // Sub-heading: line ending with colon and no value after it
    if (trimmed.endsWith(':') && !trimmed.startsWith('|')) {
      const sub = trimmed.slice(0, -1).trim();
      if (sub.length > 0) {
        blocks.push({ kind: 'h3', text: stripInlineMd(sub) });
        i++;
        continue;
      }
    }

    // Indented line (starts with whitespace) → bullet or kv
    if (/^[ \t]+/.test(raw)) {
      const kvMatch = trimmed.match(/^(.+?):\s+(.+)$/);
      if (kvMatch) {
        blocks.push({ kind: 'kv', key: kvMatch[1].trim(), value: stripInlineMd(kvMatch[2].trim()) });
      } else {
        blocks.push({ kind: 'li', text: stripInlineMd(trimmed) });
      }
      i++;
      continue;
    }

    // Non-indented key: value (key is a short phrase before the first colon)
    const kvMatch = trimmed.match(/^([A-Za-z][^:]{1,60}):\s+(.+)$/);
    if (kvMatch) {
      blocks.push({ kind: 'kv', key: kvMatch[1].trim(), value: stripInlineMd(kvMatch[2].trim()) });
      i++;
      continue;
    }

    // Regular paragraph
    blocks.push({ kind: 'p', text: stripInlineMd(trimmed) });
    i++;
  }

  return blocks;
}

/* ── Colour helpers ───────────────────────────────────────────────────────── */
function riskFg(level: string): [number, number, number] {
  const l = level.toLowerCase();
  if (l.includes('prohibited') || l.includes('high')) return [220, 38, 38];
  if (l.includes('medium') || l.includes('moderate')) return [217, 119, 6];
  return [5, 150, 105];
}

function riskBg(level: string): [number, number, number] {
  const l = level.toLowerCase();
  if (l.includes('prohibited') || l.includes('high')) return [254, 226, 226];
  if (l.includes('medium') || l.includes('moderate')) return [255, 237, 213];
  return [209, 250, 229];
}

/* ── Load an image element from a URL ────────────────────────────────────── */
async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/* ── Content-type detection ───────────────────────────────────────────────── */
function detectBlocks(content: string): Block[] {
  const looksHtml = /<\s*(h\d|p|div|table|tr|td|th|ul|ol|li|b|strong|br)\b/i.test(content);
  if (looksHtml) return parseHtml(content);

  const looksMarkdown =
    /^#{1,6}\s+\S/m.test(content) ||
    /\*\*[^*\n]+\*\*/m.test(content) ||
    /^\s*[-*+]\s+\S/m.test(content) ||
    /^\s*\d+[.)]\s+\S/m.test(content);
  if (looksMarkdown) return parseMarkdown(content);

  return parsePlainText(content);
}

/* ── Main PDF generator (async — loads logo before rendering) ─────────────── */
export async function generateRiskReportPDF(
  agentName: string,
  agentId: string,
  riskLevel: string,
  aivssScore: string,
  riskSummaryContent: string
): Promise<void> {
  // Sanitize header fields — jsPDF's built-in Helvetica uses Latin-1 encoding;
  // any character outside that range causes "Cannot read properties of undefined
  // (reading 'Unicode')" when splitTextToSize / text tries to look up glyph widths.
  agentName = stripInlineMd(agentName);
  agentId   = stripInlineMd(agentId);
  riskLevel = stripInlineMd(riskLevel);
  aivssScore = stripInlineMd(aivssScore);

  // Pre-load the Tavro logo (graceful fallback if unavailable)
  let logoImg: HTMLImageElement | null = null;
  try {
    logoImg = await loadImage(tavrLogoUrl);
  } catch { /* continue without logo */ }

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const visual = PDF_VISUAL_FORMAT;
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const ML = 18;
  const CW = PW - ML * 2;

  const docFont = registerRiskPdfFont(doc);

  let y = 0;

  function guard(needed: number): void {
    if (y + needed > PH - 14) {
      doc.addPage();
      y = 22;
    }
  }

  function addText(
    str: string,
    opts: {
      x?: number;
      maxW?: number;
      size: number;
      style?: string;
      color: [number, number, number];
      lineH: number;
      align?: 'left' | 'right' | 'center';
    }
  ): void {
    const { x = ML, maxW = CW, size, style = 'normal', color, lineH, align = 'left' } = opts;
    doc.setFontSize(size);
    doc.setFont(docFont, style);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(str, maxW);
    for (const line of lines) {
      guard(lineH);
      doc.text(line, x, y, align !== 'left' ? { align } : undefined);
      y += lineH;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HEADER BANNER
  // ══════════════════════════════════════════════════════════════════════════

  doc.setFillColor(...visual.headerBackground);
  doc.rect(0, 0, PW, visual.headerHeight, 'F');
  doc.setDrawColor(...visual.headerBorder);
  doc.setLineWidth(0.3);
  doc.line(0, visual.headerHeight - 0.3, PW, visual.headerHeight - 0.3);
  if (visual.accentHeight > 0) {
    doc.setFillColor(...visual.accent);
    doc.rect(ML, visual.headerHeight - visual.accentHeight - 1, PW - (ML * 2), visual.accentHeight, 'F');
  }

  // Logo — rendered directly, no tile/card wrapper
  const LOGO_H = 11;
  const LOGO_Y = (visual.headerHeight - LOGO_H) / 2;
  let titleX = ML + LOGO_H + 5;      // default; updated below with actual logo width

  if (logoImg) {
    const ratio = logoImg.naturalWidth / logoImg.naturalHeight;
    const logoW = Math.min(LOGO_H * ratio, 38);
    try {
      doc.addImage(logoImg, 'PNG', ML, LOGO_Y, logoW, LOGO_H);
      titleX = ML + logoW + 5;
    } catch { /* logo unavailable — title starts at default offset */ }
  }

  // Name: agent name (bold, 11pt)
  doc.setTextColor(...visual.nameColor);
  doc.setFontSize(visual.nameSize);
  doc.setFont(docFont, 'bold');
  const agentNameLines = doc.splitTextToSize(agentName, PW - titleX - ML) as string[];
  doc.text(agentNameLines[0] ?? agentName, titleX, visual.nameY);

  // Type: document type (8pt, slate-600)
  doc.setTextColor(...visual.typeColor);
  doc.setFontSize(visual.typeSize);
  doc.setFont(docFont, 'normal');
  doc.text('AI Risk Assessment Report', titleX, visual.typeY);

  // Platform subtitle
  doc.setTextColor(...visual.subtitleColor);
  doc.setFontSize(visual.subtitleSize);
  doc.setFont(docFont, 'normal');
  doc.text('Tavro AI Governance Platform', titleX, visual.subtitleY);

  // Right: generation date
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
  doc.setTextColor(...visual.dateColor);
  doc.setFontSize(visual.dateSize);
  doc.setFont(docFont, 'normal');
  doc.text(dateStr, PW - ML, visual.dateY, { align: 'right' });

  y = visual.contentStartY;

  // ══════════════════════════════════════════════════════════════════════════
  // AGENT INFO CARD
  // ══════════════════════════════════════════════════════════════════════════

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(ML, y, CW, 26, 2.5, 2.5, 'DF');

  doc.setTextColor(148, 163, 184);
  doc.setFontSize(6.5);
  doc.setFont(docFont, 'bold');
  doc.text('AGENT', ML + 4, y + 6);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(12);
  doc.setFont(docFont, 'bold');
  doc.text(doc.splitTextToSize(agentName, CW - 10)[0], ML + 4, y + 13.5);

  doc.setTextColor(100, 116, 139);
  doc.setFontSize(7.5);
  doc.setFont(docFont, 'normal');
  doc.text(agentId, ML + 4, y + 21);

  y += 34;

  // ══════════════════════════════════════════════════════════════════════════
  // RISK OVERVIEW CARD
  // ══════════════════════════════════════════════════════════════════════════

  const fg = riskFg(riskLevel);
  const bg = riskBg(riskLevel);

  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(ML, y, CW, 32, 2.5, 2.5, 'DF');

  doc.setTextColor(100, 116, 139);
  doc.setFontSize(6.5);
  doc.setFont(docFont, 'bold');
  doc.text('RISK OVERVIEW', ML + 4, y + 6);

  doc.setFillColor(...bg);
  doc.roundedRect(ML + 4, y + 9, 44, 11, 2, 2, 'F');
  doc.setTextColor(...fg);
  doc.setFontSize(8.5);
  doc.setFont(docFont, 'bold');
  doc.text(riskLevel, ML + 4 + 22, y + 16, { align: 'center' });

  doc.setDrawColor(226, 232, 240);
  doc.line(ML + 52, y + 8, ML + 52, y + 28);

  doc.setTextColor(100, 116, 139);
  doc.setFontSize(7);
  doc.setFont(docFont, 'normal');
  doc.text('AIVSS Score', ML + 56, y + 13);
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(12);
  doc.setFont(docFont, 'bold');
  doc.text(aivssScore, ML + 56, y + 22);

  if (aivssScore !== 'N/A') {
    const score = parseFloat(aivssScore);
    const maxScore = aivssScore.includes('/') ? (parseFloat(aivssScore.split('/')[1]) || 10) : 10;
    const pct = Number.isFinite(score) ? Math.min(score / maxScore, 1) : 0;
    const bx = ML + 82, by = y + 19, bw = 48, bh = 3;
    doc.setFillColor(226, 232, 240);
    doc.roundedRect(bx, by, bw, bh, 1.5, 1.5, 'F');
    if (pct > 0) { doc.setFillColor(...fg); doc.roundedRect(bx, by, bw * pct, bh, 1.5, 1.5, 'F'); }
  }

  doc.setFillColor(239, 246, 255);
  doc.roundedRect(PW - ML - 50, y + 9, 23, 8, 1.5, 1.5, 'F');
  doc.setTextColor(37, 99, 235);
  doc.setFontSize(6.5);
  doc.setFont(docFont, 'bold');
  doc.text('EU AI Act', PW - ML - 50 + 11.5, y + 14, { align: 'center' });

  doc.setFillColor(240, 253, 244);
  doc.roundedRect(PW - ML - 24, y + 9, 20, 8, 1.5, 1.5, 'F');
  doc.setTextColor(22, 163, 74);
  doc.text('OWASP', PW - ML - 24 + 10, y + 14, { align: 'center' });

  y += 40;

  // ══════════════════════════════════════════════════════════════════════════
  // REPORT CONTENT
  // ══════════════════════════════════════════════════════════════════════════

  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(203, 213, 225);
  doc.rect(ML, y, CW, 9, 'DF');
  doc.setTextColor(51, 65, 85);
  doc.setFontSize(7.5);
  doc.setFont(docFont, 'bold');
  doc.text('DETAILED ASSESSMENT REPORT', ML + 4, y + 6);
  y += 13;

  const blocks = detectBlocks(riskSummaryContent);

  for (const block of blocks) {

    // ── h2: Section heading ──────────────────────────────────────────────────
    if (block.kind === 'h2') {
      if (!block.text.trim()) continue;
      guard(16);
      if (y > 65) y += 4;

      doc.setFillColor(37, 99, 235);
      doc.rect(ML, y, 3, 9, 'F');
      doc.setFillColor(239, 246, 255);
      doc.rect(ML + 3, y, CW - 3, 9, 'F');
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(9.5);
      doc.setFont(docFont, 'bold');
      doc.text(block.text.toUpperCase(), ML + 7, y + 6.3);
      y += 12;

    // ── h3: Sub-heading ──────────────────────────────────────────────────────
    } else if (block.kind === 'h3') {
      if (!block.text.trim()) continue;
      guard(12);
      y += 3;
      doc.setFontSize(9);
      doc.setFont(docFont, 'bold');
      doc.setTextColor(51, 65, 85);
      const h3lines = doc.splitTextToSize(block.text, CW - 2);
      for (const line of h3lines) {
        guard(5.5);
        doc.text(line, ML + 1, y);
        y += 5.5;
      }
      doc.setDrawColor(203, 213, 225);
      doc.line(ML + 1, y, ML + CW, y);
      y += 4;

    // ── p: Paragraph ────────────────────────────────────────────────────────
    } else if (block.kind === 'p') {
      if (!block.text.trim()) continue;
      guard(6);
      addText(block.text, { size: 8.5, color: [71, 85, 105], lineH: 4.5 });
      y += 2;

    // ── kv: Key-value pair ───────────────────────────────────────────────────
    } else if (block.kind === 'kv') {
      guard(6);
      const keyLabel = `${block.key}: `;
      doc.setFontSize(8.5);
      doc.setFont(docFont, 'bold');
      doc.setTextColor(30, 41, 59);
      const keyW = doc.getTextWidth(keyLabel);

      const minValW = 55;
      if (keyW > CW - minValW) {
        // Key too wide — stack vertically
        doc.text(keyLabel.trimEnd(), ML, y);
        y += 5;
        addText(block.value, { x: ML + 4, maxW: CW - 4, size: 8.5, color: [71, 85, 105], lineH: 4.5 });
      } else {
        // Inline: bold key + normal value on same baseline
        const valLines = doc.splitTextToSize(block.value, CW - keyW - 1);
        doc.text(keyLabel, ML, y);
        doc.setFont(docFont, 'normal');
        doc.setTextColor(71, 85, 105);
        doc.text(valLines[0] ?? '', ML + keyW, y);
        y += 5;
        for (let vi = 1; vi < valLines.length; vi++) {
          guard(4.5);
          doc.setFontSize(8.5);
          doc.setFont(docFont, 'normal');
          doc.setTextColor(71, 85, 105);
          doc.text(valLines[vi], ML + keyW, y);
          y += 4.5;
        }
      }

    // ── li: Bullet list item ─────────────────────────────────────────────────
    } else if (block.kind === 'li') {
      if (!block.text.trim()) continue;
      guard(6);
      doc.setFillColor(37, 99, 235);
      doc.rect(ML + 1.5, y - 2.5, 1.8, 1.8, 'F');
      addText(block.text, { x: ML + 5.5, maxW: CW - 5.5, size: 8.5, color: [71, 85, 105], lineH: 4.5 });
      y += 0.5;

    // ── table: Formatted table ───────────────────────────────────────────────
    } else if (block.kind === 'table') {
      const { headers, rows } = block;
      const colCount = Math.max(headers.length, ...rows.map(row => row.length), 0);
      if (colCount === 0) continue;

      guard(18);
      y += 3;

      const normalizedHeaders = headers.length > 0
        ? Array.from({ length: colCount }, (_, i) => headers[i] ?? '')
        : [];
      const normalizedRows = rows.map(row => Array.from({ length: colCount }, (_, i) => row[i] ?? ''));
      const colWidths = calcColWidths(normalizedHeaders, normalizedRows, CW);
      const PAD = 2.5;
      const LH = 3.8;
      const MAX_LINES = 7;

      const calcRH = (cells: string[]): number => {
        let max = 1;
        doc.setFontSize(7.5);
        cells.forEach((cell, ci) => {
          const ls = doc.splitTextToSize(cell, (colWidths[ci] ?? 20) - PAD * 2);
          max = Math.max(max, Math.min(ls.length, MAX_LINES));
        });
        return max * LH + PAD * 2 + 1;
      };

      const drawRow = (
        cells: string[], rY: number, rH: number, isHeader: boolean, isAlt: boolean
      ): void => {
        if (isHeader) {
          doc.setFillColor(30, 58, 138);
        } else {
          doc.setFillColor(isAlt ? 241 : 255, isAlt ? 245 : 255, isAlt ? 249 : 255);
        }
        doc.setDrawColor(isHeader ? 59 : 203, isHeader ? 99 : 213, isHeader ? 235 : 225);
        doc.rect(ML, rY, CW, rH, 'DF');

        doc.setFontSize(7.5);
        doc.setFont(docFont, isHeader ? 'bold' : 'normal');
        doc.setTextColor(isHeader ? 255 : 51, isHeader ? 255 : 65, isHeader ? 255 : 85);

        let xCursor = ML;
        cells.forEach((cell, ci) => {
          const cw = colWidths[ci] ?? 20;
          const ls: string[] = doc.splitTextToSize(cell, cw - PAD * 2);
          ls.slice(0, MAX_LINES).forEach((l: string, li: number) => {
            doc.text(l, xCursor + PAD, rY + PAD + 3 + li * LH);
          });
          if (ci < cells.length - 1) {
            doc.setDrawColor(isHeader ? 59 : 226, isHeader ? 99 : 232, isHeader ? 235 : 240);
            doc.line(xCursor + cw, rY, xCursor + cw, rY + rH);
          }
          xCursor += cw;
        });
      };

      if (normalizedHeaders.length > 0) {
        const rh = calcRH(normalizedHeaders);
        guard(rh);
        drawRow(normalizedHeaders, y, rh, true, false);
        y += rh;
      }

      normalizedRows.forEach((row, ri) => {
        const rh = calcRH(row);
        guard(rh);
        drawRow(row, y, rh, false, ri % 2 === 1);
        y += rh;
      });

      y += 6;

    // ── hr ───────────────────────────────────────────────────────────────────
    } else if (block.kind === 'hr') {
      guard(5);
      doc.setDrawColor(203, 213, 225);
      doc.line(ML, y, ML + CW, y);
      y += 4;

    // ── spacer ───────────────────────────────────────────────────────────────
    } else if (block.kind === 'spacer') {
      y += 2;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FOOTER — every page
  // ══════════════════════════════════════════════════════════════════════════

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFillColor(...visual.footerBackground);
    doc.rect(0, PH - visual.footerHeight, PW, visual.footerHeight, 'F');
    doc.setDrawColor(...visual.footerBorder);
    doc.line(0, PH - visual.footerHeight, PW, PH - visual.footerHeight);
    doc.setTextColor(...visual.footerText);
    doc.setFontSize(7);
    doc.setFont(docFont, 'normal');
    doc.text('Tavro AI Governance Platform  ·  Confidential', ML, PH - 5.5);
    doc.text(`Page ${p} of ${totalPages}`, PW - ML, PH - 5.5, { align: 'right' });
  }

  const safeName = agentName.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
  savePdf(doc, `${safeName}_risk_report_${new Date().toISOString().slice(0, 10)}.pdf`);
}
