import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
    children: React.ReactNode;
    fallback?: React.ReactNode;
}

interface State {
    hasError: boolean;
    message: string;
}

class ErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, message: '' };
    }

    static getDerivedStateFromError(error: unknown): State {
        const message =
            error instanceof Error
                ? error.message
                : 'An unexpected error occurred.';
        return { hasError: true, message };
    }

    componentDidCatch(error: unknown, info: React.ErrorInfo) {
        console.error('[ErrorBoundary] Uncaught render error:', error, info.componentStack);
    }

    handleReset = () => {
        this.setState({ hasError: false, message: '' });
    };

    render() {
        if (!this.state.hasError) return this.props.children;

        if (this.props.fallback) return this.props.fallback;

        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
                <div className="max-w-md w-full text-center">
                    <div className="flex justify-center mb-4">
                        <div className="rounded-full bg-red-900/30 p-4">
                            <AlertTriangle size={32} className="text-red-400" />
                        </div>
                    </div>
                    <h1 className="text-xl font-semibold text-slate-100 mb-2">
                        Something went wrong
                    </h1>
                    <p className="text-sm text-slate-400 mb-6">
                        {this.state.message || 'An unexpected error occurred. Please try refreshing the page.'}
                    </p>
                    <div className="flex justify-center gap-3">
                        <button
                            onClick={this.handleReset}
                            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-950"
                        >
                            <RefreshCw size={14} />
                            Try Again
                        </button>
                        <button
                            onClick={() => window.location.reload()}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 focus:ring-offset-slate-950"
                        >
                            Reload Page
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}

export default ErrorBoundary;
