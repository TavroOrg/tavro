import { useState, useEffect } from 'react';

const CACHE_MODE_KEY = 'tavro_cache_mode';

// Ensure the default is true on first load
if (localStorage.getItem(CACHE_MODE_KEY) === null) {
    localStorage.setItem(CACHE_MODE_KEY, 'true');
}

/** Returns [isCacheMode, setCacheMode]. Syncs with localStorage. */
export function useCacheMode(): [boolean, (value: boolean) => void] {
    const [cacheMode, setCacheModeState] = useState<boolean>(
        () => localStorage.getItem(CACHE_MODE_KEY) === 'true'
    );

    const setCacheMode = (value: boolean) => {
        localStorage.setItem(CACHE_MODE_KEY, value ? 'true' : 'false');
        setCacheModeState(value);
        window.dispatchEvent(new Event('tavro_settings_change'));
        // Refresh the page so all services pick up the new mode.
        window.location.reload();
    };

    useEffect(() => {
        const sync = () => {
            setCacheModeState(localStorage.getItem(CACHE_MODE_KEY) === 'true');
        };
        window.addEventListener('storage', sync);
        window.addEventListener('tavro_settings_change', sync);
        return () => {
            window.removeEventListener('storage', sync);
            window.removeEventListener('tavro_settings_change', sync);
        };
    }, []);

    return [cacheMode, setCacheMode];
}
