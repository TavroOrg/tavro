import React, { useCallback, useRef, useState } from 'react';
import { Boxes, Upload, FileText, X, AlertCircle, CheckCircle2, Zap, Loader2 } from 'lucide-react';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_FILE_SIZE_LABEL = '10 MB';
const ACCEPTED_EXTENSION = '.csv';
const ACCEPTED_MIME_TYPES = ['text/csv', 'application/vnd.ms-excel'];

type ProcessStatus = 'staged' | 'processing' | 'processed';

interface StagedFile {
    id: string;
    file: File;
    status: ProcessStatus;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getExtension(fileName: string): string {
    const idx = fileName.lastIndexOf('.');
    return idx === -1 ? '' : fileName.slice(idx).toLowerCase();
}

function validateFile(file: File): string | null {
    const isAcceptedExt = getExtension(file.name) === ACCEPTED_EXTENSION;
    const isAcceptedMime = file.type === '' || ACCEPTED_MIME_TYPES.includes(file.type);
    if (!isAcceptedExt || !isAcceptedMime) {
        return `"${file.name}" is not a supported file type. Please upload a CSV (.csv) file.`;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
        return `"${file.name}" is ${formatBytes(file.size)}, which exceeds the ${MAX_FILE_SIZE_LABEL} limit. Please upload a smaller file.`;
    }
    return null;
}

function authHeaders(): Record<string, string> {
    const accessToken = localStorage.getItem('tavro_admin_access_token') ?? '';
    const companyId = localStorage.getItem('tavro_active_company_id') ?? '';
    const tenantId = (() => {
        const stored = localStorage.getItem('tavro_admin_tenant_id');
        if (stored) return stored;
        try {
            const idToken = localStorage.getItem('tavro_admin_id_token');
            if (!idToken) return '';
            const payload = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
            const ro = payload['urn:zitadel:iam:user:resourceowner'];
            if (ro && typeof ro === 'object' && ro.id) return String(ro.id);
            return payload['urn:zitadel:iam:user:resourceowner:id'] || payload['urn:zitadel:iam:org:id'] || payload['org_id'] || '';
        } catch { return ''; }
    })();
    return {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(tenantId    ? { 'x-tenant-id': tenantId }               : {}),
        ...(companyId   ? { 'x-company-id': companyId }             : {}),
    };
}

const AdminDigitalTwinPage: React.FC = () => {
    const [stagedFile, setStagedFile] = useState<StagedFile | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFiles = useCallback((fileList: FileList | null) => {
        if (!fileList || fileList.length === 0) return;

        if (fileList.length > 1) {
            setError('Only one CSV file can be uploaded at a time.');
            return;
        }

        const file = fileList[0];
        const validationError = validateFile(file);
        if (validationError) {
            setError(validationError);
            return;
        }

        setError(null);
        setStagedFile({ id: `${file.name}-${file.size}-${file.lastModified}`, file, status: 'staged' });
    }, []);

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        handleFiles(e.target.files);
        e.target.value = '';
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
        handleFiles(e.dataTransfer.files);
    };

    const removeFile = () => {
        setStagedFile(null);
    };

    const handleProcess = async () => {
        if (!stagedFile) return;
        setStagedFile(prev => (prev ? { ...prev, status: 'processing' } : prev));
        setError(null);

        try {
            const formData = new FormData();
            formData.append('file', stagedFile.file, stagedFile.file.name);

            const res = await fetch('/api/v1/admin/digital-twin/process', {
                method: 'POST',
                body: formData,
                headers: authHeaders(),
            });

            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.detail || `Processing failed (${res.status}).`);
            }

            setStagedFile(prev => (prev ? { ...prev, status: 'processed' } : prev));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Processing failed.');
            setStagedFile(prev => (prev ? { ...prev, status: 'staged' } : prev));
        }
    };

    return (
        <div className="overflow-auto flex-1 p-6">
            <div className="space-y-6 animate-fade-in max-w-5xl mx-auto">
                <div className="flex items-center gap-3.5">
                    <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-md shadow-blue-500/25">
                        <Boxes size={20} className="text-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800 dark:text-white tracking-tight">
                            Digital Twin
                        </h1>
                    </div>
                </div>

                {error && (
                    <div className="flex items-center gap-2 p-4 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-sm text-red-600 dark:text-red-400">
                        <AlertCircle size={14} className="shrink-0" />
                        <span>{error}</span>
                        <button
                            onClick={() => setError(null)}
                            className="ml-auto text-red-400 hover:text-red-600 dark:hover:text-red-300"
                        >
                            <X size={14} />
                        </button>
                    </div>
                )}

                {!stagedFile && (
                    <div
                        onDragOver={e => {
                            e.preventDefault();
                            setIsDragging(true);
                        }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className={`flex flex-col items-center justify-center gap-3 py-16 text-center border-2 border-dashed rounded-3xl cursor-pointer transition-all ${
                            isDragging
                                ? 'border-blue-400 bg-blue-50 dark:bg-blue-500/10'
                                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                    >
                        <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-500/10 dark:to-indigo-500/10 flex items-center justify-center">
                            <Upload size={22} className="text-blue-500" />
                        </div>
                        <div>
                            <p className="font-bold text-slate-700 dark:text-slate-200 text-base">
                                Drag &amp; drop a CSV file here
                            </p>
                            <p className="text-sm text-slate-400 max-w-sm mt-1.5">
                                or click to browse — one .csv file, up to {MAX_FILE_SIZE_LABEL}
                            </p>
                        </div>
                        <button
                            onClick={e => {
                                e.stopPropagation();
                                fileInputRef.current?.click();
                            }}
                            className="flex items-center gap-1.5 mt-2 px-4 py-2.5 rounded-xl font-bold text-xs text-white bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md shadow-blue-500/25 transition-all"
                        >
                            <Upload size={14} /> Upload CSV
                        </button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".csv,text/csv"
                            className="hidden"
                            onChange={handleFileInputChange}
                        />
                    </div>
                )}

                {stagedFile && (
                    <div className="flex flex-col gap-3">
                        <div className="group relative min-w-0 overflow-hidden bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-4 pl-5 shadow-sm hover:shadow-lg transition-all duration-200 flex items-center gap-3">
                            <span
                                className={`absolute left-0 top-0 bottom-0 w-1 ${
                                    stagedFile.status === 'processed' ? 'bg-emerald-500' : 'bg-blue-500'
                                }`}
                            />
                            <div className="h-10 w-10 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center shrink-0">
                                <FileText size={18} className="text-blue-600 dark:text-blue-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-semibold text-sm text-slate-700 dark:text-slate-200 truncate">
                                    {stagedFile.file.name}
                                </p>
                                <p className="text-xs text-slate-400 mt-0.5">{formatBytes(stagedFile.file.size)}</p>
                            </div>

                            {stagedFile.status === 'staged' && (
                                <span className="flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 shrink-0">
                                    <CheckCircle2 size={14} /> Ready
                                </span>
                            )}
                            {stagedFile.status === 'processing' && (
                                <span className="flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 shrink-0">
                                    <Loader2 size={14} className="animate-spin" /> Processing…
                                </span>
                            )}
                            {stagedFile.status === 'processed' && (
                                <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 shrink-0">
                                    <CheckCircle2 size={14} /> Embedded
                                </span>
                            )}

                            <button
                                onClick={removeFile}
                                disabled={stagedFile.status === 'processing'}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 shrink-0 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                title="Remove"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {stagedFile.status !== 'processed' && (
                            <button
                                onClick={handleProcess}
                                disabled={stagedFile.status === 'processing'}
                                className="self-start flex items-center gap-1.5 px-4 py-2.5 rounded-xl font-bold text-xs text-white bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md shadow-blue-500/25 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {stagedFile.status === 'processing' ? (
                                    <>
                                        <Loader2 size={14} className="animate-spin" /> Processing…
                                    </>
                                ) : (
                                    <>
                                        <Zap size={14} /> Process &amp; Embed
                                    </>
                                )}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AdminDigitalTwinPage;
