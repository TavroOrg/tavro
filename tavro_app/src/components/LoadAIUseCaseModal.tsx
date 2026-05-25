import React, { useCallback, useRef, useState } from 'react';
import { Upload, X, FileJson, AlertCircle, CheckCircle2, Loader2, Trash2 } from 'lucide-react';
import { useCaseApi } from '../services/useCaseApi';

interface LoadAIUseCaseModalProps {
    onClose: () => void;
    onSuccess: () => void;
}

interface FileEntry {
    file: File;
    error?: string;
}

const LoadAIUseCaseModal: React.FC<LoadAIUseCaseModalProps> = ({ onClose, onSuccess }) => {
    const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
    const [uploading, setUploading] = useState(false);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const validateAndAddFiles = useCallback((incoming: FileList | File[]) => {
        const newEntries: FileEntry[] = [];
        Array.from(incoming).forEach(file => {
            if (!file.name.toLowerCase().endsWith('.json')) {
                newEntries.push({ file, error: 'Only .json files are accepted' });
            } else {
                newEntries.push({ file });
            }
        });
        setFileEntries(prev => {
            const existingNames = new Set(prev.map(e => e.file.name));
            const deduped = newEntries.filter(e => !existingNames.has(e.file.name));
            return [...prev, ...deduped];
        });
    }, []);

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            validateAndAddFiles(e.target.files);
            e.target.value = '';
        }
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            validateAndAddFiles(e.dataTransfer.files);
        }
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
    };

    const removeFile = (index: number) => {
        setFileEntries(prev => prev.filter((_, i) => i !== index));
    };

    const validFiles = fileEntries.filter(e => !e.error).map(e => e.file);
    const hasErrors = fileEntries.some(e => !!e.error);

    const handleUpload = async () => {
        if (validFiles.length === 0) return;

        setUploading(true);
        setErrorMessage(null);
        setSuccessMessage(null);

        try {
            const result = await useCaseApi.uploadUseCases(validFiles);
            setSuccessMessage(result.message);
            setFileEntries([]);
            onSuccess();
        } catch (err: any) {
            setErrorMessage(err?.message ?? 'Upload failed. Please try again.');
        } finally {
            setUploading(false);
        }
    };

    const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget && !uploading) onClose();
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={handleBackdropClick}
        >
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl">
                            <Upload size={18} />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">Load AI Use Case</h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Upload AI Use Case JSON files to the catalog</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={uploading}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all disabled:opacity-40"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 flex flex-col gap-4">
                    {successMessage && (
                        <div className="flex items-start gap-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl px-4 py-3">
                            <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{successMessage}</p>
                        </div>
                    )}

                    {errorMessage && (
                        <div className="flex items-start gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3">
                            <AlertCircle size={18} className="text-red-500 mt-0.5 shrink-0" />
                            <p className="text-sm font-medium text-red-700 dark:text-red-300">{errorMessage}</p>
                        </div>
                    )}

                    {!successMessage && (
                        <div
                            onDrop={handleDrop}
                            onDragOver={handleDragOver}
                            onClick={() => fileInputRef.current?.click()}
                            className="relative flex flex-col items-center justify-center gap-3 p-8 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:border-blue-400 dark:hover:border-blue-600 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all cursor-pointer group"
                        >
                            <div className="p-3 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 group-hover:border-blue-300 dark:group-hover:border-blue-700 transition-colors">
                                <FileJson size={28} className="text-slate-400 dark:text-slate-500 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors" />
                            </div>
                            <div className="text-center">
                                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                                    Drop JSON files here or <span className="text-blue-600 dark:text-blue-400">browse</span>
                                </p>
                                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                                    Single or multiple <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded text-[10px]">.json</code> files · Each file may contain one or many use cases
                                </p>
                            </div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                multiple
                                accept=".json,application/json"
                                className="hidden"
                                onChange={handleFileInputChange}
                            />
                        </div>
                    )}

                    {fileEntries.length > 0 && !successMessage && (
                        <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
                            {fileEntries.map((entry, i) => (
                                <div
                                    key={`${entry.file.name}-${i}`}
                                    className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-sm ${
                                        entry.error
                                            ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                                            : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'
                                    }`}
                                >
                                    <FileJson
                                        size={15}
                                        className={entry.error ? 'text-red-400 shrink-0' : 'text-blue-500 dark:text-blue-400 shrink-0'}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <span className={`font-medium truncate block ${entry.error ? 'text-red-700 dark:text-red-300' : 'text-slate-700 dark:text-slate-200'}`}>
                                            {entry.file.name}
                                        </span>
                                        {entry.error && (
                                            <span className="text-[10px] text-red-500 dark:text-red-400">{entry.error}</span>
                                        )}
                                    </div>
                                    <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
                                        {(entry.file.size / 1024).toFixed(1)} KB
                                    </span>
                                    <button
                                        onClick={() => removeFile(i)}
                                        disabled={uploading}
                                        className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all disabled:opacity-40"
                                    >
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {hasErrors && !successMessage && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                            <AlertCircle size={12} />
                            Files with errors will be skipped. Only valid .json files will be uploaded.
                        </p>
                    )}
                </div>

                {/* Footer */}
                {!successMessage && (
                    <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 dark:border-slate-800">
                        <button
                            onClick={onClose}
                            disabled={uploading}
                            className="px-4 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-all disabled:opacity-40"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleUpload}
                            disabled={uploading || validFiles.length === 0}
                            className="flex items-center gap-2 px-5 py-2 text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {uploading ? (
                                <>
                                    <Loader2 size={15} className="animate-spin" />
                                    Uploading…
                                </>
                            ) : (
                                <>
                                    <Upload size={15} />
                                    Upload {validFiles.length > 0 ? `${validFiles.length} File${validFiles.length !== 1 ? 's' : ''}` : 'Files'}
                                </>
                            )}
                        </button>
                    </div>
                )}

                {successMessage && (
                    <div className="flex justify-end px-6 py-4 border-t border-slate-100 dark:border-slate-800">
                        <button
                            onClick={onClose}
                            className="px-5 py-2 text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-all"
                        >
                            Done
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default LoadAIUseCaseModal;
