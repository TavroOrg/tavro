import { useState, useEffect } from 'react';

const INSPECT_JSON_KEY = 'tavro_inspect_json';

/** Returns [inspectJson, setInspectJson]. Syncs with localStorage. */
export function useInspectJson(): [boolean, (value: boolean) => void] {
    const [inspectJson, setInspectJsonState] = useState<boolean>(
        () => localStorage.getItem(INSPECT_JSON_KEY) === 'true'
    );

    const setInspectJson = (value: boolean) => {
        localStorage.setItem(INSPECT_JSON_KEY, value ? 'true' : 'false');
        setInspectJsonState(value);
        window.dispatchEvent(new Event('tavro_settings_change'));
    };

    useEffect(() => {
        const sync = () => {
            setInspectJsonState(localStorage.getItem(INSPECT_JSON_KEY) === 'true');
        };
        window.addEventListener('storage', sync);
        window.addEventListener('tavro_settings_change', sync);
        return () => {
            window.removeEventListener('storage', sync);
            window.removeEventListener('tavro_settings_change', sync);
        };
    }, []);

    return [inspectJson, setInspectJson];
}
