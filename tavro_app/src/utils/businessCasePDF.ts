import { jsPDF } from 'jspdf';
import tavrLogoUrl from '../assets/travo_logo.png';
import { PDF_VISUAL_FORMAT } from './pdfTemplate';

/* ── Save helper ──────────────────────────────────────────────────────────── */
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

/* ── Markdown / Unicode sanitiser ────────────────────────────────────────── */
function stripInlineMd(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/•/g, '-')
    .replace(/ /g, ' ')
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/___(.+?)___/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/`/g, '')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/!\[.*?\]\(.+?\)/g, '')
    .replace(/[''ʼ]/g, "'")
    .replace(/[""]/g, '"')
    .replace(/–/g, '-')
    .replace(/—/g, '--')
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/•/g, '-')
    .replace(/·/g, '.')
    .replace(/ /g, ' ')
    .replace(/[^\x00-\xFF]/g, '')
    .trim();
}

/* ── Markdown parser ──────────────────────────────────────────────────────── */
function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!trimmed) { i++; continue; }

    const h2m = trimmed.match(/^#{1,2}\s+(.+)$/);
    if (h2m) { blocks.push({ kind: 'h2', text: stripInlineMd(h2m[1]) }); i++; continue; }

    const h3m = trimmed.match(/^#{3,6}\s+(.+)$/);
    if (h3m) { blocks.push({ kind: 'h3', text: stripInlineMd(h3m[1]) }); i++; continue; }

    const next = lines[i + 1]?.trim() ?? '';
    if (next && /^=+$/.test(next)) {
      blocks.push({ kind: 'h2', text: stripInlineMd(trimmed) });
      i += 2; continue;
    }
    if (next && /^-+$/.test(next) && next.length >= 2) {
      blocks.push({ kind: 'h3', text: stripInlineMd(trimmed) });
      i += 2; continue;
    }

    if (/^[-_*]{3,}$/.test(trimmed)) { blocks.push({ kind: 'hr' }); i++; continue; }

    const ulm = trimmed.match(/^[-*+]\s+(.+)$/);
    if (ulm) { blocks.push({ kind: 'li', text: stripInlineMd(ulm[1]) }); i++; continue; }

    const olm = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (olm) { blocks.push({ kind: 'li', text: stripInlineMd(olm[1]) }); i++; continue; }

    const kvBold = trimmed.match(/^\*\*([^*]+?)\*\*:?\s+(.+)$/);
    if (kvBold) {
      blocks.push({ kind: 'kv', key: kvBold[1].trim(), value: stripInlineMd(kvBold[2]) });
      i++; continue;
    }

    const bq = trimmed.match(/^>{1,}\s*(.+)$/);
    if (bq) { blocks.push({ kind: 'p', text: stripInlineMd(bq[1]) }); i++; continue; }

    blocks.push({ kind: 'p', text: stripInlineMd(trimmed) });
    i++;
  }

  return blocks;
}

/* ── Plain-text parser ────────────────────────────────────────────────────── */
function parsePlainText(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!trimmed) { i++; continue; }
    if (/^[=\-]{5,}\s*$/.test(trimmed)) { i++; continue; }

    const nextTrimmed = lines[i + 1]?.trim() ?? '';
    if (/^[=\-]{5,}\s*$/.test(nextTrimmed)) {
      blocks.push({ kind: 'h2', text: stripInlineMd(trimmed) });
      i += 2; continue;
    }

    if (trimmed.endsWith(':') && !trimmed.startsWith('|')) {
      const sub = trimmed.slice(0, -1).trim();
      if (sub.length > 0) { blocks.push({ kind: 'h3', text: stripInlineMd(sub) }); i++; continue; }
    }

    if (/^[ \t]+/.test(raw)) {
      const kvMatch = trimmed.match(/^(.+?):\s+(.+)$/);
      if (kvMatch) {
        blocks.push({ kind: 'kv', key: kvMatch[1].trim(), value: stripInlineMd(kvMatch[2].trim()) });
      } else {
        blocks.push({ kind: 'li', text: stripInlineMd(trimmed) });
      }
      i++; continue;
    }

    const kvMatch = trimmed.match(/^([A-Za-z][^:]{1,60}):\s+(.+)$/);
    if (kvMatch) {
      blocks.push({ kind: 'kv', key: kvMatch[1].trim(), value: stripInlineMd(kvMatch[2].trim()) });
      i++; continue;
    }

    blocks.push({ kind: 'p', text: stripInlineMd(trimmed) });
    i++;
  }

  return blocks;
}

/* ── Content-type detection ───────────────────────────────────────────────── */
function detectBlocks(content: string): Block[] {
  const looksMarkdown =
    /^#{1,6}\s+\S/m.test(content) ||
    /\*\*[^*\n]+\*\*/m.test(content) ||
    /^\s*[-*+]\s+\S/m.test(content) ||
    /^\s*\d+[.)]\s+\S/m.test(content);
  if (looksMarkdown) return parseMarkdown(content);
  return parsePlainText(content);
}

/* ── Load image ───────────────────────────────────────────────────────────── */
async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/* ── Build markdown content from use case fields ─────────────────────────── */
interface BusinessCaseFields {
  title: string;
  description?: string | null;
  business_problem_statement?: string | null;
  solution_approach?: string | null;
  executive_summary?: string | null;
  assumptions?: string | null;
  quantified_financial_benefits?: string | null;
  total_financial_impact_summary?: string | null;
  implementation_cost_estimate?: string | null;
  return_on_investment?: string | null;
  risk_considerations?: string | null;
  implementation_roadmap?: string | null;
  recommendation?: string | null;
  expected_benefits?: string | null;
}

function buildContent(uc: BusinessCaseFields): string {
  const sections: string[] = [];

  if (uc.executive_summary?.trim()) {
    sections.push(`## 1. Executive Summary\n\n${uc.executive_summary.trim()}`);
  }

  const problemText = [uc.business_problem_statement, uc.expected_benefits]
    .filter(Boolean).join('\n\n');
  if (problemText) {
    sections.push(`## 2. Problem Statement\n\n${problemText}`);
  }

  const solutionText = [uc.description, uc.solution_approach].filter(Boolean).join('\n\n');
  if (solutionText) {
    sections.push(`## 3. Proposed Solution\n\n${solutionText}`);
  }

  const hasFinancials = [
    uc.assumptions,
    uc.quantified_financial_benefits,
    uc.total_financial_impact_summary,
    uc.implementation_cost_estimate,
    uc.return_on_investment,
  ].some(f => f?.trim());

  if (hasFinancials) {
    const parts: string[] = ['## 4. Financial Benefits'];
    if (uc.assumptions?.trim())
      parts.push(`### 4.1 Assumptions\n\n${uc.assumptions.trim()}`);
    if (uc.quantified_financial_benefits?.trim())
      parts.push(`### 4.2 Quantified Financial Benefits\n\n${uc.quantified_financial_benefits.trim()}`);
    if (uc.total_financial_impact_summary?.trim())
      parts.push(`### 4.3 Total Financial Impact Summary\n\n${uc.total_financial_impact_summary.trim()}`);
    if (uc.implementation_cost_estimate?.trim())
      parts.push(`### 4.4 Implementation Cost Estimate\n\n${uc.implementation_cost_estimate.trim()}`);
    if (uc.return_on_investment?.trim())
      parts.push(`### 4.5 Return on Investment\n\n${uc.return_on_investment.trim()}`);
    sections.push(parts.join('\n\n'));
  }

  if (uc.risk_considerations?.trim()) {
    sections.push(`## 5. Risk Considerations\n\n${uc.risk_considerations.trim()}`);
  }

  if (uc.implementation_roadmap?.trim()) {
    sections.push(`## 6. Implementation Roadmap\n\n${uc.implementation_roadmap.trim()}`);
  }

  if (uc.recommendation?.trim()) {
    sections.push(`## 7. Recommendation\n\n${uc.recommendation.trim()}`);
  }

  return sections.join('\n\n');
}

/* ── Main export ──────────────────────────────────────────────────────────── */
export async function generateBusinessCasePDF(uc: BusinessCaseFields): Promise<void> {
  const title = stripInlineMd(uc.title || 'AI Use Case');

  let logoImg: HTMLImageElement | null = null;
  try { logoImg = await loadImage(tavrLogoUrl); } catch { /* no logo */ }

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const visual = PDF_VISUAL_FORMAT;
  const font = 'helvetica';
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const ML = 18;
  const CW = PW - ML * 2;

  let y = 0;

  function guard(needed: number): void {
    if (y + needed > PH - 14) { doc.addPage(); y = 22; }
  }

  function addText(
    str: string,
    opts: { x?: number; maxW?: number; size: number; style?: string; color: [number, number, number]; lineH: number; align?: 'left' | 'right' | 'center' }
  ): void {
    const { x = ML, maxW = CW, size, style = 'normal', color, lineH, align = 'left' } = opts;
    doc.setFontSize(size);
    doc.setFont(font, style);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(str, maxW);
    for (const line of lines) {
      guard(lineH);
      doc.text(line, x, y, align !== 'left' ? { align } : undefined);
      y += lineH;
    }
  }

  // ── HEADER ─────────────────────────────────────────────────────────────────
  doc.setFillColor(...visual.headerBackground);
  doc.rect(0, 0, PW, visual.headerHeight, 'F');
  doc.setDrawColor(...visual.headerBorder);
  doc.setLineWidth(0.3);
  doc.line(0, visual.headerHeight - 0.3, PW, visual.headerHeight - 0.3);
  if (visual.accentHeight > 0) {
    doc.setFillColor(...visual.accent);
    doc.rect(ML, visual.headerHeight - visual.accentHeight - 1, PW - ML * 2, visual.accentHeight, 'F');
  }

  const LOGO_H = 11;
  const LOGO_Y = (visual.headerHeight - LOGO_H) / 2;
  let titleX = ML + LOGO_H + 5;
  if (logoImg) {
    const ratio = logoImg.naturalWidth / logoImg.naturalHeight;
    const logoW = Math.min(LOGO_H * ratio, 38);
    try { doc.addImage(logoImg, 'PNG', ML, LOGO_Y, logoW, LOGO_H); titleX = ML + logoW + 5; }
    catch { /* logo unavailable */ }
  }

  const titleMaxW = PW - titleX - ML;
  let titleFontSize = visual.nameSize;
  doc.setFont(font, 'bold');
  doc.setFontSize(titleFontSize);
  while (doc.splitTextToSize(title, titleMaxW).length > 1 && titleFontSize > 7.5) {
    titleFontSize -= 0.5;
    doc.setFontSize(titleFontSize);
  }
  doc.setTextColor(...visual.nameColor);
  doc.text(title, titleX, visual.nameY, { maxWidth: titleMaxW });

  doc.setTextColor(...visual.typeColor);
  doc.setFontSize(visual.typeSize);
  doc.setFont(font, 'normal');
  doc.text('Business Case Report', titleX, visual.typeY);

  doc.setTextColor(...visual.subtitleColor);
  doc.setFontSize(visual.subtitleSize);
  doc.setFont(font, 'normal');
  doc.text('Tavro AI Governance Platform', titleX, visual.subtitleY);

  const now = new Date();
  const timestampStr = `Generated: ${now.toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })}`;
  doc.setTextColor(...visual.dateColor);
  doc.setFontSize(visual.dateSize);
  doc.setFont(font, 'normal');
  doc.text(timestampStr, PW - ML, visual.dateY, { align: 'right' });

  y = visual.contentStartY;

  // ── CONTENT BLOCKS ─────────────────────────────────────────────────────────
  const content = buildContent(uc);
  const blocks = detectBlocks(content);

  for (const block of blocks) {

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
      doc.setFont(font, 'bold');
      doc.text(block.text.toUpperCase(), ML + 7, y + 6.3);
      y += 12;

    } else if (block.kind === 'h3') {
      if (!block.text.trim()) continue;
      guard(12);
      y += 3;
      doc.setFontSize(9);
      doc.setFont(font, 'bold');
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

    } else if (block.kind === 'p') {
      if (!block.text.trim()) continue;
      guard(6);
      addText(block.text, { size: 8.5, color: [71, 85, 105], lineH: 4.5 });
      y += 2;

    } else if (block.kind === 'kv') {
      guard(6);
      const keyLabel = `${block.key}: `;
      doc.setFontSize(8.5);
      doc.setFont(font, 'bold');
      doc.setTextColor(30, 41, 59);
      const keyW = doc.getTextWidth(keyLabel);
      const minValW = 55;
      if (keyW > CW - minValW) {
        doc.text(keyLabel.trimEnd(), ML, y);
        y += 5;
        addText(block.value, { x: ML + 4, maxW: CW - 4, size: 8.5, color: [71, 85, 105], lineH: 4.5 });
      } else {
        const valLines = doc.splitTextToSize(block.value, CW - keyW - 1);
        doc.text(keyLabel, ML, y);
        doc.setFont(font, 'normal');
        doc.setTextColor(71, 85, 105);
        doc.text(valLines[0] ?? '', ML + keyW, y);
        y += 5;
        for (let vi = 1; vi < valLines.length; vi++) {
          guard(4.5);
          doc.setFontSize(8.5);
          doc.setFont(font, 'normal');
          doc.setTextColor(71, 85, 105);
          doc.text(valLines[vi], ML + keyW, y);
          y += 4.5;
        }
      }

    } else if (block.kind === 'li') {
      if (!block.text.trim()) continue;
      guard(6);
      doc.setFillColor(37, 99, 235);
      doc.rect(ML + 1.5, y - 2.5, 1.8, 1.8, 'F');
      addText(block.text, { x: ML + 5.5, maxW: CW - 5.5, size: 8.5, color: [71, 85, 105], lineH: 4.5 });
      y += 0.5;

    } else if (block.kind === 'table') {
      const { headers, rows } = block;
      const colCount = Math.max(headers.length, ...rows.map(r => r.length), 0);
      if (colCount === 0) continue;
      guard(18);
      y += 3;
      const normHeaders = headers.length > 0
        ? Array.from({ length: colCount }, (_, i) => headers[i] ?? '')
        : [];
      const normRows = rows.map(row => Array.from({ length: colCount }, (_, i) => row[i] ?? ''));
      const colWidths = calcColWidths(normHeaders, normRows, CW);
      const PAD = 2.5, LH = 3.8, MAX_LINES = 7;
      const calcRH = (cells: string[]): number => {
        let max = 1;
        doc.setFontSize(7.5);
        cells.forEach((cell, ci) => {
          const ls = doc.splitTextToSize(cell, (colWidths[ci] ?? 20) - PAD * 2);
          max = Math.max(max, Math.min(ls.length, MAX_LINES));
        });
        return max * LH + PAD * 2 + 1;
      };
      const drawRow = (cells: string[], rY: number, rH: number, isHeader: boolean, isAlt: boolean): void => {
        doc.setFillColor(isHeader ? 30 : (isAlt ? 241 : 255), isHeader ? 58 : (isAlt ? 245 : 255), isHeader ? 138 : (isAlt ? 249 : 255));
        doc.setDrawColor(isHeader ? 59 : 203, isHeader ? 99 : 213, isHeader ? 235 : 225);
        doc.rect(ML, rY, CW, rH, 'DF');
        doc.setFontSize(7.5);
        doc.setFont(font, isHeader ? 'bold' : 'normal');
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
      if (normHeaders.length > 0) {
        const rh = calcRH(normHeaders);
        guard(rh);
        drawRow(normHeaders, y, rh, true, false);
        y += rh;
      }
      normRows.forEach((row, ri) => {
        const rh = calcRH(row);
        guard(rh);
        drawRow(row, y, rh, false, ri % 2 === 1);
        y += rh;
      });
      y += 6;

    } else if (block.kind === 'hr') {
      guard(5);
      doc.setDrawColor(203, 213, 225);
      doc.line(ML, y, ML + CW, y);
      y += 4;

    } else if (block.kind === 'spacer') {
      y += 2;
    }
  }

  // ── FOOTER ─────────────────────────────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFillColor(...visual.footerBackground);
    doc.rect(0, PH - visual.footerHeight, PW, visual.footerHeight, 'F');
    doc.setDrawColor(...visual.footerBorder);
    doc.line(0, PH - visual.footerHeight, PW, PH - visual.footerHeight);
    doc.setTextColor(...visual.footerText);
    doc.setFontSize(7);
    doc.setFont(font, 'normal');
    doc.text('Tavro AI Governance Platform  \xB7  Confidential', ML, PH - 5.5);
    doc.text(`Page ${p} of ${totalPages}`, PW - ML, PH - 5.5, { align: 'right' });
  }

  const safeName = title.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
  savePdf(doc, `${safeName}_business_case_${new Date().toISOString().slice(0, 10)}.pdf`);
}
