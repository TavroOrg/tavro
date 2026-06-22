import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

const BASE = import.meta.env.VITE_TWIN_API_URL ?? '';

interface EnterpriseContextValue {
  enterpriseEnabled: boolean;
}

const EnterpriseContext = createContext<EnterpriseContextValue>({
  enterpriseEnabled: false,
});

export function EnterpriseProvider({ children }: { children: ReactNode }) {
  const [enterpriseEnabled, setEnterpriseEnabled] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/api/v1/enterprise/status`)
      .then(res => res.json())
      .then(data => setEnterpriseEnabled(data.enabled === true))
      .catch(() => setEnterpriseEnabled(false));
  }, []);

  return (
    <EnterpriseContext.Provider value={{ enterpriseEnabled }}>
      {children}
    </EnterpriseContext.Provider>
  );
}

export function useEnterprise() {
  return useContext(EnterpriseContext);
}
