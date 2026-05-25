import { useState, useEffect } from 'react';

const SHOW_LOGS_KEY = 'tavro_show_logs';

/** Returns [showLogs, setShowLogs]. Syncs with localStorage. */
export function useShowLogs(): [boolean, (value: boolean) => void] {
    const [showLogs, setShowLogsState] = useState<boolean>(
        () => localStorage.getItem(SHOW_LOGS_KEY) === 'true'
    );

    const setShowLogs = (value: boolean) => {
        localStorage.setItem(SHOW_LOGS_KEY, value ? 'true' : 'false');
        setShowLogsState(value);
        window.dispatchEvent(new Event('tavro_settings_change'));
    };

    useEffect(() => {
        const sync = () => {
            setShowLogsState(localStorage.getItem(SHOW_LOGS_KEY) === 'true');
        };
        window.addEventListener('storage', sync);
        window.addEventListener('tavro_settings_change', sync);
        return () => {
            window.removeEventListener('storage', sync);
            window.removeEventListener('tavro_settings_change', sync);
        };
    }, []);

    return [showLogs, setShowLogs];
}
