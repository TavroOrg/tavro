import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info, Paperclip, AlertTriangle, XCircle } from 'lucide-react';

type ToastVariant = 'info' | 'success' | 'warning' | 'error';

type TimedInfoToastProps = {
    storageKey: string;
    durationMs?: number;
    position?: 'bottom-right' | 'center';
};

type ToastState = {
    message: string;
    variant: ToastVariant;
};

const VARIANT_STYLES: Record<ToastVariant, { border: string; bg: string; text: string; subtext: string; bar: string; icon: React.ReactNode }> = {
    info: {
        border: 'border-sky-200 dark:border-sky-800',
        bg: 'bg-sky-50 dark:bg-sky-900/25',
        text: 'text-sky-800 dark:text-sky-200',
        subtext: 'text-sky-700/80 dark:text-sky-300/80',
        bar: 'bg-sky-500 dark:bg-sky-400',
        icon: <Info size={16} className="mt-0.5 shrink-0" />,
    },
    success: {
        border: 'border-emerald-200',
        bg: 'bg-emerald-50',
        text: 'text-emerald-800',
        subtext: 'text-emerald-600',
        bar: 'bg-emerald-500',
        icon: <Paperclip size={16} className="mt-0.5 shrink-0 text-emerald-600" />,
    },
    warning: {
        border: 'border-amber-200 dark:border-amber-700',
        bg: 'bg-amber-50 dark:bg-amber-900/25',
        text: 'text-amber-800 dark:text-amber-200',
        subtext: 'text-amber-700/80 dark:text-amber-300/80',
        bar: 'bg-amber-500',
        icon: <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />,
    },
    error: {
        border: 'border-red-200 dark:border-red-800',
        bg: 'bg-red-50 dark:bg-red-900/20',
        text: 'text-red-800 dark:text-red-200',
        subtext: 'text-red-700/80 dark:text-red-300/80',
        bar: 'bg-red-500',
        icon: <XCircle size={16} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />,
    },
};

const TimedInfoToast: React.FC<TimedInfoToastProps> = ({
    storageKey,
    durationMs = 8000,
    position = 'bottom-right',
}) => {
    const [toast, setToast] = useState<ToastState | null>(null);
    const [isHovered, setIsHovered] = useState(false);
    const [remainingMs, setRemainingMs] = useState(durationMs);

    useEffect(() => {
        const message = sessionStorage.getItem(storageKey);
        if (!message) return;
        setToast({ message, variant: 'info' });
        setRemainingMs(durationMs);
        sessionStorage.removeItem(storageKey);
    }, [storageKey, durationMs]);

    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<{ key?: string; message?: string; variant?: ToastVariant }>).detail;
            if (!detail?.message) return;
            if (detail.key && detail.key !== storageKey) return;
            setToast({ message: detail.message, variant: detail.variant ?? 'info' });
            setRemainingMs(durationMs);
        };
        window.addEventListener('tavro_notice', handler);
        return () => window.removeEventListener('tavro_notice', handler);
    }, [storageKey, durationMs]);

    useEffect(() => {
        if (!toast) return;
        if (!isHovered && remainingMs <= 0) {
            setToast(null);
            return;
        }
        if (isHovered) return;

        const tickMs = 100;
        const timer = window.setInterval(() => {
            setRemainingMs(prev => Math.max(0, prev - tickMs));
        }, tickMs);

        return () => window.clearInterval(timer);
    }, [toast, isHovered, remainingMs]);

    if (!toast) return null;

    const isCenter = position === 'center';
    const variant: ToastVariant = isCenter ? 'success' : (toast.variant ?? 'info');
    const styles = VARIANT_STYLES[variant];

    return createPortal(
        <div
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className={`fixed z-[9999] ${
                isCenter
                    ? 'top-8 left-1/2 -translate-x-1/2 w-auto min-w-[320px] max-w-lg'
                    : 'bottom-6 max-w-sm w-[calc(100vw-3rem)] md:w-full'
            } rounded-xl border shadow-xl px-5 py-4 ${styles.border} ${styles.bg} ${styles.text}`}
            style={!isCenter ? { right: 'calc(1.5rem + var(--tavro-right-rail-width, 72px))' } : undefined}
            role="status"
            aria-live="polite"
        >
            <div className="flex items-start gap-3">
                {styles.icon}
                <div className="w-full">
                    <span className={`text-sm font-medium leading-relaxed block`}>
                        {toast.message}
                    </span>
                    <div className={`mt-2 flex items-center justify-between text-[11px] ${styles.subtext}`}>
                        <span>{`Disappears in ${Math.ceil(remainingMs / 1000)}s`}</span>
                    </div>
                    <div className={`mt-1 h-1 w-full rounded-full overflow-hidden ${
                        variant === 'error' ? 'bg-red-200/80 dark:bg-red-800/80' :
                        variant === 'warning' ? 'bg-amber-200/80 dark:bg-amber-800/80' :
                        variant === 'success' ? 'bg-emerald-200' :
                        'bg-sky-200/80 dark:bg-sky-800/80'
                    }`}>
                        <div
                            className={`h-full transition-[width] duration-100 ease-linear ${styles.bar}`}
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
