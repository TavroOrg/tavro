import React, { useEffect } from 'react';
import { Library, ClipboardList, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useChatContext } from '../context/ChatContext';
import travoLogo from '../assets/travo_logo.png';

const HomePage: React.FC = () => {
    const navigate = useNavigate();
    const { setViewContext } = useChatContext();

    useEffect(() => {
        setViewContext('home');
    }, [setViewContext]);

    return (
        <div className="flex flex-col items-center justify-center min-h-[80vh] animate-fade-in px-4">
            <div className="bg-white dark:bg-slate-900 p-8 md:p-12 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm max-w-3xl w-full text-center transition-colors">
                <div className="mx-auto w-20 h-20 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200 dark:shadow-blue-900/20 mb-6 bg-white">
                    <img src={travoLogo} alt="Tavro" className="w-16 h-16 object-contain" />
                </div>
                
                <h1 className="text-3xl md:text-4xl font-bold text-slate-800 dark:text-white tracking-tight mb-4">
                    Welcome to <span className="text-blue-600 dark:text-blue-400">Tavro Agent BizOps</span>
                </h1>
                
                <p className="text-slate-500 dark:text-slate-400 text-lg max-w-xl mx-auto mb-10 leading-relaxed">
                    Your command center for Agent Business Operations. Get started by exploring your catalog of agents or reviewing AI use cases.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl mx-auto">
                    <button
                        onClick={() => navigate('/use-cases')}
                        className="flex flex-col items-center gap-3 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:border-blue-200 dark:hover:border-blue-800 transition-all group"
                    >
                        <div className="p-3 bg-white dark:bg-slate-800 rounded-xl shadow-sm group-hover:scale-110 transition-transform">
                            <ClipboardList size={24} className="text-blue-600 dark:text-blue-400" />
                        </div>
                        <div className="text-center">
                            <h3 className="font-bold text-slate-800 dark:text-slate-200">AI Use Cases</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Review and manage proposed AI implementations</p>
                        </div>
                    </button>

                    <button
                        onClick={() => navigate('/catalog')}
                        className="flex flex-col items-center gap-3 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:border-blue-200 dark:hover:border-blue-800 transition-all group"
                    >
                        <div className="p-3 bg-white dark:bg-slate-800 rounded-xl shadow-sm group-hover:scale-110 transition-transform">
                            <Library size={24} className="text-blue-600 dark:text-blue-400" />
                        </div>
                        <div className="text-center">
                            <h3 className="font-bold text-slate-800 dark:text-slate-200">Agents</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Explore your registered AI agents catalog</p>
                        </div>
                    </button>

                    <button
                        onClick={() => navigate('/insights')}
                        className="flex flex-col items-center gap-3 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:border-blue-200 dark:hover:border-blue-800 transition-all group"
                    >
                        <div className="p-3 bg-white dark:bg-slate-800 rounded-xl shadow-sm group-hover:scale-110 transition-transform">
                            <Zap size={24} className="text-blue-600 dark:text-blue-400" />
                        </div>
                        <div className="text-center">
                            <h3 className="font-bold text-slate-800 dark:text-slate-200">Insights</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">View analytics and executive risk summaries</p>
                        </div>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default HomePage;
