import React, { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Boxes, Upload, FileText, X, AlertCircle, CheckCircle2, Zap, Loader2, Building2 } from 'lucide-react';

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

function getActiveCompanyId(): string {
    return localStorage.getItem('tavro_active_company_id') ?? '';
}

function authHeaders(): Record<string, string> {
    const accessToken = localStorage.getItem('tavro_admin_access_token') ?? '';
    const companyId = getActiveCompanyId();
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

const NO_COMPANY_ERROR = 'No company selected. Please create or select a company before uploading a CSV.';

const AdminDigitalTwinPage: React.FC = () => {
    const companyId = getActiveCompanyId();
    const [stagedFile, setStagedFile] = useState<StagedFile | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFiles = useCallback((fileList: FileList | null) => {
        if (!fileList || fileList.length === 0) return;

        if (!companyId) {
            setError(NO_COMPANY_ERROR);
            return;
        }

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
    }, [companyId]);

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
        if (!companyId) {
            setError(NO_COMPANY_ERROR);
            return;
        }
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
            <div className="space-y-6 animate-fade-in max-w-3xl mx-auto">
                <div className="flex items-center gap-3.5">
                    <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-md shadow-blue-500/25">
                        <Boxes size={20} className="text-white" />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-800 dark:text-white tracking-tight">
                        Digital Twin
                    </h1>
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

                <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-3xl shadow-sm p-6">
                    {!companyId ? (
                        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                            <div className="h-14 w-14 rounded-2xl bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center">
                                <Building2 size={22} className="text-amber-500" />
                            </div>
                            <div>
                                <p className="font-bold text-slate-700 dark:text-slate-200 text-base">
                                    No company selected
                                </p>
                                <p className="text-sm text-slate-400 max-w-sm mt-1.5">
                                    You need to create or select a company before you can upload a CSV.
                                </p>
                            </div>
                            <Link
                                to="/company"
                                className="flex items-center gap-1.5 mt-2 px-4 py-2.5 rounded-xl font-bold text-xs text-white bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md shadow-blue-500/25 transition-all"
                            >
                                <Building2 size={14} /> Go to Company tab
                            </Link>
                        </div>
                    ) : (
                    <>
                    {!stagedFile && (
                        <div
                            onDragOver={e => {
                                e.preventDefault();
                                setIsDragging(true);
                            }}
                            onDragLeave={() => setIsDragging(false)}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                            className={`flex flex-col items-center justify-center gap-3 py-16 text-center border-2 border-dashed rounded-2xl cursor-pointer transition-all ${
                                isDragging
                                    ? 'border-blue-400 bg-blue-50 dark:bg-blue-500/10 scale-[1.01]'
                                    : 'border-slate-200 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-800 hover:bg-slate-50/60 dark:hover:bg-slate-800/30'
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
                        <div className="flex flex-col gap-4">
                            <div className="group relative min-w-0 overflow-hidden bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-4 pl-5 transition-all duration-200 flex items-center gap-3.5">
                                <span
                                    className={`absolute left-0 top-0 bottom-0 w-1 transition-colors ${
                                        stagedFile.status === 'processed'
                                            ? 'bg-emerald-500'
                                            : stagedFile.status === 'processing'
                                              ? 'bg-blue-500'
                                              : 'bg-slate-300 dark:bg-slate-700'
                                    }`}
                                />
                                <div className="h-11 w-11 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center shrink-0">
                                    <FileText size={19} className="text-blue-600 dark:text-blue-400" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-semibold text-sm text-slate-700 dark:text-slate-200 truncate">
                                        {stagedFile.file.name}
                                    </p>
                                    <p className="text-xs text-slate-400 mt-0.5">{formatBytes(stagedFile.file.size)}</p>
                                </div>

                                {stagedFile.status === 'staged' && (
                                    <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-full shrink-0">
                                        <CheckCircle2 size={13} /> Ready
                                    </span>
                                )}
                                {stagedFile.status === 'processing' && (
                                    <span className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 px-2.5 py-1 rounded-full shrink-0">
                                        <Loader2 size={13} className="animate-spin" /> Processing…
                                    </span>
                                )}
                                {stagedFile.status === 'processed' && (
                                    <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-2.5 py-1 rounded-full shrink-0">
                                        <CheckCircle2 size={13} /> Embedded
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

                            {stagedFile.status === 'processing' && (
                                <div className="h-1 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                    <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 animate-indeterminate" />
                                </div>
                            )}

                            {stagedFile.status === 'processed' ? (
                                <div className="flex flex-col items-center gap-3 rounded-2xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200/70 dark:border-emerald-500/20 px-4 py-4 text-center">
                                    <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                                        <CheckCircle2 size={16} className="shrink-0" />
                                        File processed and embedded successfully.
                                    </p>
                                    <button
                                        onClick={removeFile}
                                        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold text-xs text-emerald-700 dark:text-emerald-400 bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-500/30 hover:bg-emerald-50 dark:hover:bg-emerald-500/20 transition-colors"
                                    >
                                        Upload another file
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={handleProcess}
                                    disabled={stagedFile.status === 'processing'}
                                    className="self-center flex items-center gap-1.5 px-4 py-2.5 rounded-xl font-bold text-xs text-white bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md shadow-blue-500/25 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
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
                    </>
                    )}
                </div>

                <div className="bg-blue-50/60 dark:bg-blue-500/5 border border-blue-100 dark:border-blue-500/10 rounded-3xl p-6 text-center">
                    <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3">Guidelines</h2>
                    <ul className="space-y-2.5 text-xs text-slate-500 dark:text-slate-400 inline-block text-left">
                        <li className="flex items-start gap-2">
                            <CheckCircle2 size={13} className="text-blue-500 mt-0.5 shrink-0" />
                            Up to {MAX_FILE_SIZE_LABEL} per file, one .csv at a time.
                        </li>
                        <li className="flex items-start gap-2">
                            <CheckCircle2 size={13} className="text-blue-500 mt-0.5 shrink-0" />
                            First row should be column headers.
                        </li>
                        <li className="flex items-start gap-2">
                            <CheckCircle2 size={13} className="text-blue-500 mt-0.5 shrink-0" />
                            Re-uploading a file replaces its previous data.
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    );
};

export default AdminDigitalTwinPage;
