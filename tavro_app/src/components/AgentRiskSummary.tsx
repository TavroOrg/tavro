import React, { useEffect, useState } from 'react';
import { mcpClient } from '../services/mcpClient';
import { ShieldCheck, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, RefreshCw, ShieldOff } from 'lucide-react';

interface AgentRiskSummaryProps {
    agentId: string;
}

interface RiskSummaryData {
    agent_id: string;
    agent_name: string;
    risk_summary: string;
}

function normalizeRiskSummaryPayload(payload: any, fallbackAgentId: string): RiskSummaryData | null {
    if (!payload) return null;
    if (typeof payload === 'string') {
        const trimmed = payload.trim();
        if (!trimmed) return null;
        return {
            agent_id: fallbackAgentId,
            agent_name: fallbackAgentId,
            risk_summary: trimmed,
        };
    }

    const riskSummary =
        payload.risk_summary ??
        payload.summary ??
        payload.html ??
        payload.content ??
        payload.result?.risk_summary ??
        '';

    if (!riskSummary || typeof riskSummary !== 'string') return null;

    return {
        agent_id: String(payload.agent_id ?? fallbackAgentId),
        agent_name: String(payload.agent_name ?? payload.name ?? fallbackAgentId),
        risk_summary: riskSummary,
    };
}

function extractHeadline(html: string): { level: string; aivss: string } {
    if (!html) return { level: 'Unknown', aivss: 'N/A' };

    const levelMatch =
        html.match(/<b[^>]*>'?([^'<]+Risk[^'<]*)'?<\/b>/i) ??
        html.match(/Risk Classification\s*:\s*(Prohibited|High Risk|Other|Low Risk|Medium Risk)/i) ??
        html.match(/designated as ['"]?(Prohibited|High Risk|Other|Low Risk|Medium Risk)['"]?/i);
    const level = levelMatch?.[1]?.trim() ?? 'Unknown';

    const aivssMatch = html.match(/AIVSS score of\s*<b[^>]*>([\d.]+\/\d+)<\/b>/i)
        ?? html.match(/AIVSS score of\s*([\d.]+\/\d+)/i)
        ?? html.match(/AIVSS Score[^:]*:\s*([\d.]+(?:\/\d+)?)/i);
    const aivss = aivssMatch?.[1] ?? 'N/A';

    return { level, aivss };
}

function riskColor(level: string) {
    const l = level.toLowerCase();
    if (l.includes('prohibited')) return { badge: 'bg-red-100 text-red-700 border-red-200', icon: 'text-red-600', bar: 'bg-red-500' };
    if (l.includes('high')) return { badge: 'bg-red-100 text-red-700 border-red-200', icon: 'text-red-600', bar: 'bg-red-500' };
    if (l.includes('medium') || l.includes('moderate')) return { badge: 'bg-amber-100 text-amber-700 border-amber-200', icon: 'text-amber-500', bar: 'bg-amber-500' };
    return { badge: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: 'text-emerald-600', bar: 'bg-emerald-500' };
}

const AgentRiskSummary: React.FC<AgentRiskSummaryProps> = ({ agentId }) => {
    const [data, setData] = useState<RiskSummaryData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [noAssessment, setNoAssessment] = useState(false);

    useEffect(() => {
        let cancelled = false;

        const start = async () => {
            setLoading(true);
            setError(null);
            setData(null);
            setExpanded(false);
            setNoAssessment(false);

            try {
                const res = await mcpClient.getAgentRiskSummary(agentId);
                if (cancelled) return;
                const normalized = normalizeRiskSummaryPayload(res, agentId);
                if (normalized) {
                    setData(normalized);
                } else {
                    setNoAssessment(true);
                }
            } catch {
                if (!cancelled) setNoAssessment(true);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        start();

        return () => { cancelled = true; };
    }, [agentId]);

    const headline = data ? extractHeadline(data.risk_summary) : null;
    const colors = headline ? riskColor(headline.level) : riskColor('');
    const RiskIcon = headline?.level.toLowerCase().includes('high')
        ? AlertTriangle
        : headline?.level.toLowerCase().includes('medium')
            ? AlertTriangle
            : CheckCircle2;

    return (
        <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
                <div className={`p-2 rounded-lg ${colors.badge.includes('red') ? 'bg-red-50' : colors.badge.includes('amber') ? 'bg-amber-50' : 'bg-emerald-50'}`}>
                    <ShieldCheck size={18} className={colors.icon} />
                </div>
                <div className="flex-1">
                    <h2 className="text-sm font-bold text-slate-800">AI Risk Assessment</h2>
                    <p className="text-xs text-slate-400">EU AI Act | OWASP AIVSS</p>
                </div>
            </div>

            <div className="p-5">
                {loading && (
                    <div className="flex items-center gap-2 text-slate-400 text-sm">
                        <RefreshCw size={14} className="animate-spin" /> Checking for risk assessment...
                    </div>
                )}

                {!loading && noAssessment && (
                    <div className="flex flex-col items-center gap-3 py-6 text-center">
                        <div className="p-3 bg-slate-100 rounded-xl">
                            <ShieldOff size={22} className="text-slate-400" />
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-slate-700">No risk assessment found</p>
                            <p className="text-xs text-slate-400 mt-1">Use the <span className="font-medium text-slate-500">Risk Assessment</span> button above to initiate one.</p>
                        </div>
                    </div>
                )}

                {error && !loading && (
                    <div className="text-xs text-slate-500 italic bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                        {error}
                    </div>
                )}

                {!loading && !error && data && headline && (
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center gap-4">
                            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border ${colors.badge}`}>
                                <RiskIcon size={13} />
                                {headline.level}
                            </div>
                            <div className="flex flex-col">
                                <span className="text-xs text-slate-400 font-medium">AIVSS Score</span>
                                <span className="text-sm font-bold text-slate-800">{headline.aivss}</span>
                            </div>
                            {headline.aivss !== 'N/A' && (() => {
                                const score = parseFloat(headline.aivss);
                                const max = headline.aivss.includes('/') ? (parseFloat(headline.aivss.split('/')[1]) || 10) : 10;
                                const pct = Number.isFinite(score) ? Math.round((score / max) * 100) : 0;
                                return (
                                    <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                                        <div className={`h-full rounded-full ${colors.bar}`} style={{ width: `${pct}%` }} />
                                    </div>
                                );
                            })()}
                        </div>

                        <button
                            onClick={() => setExpanded(e => !e)}
                            className="flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-700 self-start transition-colors"
                        >
                            {expanded ? <><ChevronUp size={13} /> Hide full report</> : <><ChevronDown size={13} /> View full report</>}
                        </button>

                        {expanded && (() => {
                            const report = data.risk_summary || '';
                            const looksLikeHtml = /<\s*(h\d|p|div|table|tr|td|th|ul|ol|li|b|strong|br)\b/i.test(report);
                            if (looksLikeHtml) {
                                return (
                                    <div
                                        className="mt-1 text-xs text-slate-700 leading-relaxed border-t border-slate-100 pt-4
                                                   [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-slate-800 [&_h2]:mb-2
                                                   [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-slate-700 [&_h3]:mt-4 [&_h3]:mb-1
                                                   [&_b]:font-semibold [&_b]:text-slate-800
                                                   [&_table]:w-full [&_table]:text-left [&_table]:text-xs [&_table]:border-collapse
                                                   [&_th]:bg-slate-100 [&_th]:px-3 [&_th]:py-2 [&_th]:font-bold [&_th]:text-slate-600 [&_th]:border [&_th]:border-slate-200
                                                   [&_td]:px-3 [&_td]:py-2 [&_td]:border [&_td]:border-slate-100 [&_td]:align-top [&_td]:leading-snug
                                                   [&_tr:hover_td]:bg-slate-50
                                                   max-h-[500px] overflow-y-auto custom-scrollbar"
                                        dangerouslySetInnerHTML={{ __html: report }}
                                    />
                                );
                            }
                            return (
                                <pre
                                    className="mt-1 border-t border-slate-100 pt-4 bg-slate-50 text-slate-700 rounded-lg p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words max-h-[500px] overflow-y-auto"
                                >
                                    {report}
                                </pre>
                            );
                        })()}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AgentRiskSummary;
