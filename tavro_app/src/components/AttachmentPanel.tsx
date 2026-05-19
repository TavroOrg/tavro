import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Paperclip, Trash2, Download, Upload } from 'lucide-react';
import { businessRelationsApi } from '../services/businessRelationsApi';

export interface Attachment {
    id: string;
    name: string;
    size: number;
    type: string;
    uploadedAt: Date;
    url?: string;
}

interface AttachmentPanelProps {
    agentId?: string;
    attachments?: Attachment[];
    onAttachmentAdd?: (file: File) => Promise<void>;
    onAttachmentDelete?: (id: string) => Promise<void>;
}

const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
};

const AttachmentRow: React.FC<{
    attachment: Attachment;
    onDelete?: () => void;
    onDownload?: () => void;
}> = ({ attachment, onDelete, onDownload }) => {
    const getFileIcon = (type: string) => {
        if (type.includes('pdf')) return '📄';
        if (type.includes('image')) return '🖼️';
        if (type.includes('video')) return '🎥';
        if (type.includes('audio')) return '🎵';
        return '📎';
    };

    const timeStr = attachment.uploadedAt.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
    const dateStr = attachment.uploadedAt.toLocaleDateString();

    return (
        <div className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 transition-colors px-3 py-2 flex items-center gap-2">
            <span className="text-lg flex-shrink-0">{getFileIcon(attachment.type)}</span>
            <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-800 truncate">{attachment.name}</p>
                <p className="text-[10px] text-slate-400">
                    {formatFileSize(attachment.size)} • {dateStr} {timeStr}
                </p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
                {onDownload && (
                    <button
                        onClick={onDownload}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        title="Download"
                    >
                        <Download size={14} />
                    </button>
                )}
                {onDelete && (
                    <button
                        onClick={onDelete}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="Delete"
                    >
                        <Trash2 size={14} />
                    </button>
                )}
            </div>
        </div>
    );
};

/** Inline Attachment panel — renders as h-full flex column. */
const AttachmentPanel: React.FC<AttachmentPanelProps> = ({
    agentId,
    attachments,
    onAttachmentAdd,
    onAttachmentDelete,
}) => {
    const params = useParams<{ id: string }>();
    const resolvedAgentId = agentId || params.id;
    const [isUploading, setIsUploading] = useState(false);
    const [localAttachments, setLocalAttachments] = useState<Attachment[]>(attachments ?? []);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const loadAttachments = async () => {
        if (!resolvedAgentId) {
            setLocalAttachments([]);
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const rows = await businessRelationsApi.listAgentAttachments(resolvedAgentId);
            setLocalAttachments(rows.map(row => ({
                id: row.id,
                name: row.filename,
                size: row.file_size_bytes,
                type: row.mime_type || 'application/octet-stream',
                uploadedAt: new Date(row.created_at),
            })));
        } catch (error) {
            console.error('Failed to load attachments:', error);
            setError(error instanceof Error ? error.message : 'Failed to load attachments.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!attachments) return;
        setLocalAttachments(attachments);
    }, [attachments]);

    useEffect(() => {
        if (onAttachmentAdd || onAttachmentDelete) return;
        loadAttachments();
    }, [resolvedAgentId, onAttachmentAdd, onAttachmentDelete]);

    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.currentTarget.files;
        if (!files || files.length === 0) return;
        if (!resolvedAgentId && !onAttachmentAdd) return;

        const file = files[0];
        setIsUploading(true);
        setError(null);

        try {
            if (onAttachmentAdd) {
                await onAttachmentAdd(file);
                const newAttachment: Attachment = {
                    id: `att-${Date.now()}`,
                    name: file.name,
                    size: file.size,
                    type: file.type,
                    uploadedAt: new Date(),
                };
                setLocalAttachments(prev => [newAttachment, ...prev]);
            } else if (resolvedAgentId) {
                const base64 = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = ev => {
                        const result = ev.target?.result as string | undefined;
                        if (!result) {
                            reject(new Error('Failed to read file'));
                            return;
                        }
                        resolve(result.split(',')[1] || '');
                    };
                    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
                    reader.readAsDataURL(file);
                });

                await businessRelationsApi.uploadAgentAttachment(resolvedAgentId, {
                    filename: file.name,
                    mime_type: file.type || 'application/octet-stream',
                    content_base64: base64,
                });
                await loadAttachments();
            }
        } catch (error) {
            console.error('Failed to upload attachment:', error);
            setError(error instanceof Error ? error.message : 'Failed to upload attachment.');
        } finally {
            setIsUploading(false);
            // Reset input
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const handleDelete = async (id: string) => {
        try {
            setError(null);
            if (onAttachmentDelete) {
                await onAttachmentDelete(id);
                setLocalAttachments(prev => prev.filter(a => a.id !== id));
            } else if (resolvedAgentId) {
                await businessRelationsApi.deleteAgentAttachment(resolvedAgentId, id);
                setLocalAttachments(prev => prev.filter(a => a.id !== id));
            }
        } catch (error) {
            console.error('Failed to delete attachment:', error);
            setError(error instanceof Error ? error.message : 'Failed to delete attachment.');
        }
    };

    const handleDownload = async (attachment: Attachment) => {
        try {
            setError(null);
            if (attachment.url) {
                const link = document.createElement('a');
                link.href = attachment.url;
                link.download = attachment.name;
                link.click();
                return;
            }
            if (!resolvedAgentId) return;

            const blob = await businessRelationsApi.downloadAgentAttachment(resolvedAgentId, attachment.id);
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = attachment.name;
            link.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Failed to download attachment:', error);
            setError(error instanceof Error ? error.message : 'Failed to download attachment.');
        }
    };

    return (
        <div className="flex flex-col h-full bg-slate-50">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-700 flex-shrink-0">
                <div className="flex items-center gap-2">
                    <Paperclip size={14} className="text-amber-400" />
                    <span className="font-bold text-white text-sm">Attachments</span>
                    <span className="text-[11px] text-slate-400 font-mono ml-1">
                        {localAttachments.length} file{localAttachments.length !== 1 ? 's' : ''}
                    </span>
                </div>
            </div>

            {/* Upload area */}
            <div className="px-3 py-3 border-b border-slate-200 bg-white flex-shrink-0">
                <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFileSelect}
                    disabled={isUploading}
                    className="hidden"
                />
                <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading || (!resolvedAgentId && !onAttachmentAdd)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium text-slate-600 hover:text-blue-600"
                >
                    {isUploading ? (
                        <>
                            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                            Uploading...
                        </>
                    ) : (
                        <>
                            <Upload size={16} />
                            Add Attachment
                        </>
                    )}
                </button>
                {error && (
                    <p className="mt-2 text-xs text-red-600 break-words">{error}</p>
                )}
            </div>

            {/* Attachments list */}
            <div className="flex-1 overflow-y-auto bg-white">
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400 p-4">
                        <div className="w-5 h-5 border-2 border-slate-300 border-t-slate-500 rounded-full animate-spin" />
                        <p className="text-sm text-center">Loading attachments...</p>
                    </div>
                ) : localAttachments.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400 p-4">
                        <Paperclip size={32} className="opacity-30" />
                        <p className="text-sm text-center">
                            {resolvedAgentId ? 'No attachments yet' : 'Open an agent to add attachments'}
                        </p>
                    </div>
                ) : (
                    <>
                        {localAttachments.map(attachment => (
                            <AttachmentRow
                                key={attachment.id}
                                attachment={attachment}
                                onDelete={() => handleDelete(attachment.id)}
                                onDownload={() => handleDownload(attachment)}
                            />
                        ))}
                    </>
                )}
            </div>

            {/* Footer status bar */}
            <div className="flex items-center justify-between px-3 py-2 bg-slate-900 border-t border-slate-700 flex-shrink-0">
                <div className="text-[10px] text-slate-400">
                    <span className="font-mono">
                        Total: {formatFileSize(
                            localAttachments.reduce((sum, att) => sum + att.size, 0)
                        )}
                    </span>
                </div>
                {resolvedAgentId && (
                    <button
                        onClick={loadAttachments}
                        className="text-[10px] text-slate-400 hover:text-blue-400 transition-colors"
                        title="Refresh attachments"
                    >
                        Refresh
                    </button>
                )}
            </div>
        </div>
    );
};

export default AttachmentPanel;
