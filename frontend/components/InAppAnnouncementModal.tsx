import React from 'react';
import { ExternalLink, Info, X } from 'lucide-react';

export type InAppAnnouncement = {
  id: string;
  title: string;
  message: string;
  link: string | null;
};

type Props = {
  announcement: InAppAnnouncement | null;
  onDismiss: () => void;
  dismissing?: boolean;
};

export const InAppAnnouncementModal: React.FC<Props> = ({ announcement, onDismiss, dismissing }) => {
  if (!announcement) return null;

  const link = announcement.link?.trim() || null;

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label={announcement.title || 'Aviso'}
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-slate-600/80 bg-slate-900 p-5 shadow-2xl dark:bg-slate-950"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onDismiss}
          disabled={dismissing}
          className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white disabled:opacity-50"
          aria-label="Fechar"
        >
          <X size={18} />
        </button>
        <div className="mb-3 inline-flex rounded-full bg-amber-500/20 p-2 text-amber-400">
          <Info size={22} aria-hidden />
        </div>
        <h3 className="mb-2 pr-8 text-sm font-bold uppercase tracking-wide text-white">
          {announcement.title}
        </h3>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{announcement.message}</p>
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-400 hover:text-amber-300"
          >
            Saiba mais
            <ExternalLink size={14} aria-hidden />
          </a>
        ) : null}
        <button
          type="button"
          onClick={onDismiss}
          disabled={dismissing}
          className="mt-6 w-full rounded-xl bg-orange-600 py-2.5 text-xs font-black uppercase tracking-widest text-white transition hover:bg-orange-500 disabled:opacity-60"
        >
          {dismissing ? 'A guardar…' : 'Li'}
        </button>
      </div>
    </div>
  );
};
