import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info, Paperclip } from 'lucide-react';

type TimedInfoToastProps = {
    storageKey: string;
    durationMs?: number;
    position?: 'bottom-right' | 'center';
};

const TimedInfoToast: React.FC<TimedInfoToastProps> = ({
    storageKey,
    durationMs = 8000,
    position = 'bottom-right',
}) => {
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
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<{ key?: string; message?: string }>).detail;
            if (!detail?.message) return;
            if (detail.key && detail.key !== storageKey) return;
            setNotice(detail.message);
            setRemainingMs(durationMs);
        };
        window.addEventListener('tavro_notice', handler);
        return () => window.removeEventListener('tavro_notice', handler);
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

    const isCenter = position === 'center';

    return createPortal(
        <div
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className={`fixed z-[9999] ${
                isCenter
                    ? 'top-8 left-1/2 -translate-x-1/2 w-auto min-w-[320px] max-w-lg'
                    : 'bottom-6 max-w-sm w-[calc(100vw-3rem)] md:w-full'
            } rounded-xl border shadow-xl px-5 py-4 ${
                isCenter
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-900/25 text-sky-800 dark:text-sky-200'
            }`}
            style={!isCenter ? { right: 'calc(1.5rem + var(--tavro-right-rail-width, 72px))' } : undefined}
        >
            <div className="flex items-start gap-3">
                {isCenter
                    ? <Paperclip size={16} className="mt-0.5 shrink-0 text-emerald-600" />
                    : <Info size={16} className="mt-0.5 shrink-0" />
                }
                <div className="w-full">
                    <span className={`text-sm font-medium leading-relaxed block ${isCenter ? 'text-emerald-900' : ''}`}>
                        {notice}
                    </span>
                    <div className={`mt-2 flex items-center justify-between text-[11px] ${isCenter ? 'text-emerald-600' : 'text-sky-700/80 dark:text-sky-300/80'}`}>
                        <span>{`Disappears in ${Math.ceil(remainingMs / 1000)}s`}</span>
                    </div>
                    <div className={`mt-1 h-1 w-full rounded-full overflow-hidden ${isCenter ? 'bg-emerald-200' : 'bg-sky-200/80 dark:bg-sky-800/80'}`}>
                        <div
                            className={`h-full transition-[width] duration-100 ease-linear ${isCenter ? 'bg-emerald-500' : 'bg-sky-500 dark:bg-sky-400'}`}
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
