// ── src/components/playground/AttachmentPicker.tsx ───────────────────────────
// File attachment UI for the playground chat input.
// Converts files to base64 and passes them to the parent via onAttach.

import React, { useRef, useState } from 'react';
import { toUserMessage } from '../../utils/errorUtils';
import { Paperclip, X, FileText, Image, Table, File, AlertCircle } from 'lucide-react';

export interface PendingAttachment {
  name:      string;
  mime_type: string;
  data:      string;   // base64
  size:      number;   // bytes
  preview?:  string;   // data URL for images
}

interface AttachmentPickerProps {
  attachments: PendingAttachment[];
  onChange:    (attachments: PendingAttachment[]) => void;
  disabled?:   boolean;
}

// ── Supported types ───────────────────────────────────────────────────────────
const ACCEPTED = [
  'application/pdf',
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp',
  'text/csv', 'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
].join(',');

const MAX_SIZE_MB = 20;
const MAX_FILES   = 5;

function fileIcon(mime: string) {
  if (mime.startsWith('image/'))    return <Image  size={13} />;
  if (mime === 'application/pdf')   return <FileText size={13} />;
  if (mime.includes('csv') || mime.includes('excel') || mime.includes('sheet'))
                                    return <Table  size={13} />;
  return <File size={13} />;
}

function fileColor(mime: string) {
  if (mime.startsWith('image/'))  return 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800';
  if (mime === 'application/pdf') return 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800';
  if (mime.includes('csv') || mime.includes('excel') || mime.includes('sheet'))
                                  return 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800';
  return 'text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700';
}

function formatSize(bytes: number): string {
  if (bytes < 1024)        return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

async function readFile(file: File): Promise<PendingAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const dataUrl = e.target?.result as string;
      // dataUrl is "data:<mime>;base64,<data>" — extract just the base64 part
      const base64 = dataUrl.split(',')[1];
      resolve({
        name:      file.name,
        mime_type: file.type || 'application/octet-stream',
        data:      base64,
        size:      file.size,
        preview:   file.type.startsWith('image/') ? dataUrl : undefined,
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

const AttachmentPicker: React.FC<AttachmentPickerProps> = ({
  attachments, onChange, disabled,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFiles = async (files: FileList) => {
    setError(null);
    const remaining = MAX_FILES - attachments.length;
    if (remaining <= 0) {
      setError(`Maximum ${MAX_FILES} attachments per message`);
      return;
    }

    const toAdd = Array.from(files).slice(0, remaining);
    const oversized = toAdd.filter(f => f.size > MAX_SIZE_MB * 1024 * 1024);
    if (oversized.length) {
      setError(`Files must be under ${MAX_SIZE_MB}MB: ${oversized.map(f => f.name).join(', ')}`);
      return;
    }

    setLoading(true);
    try {
      const processed = await Promise.all(toAdd.map(readFile));
      onChange([...attachments, ...processed]);
    } catch (err: any) {
      setError(toUserMessage(err));
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const removeAttachment = (i: number) => {
    onChange(attachments.filter((_, idx) => idx !== i));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (disabled) return;
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div className="flex flex-col gap-2">

      {/* Existing attachments */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {attachments.map((att, i) => (
            <div key={i}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold ${fileColor(att.mime_type)}`}>

              {/* Image preview thumbnail */}
              {att.preview ? (
                <img src={att.preview} alt={att.name}
                  className="w-5 h-5 object-cover rounded flex-shrink-0" />
              ) : (
                fileIcon(att.mime_type)
              )}

              <span className="truncate max-w-[140px]">{att.name}</span>
              <span className="text-[9px] opacity-70">{formatSize(att.size)}</span>

              <button
                onClick={() => removeAttachment(i)}
                className="ml-0.5 hover:opacity-70 transition-opacity flex-shrink-0"
                title="Remove attachment"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-1.5 text-[11px] text-rose-600 dark:text-rose-400 px-1">
          <AlertCircle size={11} /> {error}
        </div>
      )}

      {/* Attach button */}
      <div
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED}
          className="hidden"
          onChange={e => e.target.files && handleFiles(e.target.files)}
          disabled={disabled || loading || attachments.length >= MAX_FILES}
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={disabled || loading || attachments.length >= MAX_FILES}
          title={attachments.length >= MAX_FILES ? `Max ${MAX_FILES} files` : 'Attach files (PDF, image, CSV, Excel)'}
          className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-lg border transition-all ${
            attachments.length >= MAX_FILES || disabled
              ? 'text-slate-300 dark:text-slate-600 border-slate-200 dark:border-slate-700 cursor-not-allowed'
              : 'text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:text-violet-600 dark:hover:text-violet-400 hover:border-violet-300 dark:hover:border-violet-700 hover:bg-violet-50 dark:hover:bg-violet-900/20'
          }`}
        >
          <Paperclip size={12} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Reading…' : 'Attach'}
          {attachments.length > 0 && (
            <span className="text-[9px] font-bold bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400 px-1 rounded-full">
              {attachments.length}/{MAX_FILES}
            </span>
          )}
        </button>
      </div>
    </div>
  );
};

export default AttachmentPicker;
