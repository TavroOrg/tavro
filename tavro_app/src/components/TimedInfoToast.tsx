import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

type TimedInfoToastProps = {
    storageKey: string;
    durationMs?: number;
};

const TimedInfoToast: React.FC<TimedInfoToastProps> = ({ storageKey, durationMs = 8000 }) => {
    const [notice, setNotice] = useState<string | null>(null);
    const [isHovered, setIsHovered] = useState(false);
    const [remainingMs, setRemainingMs] = useState(durationMs);

    useEffect(() => {
        const message = sessionStorage.getItem(storageKey);
        if (!message) return;
        setNotice(message);
        setRemainingMs(durationMs);
        sessionStorage.removeItem(storageKey);
    }, [storageKey, durationMs]);

    useEffect(() => {
        if (!notice) return;
        if (!isHovered && remainingMs <= 0) {
            setNotice(null);
            return;
        }
        if (isHovered) return;

        const tickMs = 100;
        const timer = window.setInterval(() => {
            setRemainingMs(prev => Math.max(0, prev - tickMs));
        }, tickMs);

        return () => window.clearInterval(timer);
    }, [notice, isHovered, remainingMs]);

    if (!notice) return null;

    return createPortal(
        <div
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className="fixed bottom-6 z-[9999] max-w-sm w-[calc(100vw-3rem)] md:w-full rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-900/25 text-sky-800 dark:text-sky-200 shadow-lg px-4 py-3"
            style={{ right: 'calc(1.5rem + var(--tavro-right-rail-width, 72px))' }}
        >
            <div className="flex items-start gap-3">
                <Info size={16} className="mt-0.5 shrink-0" />
                <div className="w-full">
                    <span className="text-sm leading-relaxed block">{notice}</span>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-sky-700/80 dark:text-sky-300/80">
                        <span>{`Disappears in ${Math.ceil(remainingMs / 1000)}s`}</span>
                    </div>
                    <div className="mt-1 h-1 w-full rounded-full bg-sky-200/80 dark:bg-sky-800/80 overflow-hidden">
                        <div
                            className="h-full bg-sky-500 dark:bg-sky-400 transition-[width] duration-100 ease-linear"
                            style={{ width: `${(remainingMs / durationMs) * 100}%` }}
                        />
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default TimedInfoToast;
