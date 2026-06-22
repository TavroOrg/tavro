import { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { useEnterprise } from '../context/EnterpriseContext';

interface Props {
  children: ReactNode;
}

export default function EnterpriseGate({ children }: Props) {
  const { enterpriseEnabled } = useEnterprise();

  if (enterpriseEnabled) return <>{children}</>;

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-4 text-center px-6">
      <div className="flex items-center justify-center w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800">
        <Lock size={24} className="text-slate-400 dark:text-slate-500" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold text-slate-700 dark:text-slate-200">
          Enterprise feature
        </p>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm">
          This feature is not available on your current plan.
          Contact your administrator to enable Tavro Enterprise.
        </p>
      </div>
      <span className="text-xs font-medium text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full">
        402 · Feature not available
      </span>
    </div>
  );
}
