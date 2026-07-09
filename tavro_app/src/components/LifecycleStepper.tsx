import React from 'react';
import { Check, AlertTriangle } from 'lucide-react';

interface LifecycleStepperProps {
    stages: string[];
    currentStage?: string | null;
    onStageChange?: (stage: string) => void;
    disabled?: boolean;
}

const LifecycleStepper: React.FC<LifecycleStepperProps> = ({ stages, currentStage, onStageChange, disabled }) => {
    const matchedIndex = stages.findIndex(s => s.toLowerCase() === (currentStage ?? '').toLowerCase());
    const isUnrecognized = !!currentStage && matchedIndex === -1;
    const currentIndex = matchedIndex === -1 ? -1 : matchedIndex;

    return (
        <div className="flex items-center w-full">
            {isUnrecognized && (
                <span
                    title={`Unrecognized status "${currentStage}" — not one of the known lifecycle stages`}
                    className="mr-2 shrink-0 text-amber-500"
                >
                    <AlertTriangle size={14} />
                </span>
            )}
            {stages.map((stage, i) => {
                const isCompleted = !isUnrecognized && i < currentIndex;
                const isCurrent = !isUnrecognized && i === currentIndex;
                const clickable = !disabled && !!onStageChange && !isCurrent;

                return (
                    <React.Fragment key={stage}>
                        {i > 0 && (
                            <div
                                className={`flex-1 h-0.5 min-w-[16px] ${i <= currentIndex ? 'bg-blue-600' : 'bg-slate-300'}`}
                            />
                        )}
                        <button
                            type="button"
                            disabled={!clickable}
                            onClick={() => clickable && onStageChange?.(stage)}
                            title={clickable ? `Move to ${stage}` : stage}
                            className={`flex flex-col items-center gap-1.5 shrink-0 ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
                        >
                            <span
                                className={`flex items-center justify-center w-8 h-8 rounded-full border-2 text-xs font-bold shrink-0 transition-colors ${
                                    isCompleted
                                        ? 'bg-white border-emerald-600 text-emerald-600'
                                        : isCurrent
                                            ? 'bg-blue-600 border-blue-600 text-white'
                                            : 'bg-white border-slate-400 text-slate-600'
                                }`}
                            >
                                {isCompleted ? <Check size={16} /> : i + 1}
                            </span>
                            <span
                                className={`text-[11px] font-bold whitespace-nowrap ${
                                    isCurrent ? 'text-blue-600' : isCompleted ? 'text-emerald-600' : 'text-slate-600'
                                }`}
                            >
                                {stage}
                            </span>
                        </button>
                    </React.Fragment>
                );
            })}
        </div>
    );
};

export default LifecycleStepper;
