// ── src/components/BlueprintDimCard.tsx ──────────────────────────────────────
// Dimension node card — matches the visual style of AgentCatalog cards.
// Used in the list view of BlueprintPage.

import React from 'react';
import { ChevronRight, ShieldAlert, Eye, EyeOff, Trash2 } from 'lucide-react';
import type { DimNode } from '../types/blueprint';
import { CATEGORY_PALETTE, CATEGORY_LABELS } from '../types/blueprint';

interface BlueprintDimCardProps {
  node: DimNode;
  onClick: (node: DimNode) => void;
  onDelete?: (node: DimNode) => void;
}

const BlueprintDimCard: React.FC<BlueprintDimCardProps> = ({ node, onClick, onDelete }) => {
  const cat = node.category ?? 'custom';
  const palette = CATEGORY_PALETTE[cat as keyof typeof CATEGORY_PALETTE] ?? CATEGORY_PALETTE.custom;

  return (
    <div
      onClick={() => onClick(node)}
      className="group bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md hover:border-blue-200 dark:hover:border-blue-800 transition-all cursor-pointer p-4 flex flex-col gap-3"
    >
      {/* ── Top row: category badge + visibility ─────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border"
          style={{ background: palette.bg, color: palette.text, borderColor: palette.badge }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: palette.stroke }} />
          {CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] ?? 'Custom'}
        </span>

        <div className="flex items-center gap-1.5">
          {node.sensitive && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-800 px-1.5 py-0.5 rounded-full">
              <ShieldAlert size={10} /> Sensitive
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400 dark:text-slate-500">
            {node.visibility === 'public' || node.visibility === 'internal'
              ? <Eye size={10} />
              : <EyeOff size={10} />}
            {node.visibility}
          </span>
        </div>
      </div>

      {/* ── Label ────────────────────────────────────────────────────────── */}
      <div>
        <p className="font-bold text-slate-800 dark:text-slate-100 text-sm group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors leading-snug">
          {node.label}
        </p>
        {node.summary && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed line-clamp-2">
            {node.summary}
          </p>
        )}
      </div>

      {/* ── Tags ─────────────────────────────────────────────────────────── */}
      {node.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {node.tags.slice(0, 5).map(tag => (
            <span key={tag}
              className="text-[9px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded-full border border-slate-200 dark:border-slate-700">
              {tag}
            </span>
          ))}
          {node.tags.length > 5 && (
            <span className="text-[9px] text-slate-400 dark:text-slate-500 px-1 py-0.5">
              +{node.tags.length - 5} more
            </span>
          )}
        </div>
      )}

      {/* ── Footer: id + delete + open arrow ─────────────────────────────── */}
      <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800">
        <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
          {node.id.slice(0, 8)}
        </span>
        <div className="flex items-center gap-1">
          {onDelete && (
            <button
              onClick={e => { e.stopPropagation(); onDelete(node); }}
              className="p-1 text-slate-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 rounded transition-colors opacity-0 group-hover:opacity-100"
              title="Delete dimension"
            >
              <Trash2 size={13} />
            </button>
          )}
          <ChevronRight size={14} className="text-slate-300 dark:text-slate-600 group-hover:text-blue-500 dark:group-hover:text-blue-400 transform group-hover:translate-x-0.5 transition-all" />
        </div>
      </div>
    </div>
  );
};

// ── List view row (table layout, matches UseCaseCatalog list mode) ─────────────

interface BlueprintDimRowProps {
  node: DimNode;
  onClick: (node: DimNode) => void;
  onDelete?: (node: DimNode) => void;
}

export const BlueprintDimRow: React.FC<BlueprintDimRowProps> = ({ node, onClick, onDelete }) => {
  const cat = node.category ?? 'custom';
  const palette = CATEGORY_PALETTE[cat as keyof typeof CATEGORY_PALETTE] ?? CATEGORY_PALETTE.custom;

  return (
    <div
      onClick={() => onClick(node)}
      className="grid grid-cols-[2fr_1fr_120px_100px_48px] items-center px-6 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors group border-b border-slate-100 dark:border-slate-800 last:border-0"
    >
      <div className="flex flex-col gap-0.5 pr-4">
        <span className="font-bold text-slate-800 dark:text-slate-100 text-sm group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
          {node.label}
        </span>
        {node.summary && (
          <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate">{node.summary}</span>
        )}
      </div>
      <div>
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border"
          style={{ background: palette.bg, color: palette.text, borderColor: palette.badge }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: palette.stroke }} />
          {CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] ?? 'Custom'}
        </span>
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400 capitalize">{node.visibility}</div>
      <div>
        {node.sensitive && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-800 px-1.5 py-0.5 rounded-full">
            <ShieldAlert size={10} /> Sensitive
          </span>
        )}
      </div>
      <div className="flex items-center justify-end gap-1">
        {onDelete && (
          <button
            onClick={e => { e.stopPropagation(); onDelete(node); }}
            className="p-1 text-slate-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 rounded transition-colors opacity-0 group-hover:opacity-100"
            title="Delete dimension"
          >
            <Trash2 size={13} />
          </button>
        )}
        <ChevronRight size={16} className="text-slate-300 dark:text-slate-600 group-hover:text-blue-500 dark:group-hover:text-blue-400 transform group-hover:translate-x-0.5 transition-all" />
      </div>
    </div>
  );
};

export default BlueprintDimCard;
