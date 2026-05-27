import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Zap,
  RefreshCw,
  X,
  ChevronDown,
  ChevronUp,
  Bot,
  ArrowRight,
  Lightbulb,
  BookmarkPlus,
  BookmarkCheck,
  AlertCircle,
  SlidersHorizontal,
  Search,
  Trash2,
  Check,
  CheckSquare,
  Target,
  LayoutGrid,
  List,
} from 'lucide-react';
import { useBlueprint } from '../context/BlueprintContext';
import { sparkApi } from '../services/sparkApi';
import { mcpClient } from '../services/mcpClient';
import type { SparkIdea } from '../types/spark';
import {
  SPARK_DIMENSIONS,
  SIGNAL_META,
  COMPLEXITY_META,
  IMPACT_META,
} from '../types/spark';

// ── Idea Card ─────────────────────────────────────────────────────────────────

const IdeaCard: React.FC<{
  idea: SparkIdea;
  saved: boolean;
  onSave: () => void;
  onClick: () => void;
  selectMode?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}> = ({ idea, saved, onSave, onClick, selectMode = false, selected = false, onSelect }) => {
  const signal = SIGNAL_META[idea.signal_type] ?? SIGNAL_META['gap_coverage'];
  const complexityClass = COMPLEXITY_META[idea.complexity] ?? COMPLEXITY_META['Medium'];
  const impactClass = IMPACT_META[idea.estimated_impact] ?? IMPACT_META['Medium'];

  return (
    <div
      onClick={selectMode ? onSelect : undefined}
      className={`group bg-white dark:bg-slate-900 rounded-2xl border transition-all flex flex-col overflow-hidden ${selectMode
        ? `cursor-pointer ${selected
          ? 'border-violet-500 dark:border-violet-400 ring-2 ring-violet-200 dark:ring-violet-800 shadow-md'
          : 'border-slate-200 dark:border-slate-800 hover:border-violet-300 dark:hover:border-violet-700'}`
        : 'border-slate-200 dark:border-slate-800 hover:border-violet-400 dark:hover:border-violet-600 hover:shadow-lg'
        }`}
    >
      <div className={`h-1.5 bg-gradient-to-r ${selected ? 'from-violet-500 to-violet-400' : 'from-violet-500 to-indigo-500'}`} />

      <div className="p-5 flex-1 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="p-2 bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 rounded-xl group-hover:scale-110 transition-transform flex-shrink-0">
            <Lightbulb size={18} />
          </div>
          {selectMode ? (
            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors mt-0.5 ${selected ? 'bg-violet-600 border-violet-600' : 'border-slate-300 dark:border-slate-600'
              }`}>
              {selected && <Check size={11} className="text-white" />}
            </div>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onSave(); }}
              className={`p-1.5 rounded-lg transition-colors ${saved ? 'text-violet-600 dark:text-violet-400' : 'text-slate-300 hover:text-violet-500'}`}
              title={saved ? 'Saved' : 'Save idea'}
            >
              {saved ? <BookmarkCheck size={16} /> : <BookmarkPlus size={16} />}
            </button>
          )}
        </div>

        <h3 className="font-bold text-slate-800 dark:text-slate-100 leading-snug line-clamp-2 group-hover:text-violet-700 dark:group-hover:text-violet-300 transition-colors">
          {idea.title}
        </h3>

        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-3 leading-relaxed flex-1">
          {idea.description}
        </p>

        <div className="flex flex-wrap gap-1.5 mt-auto">
          <span className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border ${signal.color}`}>
            {signal.label}
          </span>
          {idea.target_dimensions.slice(0, 2).map(d => (
            <span key={d} className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 capitalize">
              {d}
            </span>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${complexityClass}`}>
            Complexity: {idea.complexity}
          </span>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${impactClass}`}>
            Impact: {idea.estimated_impact}
          </span>
        </div>
      </div>

      {!selectMode && (
        <button
          onClick={onClick}
          className="flex items-center justify-between px-5 py-3 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-100 dark:border-slate-800 text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-all group/cta"
        >
          <span>View &amp; Develop</span>
          <ArrowRight size={14} className="group-hover/cta:translate-x-1 transition-transform" />
        </button>
      )}
    </div>
  );
};

// ── Idea List Row (list-view variant) ────────────────────────────────────────

const LIST_GRID = 'grid-cols-[32px_1fr_160px_180px_100px_80px_32px]';

const IdeaListRow: React.FC<{
  idea: SparkIdea;
  saved: boolean;
  onSave: () => void;
  onClick: () => void;
  selectMode?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}> = ({ idea, saved, onSave, onClick, selectMode = false, selected = false, onSelect }) => {
  const signal = SIGNAL_META[idea.signal_type] ?? SIGNAL_META['gap_coverage'];
  const complexityClass = COMPLEXITY_META[idea.complexity] ?? COMPLEXITY_META['Medium'];
  const impactClass = IMPACT_META[idea.estimated_impact] ?? IMPACT_META['Medium'];

  return (
    <div
      onClick={selectMode ? onSelect : undefined}
      className={`grid ${LIST_GRID} items-center gap-x-3 px-4 py-3 border-b border-slate-100 dark:border-slate-800 transition-colors last:border-0 ${selectMode
          ? `cursor-pointer ${selected ? 'bg-violet-50 dark:bg-violet-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`
          : 'hover:bg-slate-50 dark:hover:bg-slate-800/30'
        }`}
    >
      {/* Col 1: bookmark / checkbox */}
      {selectMode ? (
        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${selected ? 'bg-violet-600 border-violet-600' : 'border-slate-300 dark:border-slate-600'}`}>
          {selected && <Check size={10} className="text-white" />}
        </div>
      ) : (
        <button
          onClick={e => { e.stopPropagation(); onSave(); }}
          className={`p-1 rounded transition-colors ${saved ? 'text-violet-600 dark:text-violet-400' : 'text-slate-300 hover:text-violet-500'}`}
        >
          {saved ? <BookmarkCheck size={14} /> : <BookmarkPlus size={14} />}
        </button>
      )}

      {/* Col 2: Title + description */}
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{idea.title}</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 truncate mt-0.5">{idea.description}</p>
      </div>

      {/* Col 3: Signal */}
      <div className="flex justify-start">
        <span className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border ${signal.color}`}>
          {signal.label}
        </span>
      </div>

      {/* Col 4: Dimensions */}
      <div className="flex gap-1 flex-wrap">
        {idea.target_dimensions.slice(0, 2).map(d => (
          <span key={d} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 capitalize">
            {d}
          </span>
        ))}
      </div>

      {/* Col 5: Complexity */}
      <div className="flex justify-center">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${complexityClass}`}>
          {idea.complexity}
        </span>
      </div>

      {/* Col 6: Impact */}
      <div className="flex justify-center">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${impactClass}`}>
          {idea.estimated_impact}
        </span>
      </div>

      {/* Col 7: Action */}
      {selectMode ? (
        <div />
      ) : (
        <button
          onClick={e => { e.stopPropagation(); onClick(); }}
          className="flex items-center justify-center text-slate-400 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
          title="View & Develop"
        >
          <ArrowRight size={15} />
        </button>
      )}
    </div>
  );
};

// ── Idea Detail Modal ─────────────────────────────────────────────────────────

const IdeaModal: React.FC<{
  idea: SparkIdea;
  companyId: string;
  onClose: () => void;
}> = ({ idea, companyId, onClose }) => {
  const navigate = useNavigate();
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const signal = SIGNAL_META[idea.signal_type] ?? SIGNAL_META['gap_coverage'];
  const complexityClass = COMPLEXITY_META[idea.complexity] ?? COMPLEXITY_META['Medium'];
  const impactClass = IMPACT_META[idea.estimated_impact] ?? IMPACT_META['Medium'];

  const handleConvert = async () => {
    setConverting(true);
    setConvertError(null);
    try {
      // Step 1: Enrich idea into use case fields + agent recommendation via Claude
      const { use_case_fields: fields, agent_recommendation: agentRec } = await sparkApi.convertIdea({
        idea_id: idea.idea_id,
        company_id: companyId,
        title: idea.title,
        description: idea.description,
        rationale: idea.rationale,
        target_dimensions: idea.target_dimensions,
        signal_label: idea.signal_label,
        complexity: idea.complexity,
        estimated_impact: idea.estimated_impact,
      });

      // Step 2: Create the AI use case via MCP
      const created = await mcpClient.createAiUseCase({
        ...fields,
        original_prompt: `Convert Spark idea to AI use case: ${idea.title}`,
      });
      if (!created?.use_case_id) {
        throw new Error(created?.details || created?.error || 'Use case creation failed');
      }
      const useCaseId = created.use_case_id as string;

      // Step 3: Create agent and link it (best-effort — don't block navigation on failure)
      if (agentRec?.agent_name) {
        try {
          // Fetch company applications to enrich generic tool names with real assets
          let enrichedTools = (agentRec.tools ?? []) as { name: string; description: string }[];
          try {
            const appCatalog = await mcpClient.getApplicationCatalog({
              original_prompt: `Find applications relevant to: ${idea.title}`,
              start_record: 1,
              record_range: '1-20',
            });
            const apps: { application_name?: string; description?: string }[] =
              appCatalog?.agents ?? appCatalog?.applications ?? appCatalog?.items ?? [];

            if (apps.length > 0) {
              // Replace generic tool entries with real company application names where a match is plausible
              enrichedTools = enrichedTools.map((tool: { name: string; description: string }) => {
                const match = apps.find(a =>
                  a.application_name &&
                  (tool.name.toLowerCase().includes(a.application_name.toLowerCase().split(' ')[0]) ||
                   a.application_name.toLowerCase().includes(tool.name.toLowerCase().split(' ')[0]))
                );
                return match
                  ? { name: match.application_name!, description: match.description ?? tool.description }
                  : tool;
              });
            }
          } catch {
            // Catalog fetch failed — use Claude-suggested tools as-is
          }

          const agent = await mcpClient.createAgent({
            agent_name: agentRec.agent_name,
            description: agentRec.description ?? '',
            instruction: agentRec.instruction ?? agentRec.description ?? '',
            tools: enrichedTools.length > 0 ? enrichedTools : undefined,
            knowledge_source: agentRec.knowledge_source ?? undefined,
            original_prompt: `Create agent for AI use case: ${idea.title}`,
          });

          if (agent?.agent_id) {
            await mcpClient.createAiUseCaseAgentRelationship(useCaseId, agent.agent_id);
          }
        } catch {
          // Agent creation is best-effort; use case was created successfully
        }
      }

      // Step 4: Navigate to the newly created use case
      navigate(`/use-case/${encodeURIComponent(useCaseId)}`);
    } catch (err) {
      setConvertError(err instanceof Error ? err.message : 'Failed to create use case');
      setConverting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="h-1.5 bg-gradient-to-r from-violet-500 to-indigo-500 rounded-t-2xl" />

        <div className="p-6 flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-violet-50 dark:bg-violet-900/20 text-violet-600 rounded-xl">
                <Lightbulb size={20} />
              </div>
              <div>
                <h2 className="font-bold text-lg text-slate-800 dark:text-slate-100 leading-tight">{idea.title}</h2>
                <span className={`inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border mt-1 ${signal.color}`}>
                  {signal.label}
                </span>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
              <X size={18} />
            </button>
          </div>

          <div>
            <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Description</h3>
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{idea.description}</p>
          </div>

          <div className="bg-violet-50 dark:bg-violet-900/20 rounded-xl p-4 border border-violet-100 dark:border-violet-800">
            <h3 className="text-xs font-bold text-violet-700 dark:text-violet-300 uppercase tracking-wider mb-1.5">Why this matters</h3>
            <p className="text-sm text-violet-800 dark:text-violet-200 leading-relaxed">{idea.rationale}</p>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 bg-slate-50 dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700 text-center">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Complexity</p>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-md border ${complexityClass}`}>{idea.complexity}</span>
            </div>
            <div className="flex-1 bg-slate-50 dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700 text-center">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Est. Impact</p>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-md border ${impactClass}`}>{idea.estimated_impact}</span>
            </div>
            <div className="flex-1 bg-slate-50 dark:bg-slate-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700 text-center">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Dimensions</p>
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 capitalize">{idea.target_dimensions.join(', ')}</p>
            </div>
          </div>

          {idea.target_nodes.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Source context</h3>
              <div className="flex flex-col gap-2">
                {idea.target_nodes.map(node => (
                  <div key={node.id} className="flex items-start gap-2 bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2 border border-slate-100 dark:border-slate-700">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 uppercase flex-shrink-0 mt-0.5">
                      {node.category}
                    </span>
                    <div>
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{node.label}</p>
                      {node.summary && <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">{node.summary}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {idea.similar_agents.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Similar agents in catalog</h3>
              <div className="flex flex-wrap gap-2">
                {idea.similar_agents.map(a => (
                  <button
                    key={a.agent_id}
                    onClick={() => navigate(`/agent/${encodeURIComponent(a.agent_id)}`)}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 transition-colors"
                  >
                    <Bot size={12} />
                    {a.agent_name || a.agent_id}
                  </button>
                ))}
              </div>
            </div>
          )}

          {convertError && (
            <div className="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-red-600 dark:text-red-300">
              <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
              <p className="text-xs">{convertError}</p>
            </div>
          )}

          <div className="border-t border-slate-100 dark:border-slate-800 pt-4 flex gap-3">
            <button
              onClick={handleConvert}
              disabled={converting}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold bg-violet-600 hover:bg-violet-700 text-white transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {converting ? <RefreshCw size={15} className="animate-spin" /> : <Zap size={15} />}
              {converting ? 'Creating use case…' : 'Convert to Use Case'}
            </button>
            <button
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-sm font-bold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Main Page ─────────────────────────────────────────────────────────────────

const SparkPage: React.FC = () => {
  const { activeCompany } = useBlueprint();
  const [ideas, setIdeas] = useState<SparkIdea[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [selectedIdea, setSelectedIdea] = useState<SparkIdea | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextOpen, setContextOpen] = useState(true);
  const [activeDimensions, setActiveDimensions] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [hasLibrary, setHasLibrary] = useState(false);
  const [direction, setDirection] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedForDelete, setSelectedForDelete] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const companyId = activeCompany?.id ?? null;

  const toggleDimension = (key: string) => {
    setActiveDimensions(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSave = (ideaId: string) => {
    setSavedIds(prev => {
      const next = new Set(prev);
      if (next.has(ideaId)) next.delete(ideaId);
      else next.add(ideaId);
      return next;
    });
  };

  // Load stored ideas from DB on mount / when companyId changes
  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    sparkApi.getIdeas(companyId)
      .then(data => {
        setIdeas(data);
        setHasLibrary(data.length > 0);
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load ideas'))
      .finally(() => setLoading(false));
  }, [companyId]);

  // Search against DB as user types (debounced)
  useEffect(() => {
    if (!companyId) return;
    const timer = setTimeout(() => {
      sparkApi.getIdeas(companyId, search || undefined)
        .then(setIdeas)
        .catch(() => { });
    }, 300);
    return () => clearTimeout(timer);
  }, [companyId, search]);

  // Generate fresh ideas (user-initiated only)
  const inspire = useCallback(async () => {
    if (!companyId) return;
    setIdeas([]);
    setGenerating(true);
    setError(null);
    try {
      const dims = activeDimensions.size > 0 ? [...activeDimensions] : undefined;
      const data = await sparkApi.generateIdeas(companyId, dims, direction.trim() || undefined);
      setIdeas(data);
      setHasLibrary(data.length > 0);
      setSearch('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate ideas');
    } finally {
      setGenerating(false);
    }
  }, [companyId, activeDimensions, direction]);

  const enterSelectMode = () => {
    setSelectMode(true);
    setSelectedForDelete(new Set());
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedForDelete(new Set());
  };

  const toggleSelect = (ideaId: string) => {
    setSelectedForDelete(prev => {
      const next = new Set(prev);
      if (next.has(ideaId)) next.delete(ideaId); else next.add(ideaId);
      return next;
    });
  };

  const handleDeleteSelected = useCallback(async () => {
    if (!companyId || selectedForDelete.size === 0) return;
    setDeleting(true);
    setError(null);
    try {
      await sparkApi.deleteIdeas(companyId, [...selectedForDelete]);
      const remaining = ideas.filter(i => !selectedForDelete.has(i.idea_id));
      setIdeas(remaining);
      setSavedIds(prev => {
        const next = new Set(prev);
        selectedForDelete.forEach(id => next.delete(id));
        return next;
      });
      setHasLibrary(remaining.length > 0);
      exitSelectMode();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete ideas');
    } finally {
      setDeleting(false);
    }
  }, [companyId, selectedForDelete, ideas]);

  const savedIdeas = ideas.filter(i => savedIds.has(i.idea_id));

  // Client-side dimension filter applied to whatever is currently loaded
  const filteredIdeas = activeDimensions.size > 0
    ? ideas.filter(i => i.target_dimensions.some(d => activeDimensions.has(d)))
    : ideas;

  const selectAll = () => setSelectedForDelete(new Set(filteredIdeas.map(i => i.idea_id)));
  const deselectAll = () => setSelectedForDelete(new Set());
  const allSelected = filteredIdeas.length > 0 && filteredIdeas.every(i => selectedForDelete.has(i.idea_id));

  const refresh = useCallback(() => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    sparkApi.getIdeas(companyId, search || undefined)
      .then(data => { setIdeas(data); setHasLibrary(data.length > 0); })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to refresh'))
      .finally(() => setLoading(false));
  }, [companyId, search]);

  return (
    <div className="flex flex-col gap-6 w-full max-w-[1600px] mx-auto animate-fade-in">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="p-2 bg-violet-100 dark:bg-violet-900/30 rounded-xl">
              <Zap size={20} className="text-violet-600 dark:text-violet-400" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Spark</h1>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            AI ideation hub — AI Use Case candidates that fits your business vision and your enteprise portfolio of assets
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {hasLibrary && !selectMode && (
            <button
              onClick={enterSelectMode}
              disabled={generating}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 hover:border-violet-400 hover:text-violet-600 dark:hover:text-violet-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CheckSquare size={15} />
              Select
            </button>
          )}

          <button
            onClick={inspire}
            disabled={generating || !companyId || selectMode}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-violet-600 hover:bg-violet-700 text-white shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating
              ? <RefreshCw size={16} className="animate-spin" />
              : <Zap size={16} />}
            {generating ? 'Generating…' : 'Inspire Me'}
          </button>
        </div>
      </div>

      {/* ── Selection toolbar ── */}
      {selectMode && (
        <div className="flex items-center gap-3 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-2xl px-5 py-3">
          <span className="text-sm font-semibold text-violet-700 dark:text-violet-300 flex-1">
            {selectedForDelete.size} of {filteredIdeas.length} {filteredIdeas.length === 1 ? 'idea' : 'ideas'} selected
          </span>
          <button
            onClick={allSelected ? deselectAll : selectAll}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition-colors"
          >
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
          <button
            onClick={handleDeleteSelected}
            disabled={selectedForDelete.size === 0 || deleting}
            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {deleting ? <RefreshCw size={12} className="animate-spin" /> : <Trash2 size={12} />}
            {deleting ? 'Deleting…' : `Delete${selectedForDelete.size > 0 ? ` (${selectedForDelete.size})` : ''}`}
          </button>
          <button
            onClick={exitSelectMode}
            disabled={deleting}
            className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X size={13} />
            Cancel
          </button>
        </div>
      )}

      {/* ── No company warning ── */}
      {!companyId && (
        <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-5 py-4 text-amber-700 dark:text-amber-300">
          <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
          <p className="text-sm">Set up your Company Blueprint first — Spark uses your company profile as context for idea generation.</p>
        </div>
      )}

      {/* ── Direction input ── */}
      <div className="relative">
        <Target size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-violet-400 pointer-events-none" />
        <input
          type="text"
          value={direction}
          onChange={e => setDirection(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !generating && companyId && !selectMode) inspire(); }}
          placeholder='Focus direction — e.g. "Quality management", "Predictive maintenance", "Supplier risk"  (optional)'
          disabled={generating || selectMode}
          className="w-full pl-9 pr-8 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-violet-400 transition-all disabled:opacity-50"
        />
        {direction && (
          <button onClick={() => setDirection('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
            <X size={14} />
          </button>
        )}
      </div>

      {/* ── Search + Filters + Refresh + Grid/List toolbar ── */}
      <div className="flex items-center gap-2">
        {/* Search */}
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search ideas…"
            className="w-full pl-9 pr-8 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-400 transition-all"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Filters toggle */}
        <button
          onClick={() => setContextOpen(o => !o)}
          className={`flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-sm font-semibold border transition-all flex-shrink-0 ${contextOpen || activeDimensions.size > 0
              ? 'bg-violet-600 text-white border-violet-600'
              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-violet-400 hover:text-violet-600 dark:hover:text-violet-400'
            }`}
        >
          <SlidersHorizontal size={15} />
          <span className="hidden sm:inline">Filters</span>
          {activeDimensions.size > 0 && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${contextOpen || activeDimensions.size > 0 ? 'bg-white/20 text-white' : 'bg-violet-100 text-violet-700'}`}>
              {activeDimensions.size}
            </span>
          )}
          {contextOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {/* Refresh */}
        <button
          onClick={refresh}
          disabled={loading || generating || !companyId}
          title="Refresh ideas from database"
          className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:border-violet-400 hover:text-violet-600 dark:hover:text-violet-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>

        {/* Count */}
        {!loading && !generating && hasLibrary && (
          <span className="text-xs text-slate-400 hidden sm:block flex-shrink-0 tabular-nums">
            {filteredIdeas.length} {filteredIdeas.length === 1 ? 'idea' : 'ideas'}
          </span>
        )}

        {/* Grid / List toggle */}
        <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 flex-shrink-0">
          <button
            onClick={() => setViewMode('grid')}
            title="Grid view"
            className={`p-1.5 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-white dark:bg-slate-700 text-violet-600 dark:text-violet-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            title="List view"
            className={`p-1.5 rounded-lg transition-all ${viewMode === 'list' ? 'bg-white dark:bg-slate-700 text-violet-600 dark:text-violet-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
          >
            <List size={16} />
          </button>
        </div>
      </div>

      {/* ── Context filters panel (collapsible) ── */}
      {contextOpen && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-5 py-4 flex flex-col gap-3">
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Select dimensions to focus Spark on — leave all off to scan everything.
          </p>
          <div className="flex flex-wrap gap-2">
            {SPARK_DIMENSIONS.map(({ key, label }) => {
              const active = activeDimensions.has(key);
              return (
                <button
                  key={key}
                  onClick={() => toggleDimension(key)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all ${active
                      ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-violet-400 hover:text-violet-600 dark:hover:text-violet-400'
                    }`}
                >
                  {label}
                </button>
              );
            })}
            {activeDimensions.size > 0 && (
              <button onClick={() => setActiveDimensions(new Set())} className="text-xs text-slate-400 hover:text-slate-600 underline">
                Clear all
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="flex items-start gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-5 py-4 text-red-600 dark:text-red-300">
          <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* ── Saved ideas strip ── */}
      {savedIdeas.length > 0 && (
        <div className="bg-violet-50 dark:bg-violet-900/10 border border-violet-200 dark:border-violet-800 rounded-2xl p-4">
          <p className="text-xs font-bold text-violet-700 dark:text-violet-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <BookmarkCheck size={14} /> Saved ideas ({savedIdeas.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {savedIdeas.map(idea => (
              <button
                key={idea.idea_id}
                onClick={() => setSelectedIdea(idea)}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-violet-200 dark:border-violet-700 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors"
              >
                {idea.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Loading skeleton ── */}
      {(loading || generating) && (
        viewMode === 'list' ? (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-pulse">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-slate-100 dark:border-slate-800 last:border-0">
                <div className="h-4 w-4 bg-slate-100 dark:bg-slate-800 rounded flex-shrink-0" />
                <div className="flex-1 flex flex-col gap-1.5">
                  <div className="h-3.5 bg-slate-100 dark:bg-slate-800 rounded w-1/2" />
                  <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded w-3/4" />
                </div>
                <div className="h-5 w-20 bg-slate-100 dark:bg-slate-800 rounded-full hidden sm:block" />
                <div className="h-5 w-16 bg-slate-100 dark:bg-slate-800 rounded-full hidden md:block" />
                <div className="h-5 w-14 bg-slate-100 dark:bg-slate-800 rounded hidden lg:block" />
                <div className="h-5 w-14 bg-slate-100 dark:bg-slate-800 rounded hidden lg:block" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-pulse">
                <div className="h-1.5 bg-slate-200 dark:bg-slate-700" />
                <div className="p-5 flex flex-col gap-3">
                  <div className="h-8 w-8 bg-slate-100 dark:bg-slate-800 rounded-xl" />
                  <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded w-3/4" />
                  <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded w-full" />
                  <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded w-5/6" />
                  <div className="flex gap-2">
                    <div className="h-5 w-20 bg-slate-100 dark:bg-slate-800 rounded-full" />
                    <div className="h-5 w-16 bg-slate-100 dark:bg-slate-800 rounded-full" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Idea board ── */}
      {!loading && !generating && filteredIdeas.length > 0 && (
        viewMode === 'list' ? (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            {/* List header */}
            <div className={`hidden lg:grid ${LIST_GRID} items-center gap-x-3 px-4 py-2 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-400 uppercase tracking-wider`}>
              <span />
              <span>Title</span>
              <span>Signal</span>
              <span>Dimensions</span>
              <span className="text-center">Complexity</span>
              <span className="text-center">Impact</span>
              <span />
            </div>
            {filteredIdeas.map(idea => (
              <IdeaListRow
                key={idea.idea_id}
                idea={idea}
                saved={savedIds.has(idea.idea_id)}
                onSave={() => toggleSave(idea.idea_id)}
                onClick={() => setSelectedIdea(idea)}
                selectMode={selectMode}
                selected={selectedForDelete.has(idea.idea_id)}
                onSelect={() => toggleSelect(idea.idea_id)}
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {filteredIdeas.map(idea => (
              <IdeaCard
                key={idea.idea_id}
                idea={idea}
                saved={savedIds.has(idea.idea_id)}
                onSave={() => toggleSave(idea.idea_id)}
                onClick={() => setSelectedIdea(idea)}
                selectMode={selectMode}
                selected={selectedForDelete.has(idea.idea_id)}
                onSelect={() => toggleSelect(idea.idea_id)}
              />
            ))}
          </div>
        )
      )}

      {/* ── Empty state: no library yet ── */}
      {!loading && !generating && !hasLibrary && companyId && (
        <div className="py-24 flex flex-col items-center justify-center gap-4 text-slate-400 bg-slate-50 dark:bg-slate-900 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700">
          <div className="p-5 bg-white dark:bg-slate-800 rounded-full shadow-sm">
            <Zap size={32} className="text-violet-300" />
          </div>
          <p className="font-semibold text-lg text-slate-500">No ideas yet</p>
          <p className="text-sm text-slate-400 text-center max-w-sm">
            Click <span className="font-bold text-violet-500">Inspire Me</span> to generate AI ideas from your company profile.
          </p>
        </div>
      )}

      {/* ── Empty state: filters or search returned nothing ── */}
      {!loading && !generating && hasLibrary && filteredIdeas.length === 0 && (
        <div className="py-16 flex flex-col items-center gap-3 text-slate-400">
          <Search size={28} className="text-slate-300" />
          {search
            ? <p className="text-sm">No ideas match &ldquo;{search}&rdquo;</p>
            : <p className="text-sm">No ideas match the selected dimension filters</p>
          }
          <div className="flex gap-3">
            {search && <button onClick={() => setSearch('')} className="text-xs text-violet-500 hover:underline">Clear search</button>}
            {activeDimensions.size > 0 && <button onClick={() => setActiveDimensions(new Set())} className="text-xs text-violet-500 hover:underline">Clear filters</button>}
          </div>
        </div>
      )}

      {/* ── Idea Detail Modal ── */}
      {selectedIdea && companyId && (
        <IdeaModal
          idea={selectedIdea}
          companyId={companyId}
          onClose={() => setSelectedIdea(null)}
        />
      )}
    </div>
  );
};

export default SparkPage;
