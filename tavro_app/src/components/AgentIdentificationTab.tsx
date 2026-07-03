import React, { useEffect, useRef, useState } from 'react';
import { AgentData } from '../types/agent';
import { User, Tag, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

type AgentInlineField = 'name' | 'description' | 'instruction';

// Some connectors (e.g. Microsoft 365) store descriptions as raw HTML markup.
// Strip tags and decode entities for clean plain-text display.
const stripHtml = (html?: string | null): string => {
    if (!html) return '';
    const withoutTags = html.replace(/<[^>]*>/g, ' ');
    const el = document.createElement('textarea');
    el.innerHTML = withoutTags;
    return el.value.replace(/\s+/g, ' ').trim();
};

interface AgentIdentificationTabProps {
    agent: AgentData;
    isEditing?: boolean;
    editDescription?: string;
    onEditDescriptionChange?: (v: string) => void;
    editInstruction?: string;
    onEditInstructionChange?: (v: string) => void;
    inlineEdit?: { field: AgentInlineField; value: string } | null;
    inlineSaving?: AgentInlineField | null;
    onStartInlineEdit?: (field: AgentInlineField) => void;
    onInlineValueChange?: (value: string) => void;
    onSaveInlineEdit?: () => void;
    onCancelInlineEdit?: () => void;
}

export const AgentIdentificationTab: React.FC<AgentIdentificationTabProps> = ({
    agent, isEditing,
    editDescription, onEditDescriptionChange,
    editInstruction, onEditInstructionChange,
    inlineEdit, inlineSaving, onStartInlineEdit,
    onInlineValueChange, onSaveInlineEdit, onCancelInlineEdit,
}) => {
    const [instrOpen, setInstrOpen] = useState(false);
    const [instrOverflow, setInstrOverflow] = useState(false);
    const instructionContainerRef = useRef<HTMLDivElement | null>(null);
    const id = agent.identification;
    const COLLAPSED_MAX_HEIGHT_PX = 128; // max-h-32
    const isInlineDescription = inlineEdit?.field === 'description';
    const isInlineInstruction = inlineEdit?.field === 'instruction';

    const renderInlineActions = (field: AgentInlineField) => {
        const isSaving = inlineSaving === field;
        const isBlank = !inlineEdit?.value.trim();
        const saveDisabled = isSaving || isBlank;

        return (
            <div className="flex shrink-0 gap-1">
                <button
                    type="button"
                    onClick={onSaveInlineEdit}
                    disabled={saveDisabled}
                    title={isBlank ? 'This field is required' : 'Save'}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-blue-600 text-xs font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                >
                    {isSaving ? <Loader2 size={14} className="animate-spin" /> : '✓'}
                </button>
                <button
                    type="button"
                    onClick={onCancelInlineEdit}
                    disabled={isSaving}
                    title="Cancel"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-slate-200 bg-white text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                    ✕
                </button>
            </div>
        );
    };

    useEffect(() => {
        const node = instructionContainerRef.current;
        if (!node) return;
        setInstrOpen(false);
        setInstrOverflow(node.scrollHeight > COLLAPSED_MAX_HEIGHT_PX + 1);
    }, [id?.instruction]);

    return (
        <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden p-6 flex flex-col gap-6 w-full">
            <div>
                <h3 className="text-sm font-bold text-slate-800 tracking-tight flex items-center gap-2 mb-4">
                    <User size={16} className="text-blue-500" />
                    Identification & Role
                </h3>

                {isEditing ? (
                    <textarea
                        value={editDescription ?? stripHtml(agent.description) ?? ''}
                        onChange={e => onEditDescriptionChange?.(e.target.value)}
                        rows={6}
                        className="w-full text-sm text-slate-600 leading-relaxed border-l-2 border-blue-400 pl-4 py-1 mb-4 bg-blue-50/40 outline-none resize-none rounded-r-lg"
                    />
                ) : isInlineDescription && inlineEdit ? (
                    <div className="flex items-start gap-2 mb-4">
                        <textarea
                            value={stripHtml(inlineEdit.value)}
                            onChange={e => onInlineValueChange?.(e.target.value)}
                            rows={6}
                            className="w-full text-sm text-slate-600 leading-relaxed border-l-2 border-blue-400 pl-4 py-1 bg-blue-50/40 outline-none resize-none rounded-r-lg"
                            autoFocus
                        />
                        {renderInlineActions('description')}
                    </div>
                ) : (
                    <p
                        onDoubleClick={() => onStartInlineEdit?.('description')}
                        title="Double-click to edit"
                        className="text-sm text-slate-600 leading-relaxed border-l-2 border-blue-200 pl-4 py-1 mb-4 cursor-text rounded-r-lg hover:bg-blue-50/40 transition-colors"
                    >
                        {stripHtml(agent.description) || '-'}
                    </p>
                )}

                {(id?.owner || id?.tags) && (
                    <div className="flex flex-wrap gap-2 mb-4">
                        {id?.owner && (
                            <span className="flex items-center gap-1.5 text-xs bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-full font-medium text-slate-600">
                                <User size={10} /> {id.owner}
                            </span>
                        )}
                        {id?.tags && String(id.tags).split(',').map(t => t.trim()).filter(Boolean).map(t => (
                            <span key={t} className="flex items-center gap-1 text-xs bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-full font-medium text-indigo-600">
                                <Tag size={10} /> {t}
                            </span>
                        ))}
                    </div>
                )}

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 shadow-inner flex flex-col gap-4">
                    <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Assigned Role</span>
                        <span className="text-sm font-medium text-slate-800">{id?.role || '-'}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">System Instruction</span>
                            {instrOverflow && !isInlineInstruction && (
                                <button
                                    onClick={() => setInstrOpen(o => !o)}
                                    className="text-[10px] font-semibold text-blue-500 hover:text-blue-700 flex items-center gap-1"
                                >
                                    {instrOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />} {instrOpen ? 'Collapse' : 'Expand'}
                                </button>
                            )}
                        </div>
                        {isEditing ? (
                            <textarea
                                value={editInstruction ?? id?.instruction ?? ''}
                                onChange={e => onEditInstructionChange?.(e.target.value)}
                                rows={8}
                                className="w-full text-xs font-mono text-slate-600 leading-relaxed bg-white border border-blue-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400/20 resize-none mt-1"
                            />
                        ) : isInlineInstruction && inlineEdit ? (
                            <div className="flex items-start gap-2 mt-1">
                                <textarea
                                    value={inlineEdit.value}
                                    onChange={e => onInlineValueChange?.(e.target.value)}
                                    rows={8}
                                    className="w-full text-xs font-mono text-slate-600 leading-relaxed bg-white border border-blue-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400/20 resize-none"
                                    autoFocus
                                />
                                {renderInlineActions('instruction')}
                            </div>
                        ) : (
                            <div
                                ref={instructionContainerRef}
                                onDoubleClick={() => onStartInlineEdit?.('instruction')}
                                title="Double-click to edit"
                                className={`overflow-hidden transition-all duration-300 ease-in-out ${instrOverflow ? (instrOpen ? 'max-h-[2500px]' : 'max-h-32') : 'max-h-none'} overflow-y-auto pr-1`}
                            >
                                <pre className="text-xs font-mono text-slate-600 whitespace-pre-wrap leading-relaxed cursor-text rounded-lg hover:bg-blue-50/50 transition-colors">
                                    {id?.instruction || '-'}
                                </pre>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AgentIdentificationTab;
