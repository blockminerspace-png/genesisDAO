import React, { useCallback, useEffect, useState } from 'react';
import {
  BadgeCheck,
  Clapperboard,
  Loader2,
  Calendar,
  ThumbsUp,
  Youtube,
  Play,
  Sparkles
} from 'lucide-react';
import {
  getPartnersState,
  type PartnerYoutubeMySubmission,
  type PartnersShowcaseVideoDto,
  type PartnersStatePayload,
} from '../services/api';
import { YoutubePartnerStudio } from './YoutubePartnerStudio';

function thumbUrl(videoId: string): string {
  const v = String(videoId || '').trim();
  if (!v) return '';
  return `https://i.ytimg.com/vi/${v}/hqdefault.jpg`;
}

function fmtDate(ms: number): string {
  if (!ms) return '—';
  try {
    return new Date(ms).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '—';
  }
}

function channelOpenUrl(channelUrl: string, displayName: string): string {
  const c = String(channelUrl || '').trim();
  if (c) return c;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${displayName} channel`)}`;
}

/** Link directo ao canal com diálogo de subscrição (só URLs youtube.com). */
function youtubeSubscribeHref(channelUrl: string, displayName: string): string {
  const base = channelOpenUrl(channelUrl, displayName);
  if (!/^https?:\/\/(www\.)?youtube\.com\//i.test(base)) return base;
  return `${base}${base.includes('?') ? '&' : '?'}sub_confirmation=1`;
}

/** Topo do card: vídeo +, se existir foto na vitrine (admin), preview compacto à direita; play centrado na junção. */
function PartnerSplitHero({
  youtubeUrl,
  videoThumb,
  vitrineUrl,
}: {
  youtubeUrl: string;
  videoThumb: string;
  vitrineUrl: string;
}) {
  const [vitrineOk, setVitrineOk] = useState(true);
  const hasVitrine = Boolean(String(vitrineUrl || '').trim()) && vitrineOk;
  /** Junção visual 11 : 9 — play alinhado ao divisor (não ao centro geométrico). */
  const splitPlayLeft = 'left-[55%]';

  return (
    <a
      href={youtubeUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="relative block aspect-video bg-slate-950 group shrink-0 overflow-hidden"
    >
      <div className="absolute inset-0 flex">
        <div className={`relative min-h-0 overflow-hidden ${hasVitrine ? 'flex-[11] min-w-0' : 'flex-1'}`}>
          <img
            src={videoThumb}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-95 group-hover:opacity-100 group-hover:scale-[1.02] transition-transform duration-300"
          />
        </div>
        {hasVitrine ? (
          <div className="relative flex-[9] min-w-0 border-l border-slate-700/80 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-950 flex items-center justify-center px-3 py-3 sm:px-4 sm:py-4">
            <div className="relative h-[min(76%,11.5rem)] w-[min(80%,10.5rem)] sm:h-[min(78%,13rem)] sm:w-[min(80%,11.5rem)] rounded-2xl border border-white/20 bg-slate-900/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_12px_40px_rgba(0,0,0,0.55)] ring-1 ring-black/40 grid place-items-center overflow-hidden">
              <img
                src={vitrineUrl}
                alt=""
                className="max-h-[90%] max-w-[90%] object-contain rounded-lg"
                onError={() => setVitrineOk(false)}
              />
            </div>
          </div>
        ) : null}
      </div>
      <div className="absolute inset-0 bg-black/28 pointer-events-none transition-colors group-hover:bg-black/20" />
      <div
        className={`absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 pointer-events-none ${hasVitrine ? splitPlayLeft : 'left-1/2'}`}
      >
        <div className="rounded-full bg-red-600 text-white p-3 shadow-lg shadow-red-900/60 ring-[5px] ring-slate-950/90 scale-95 group-hover:scale-100 transition-transform">
          <Play size={24} className="fill-white translate-x-0.5" />
        </div>
      </div>
    </a>
  );
}

function PartnerShowcaseAvatar({ name, imageUrl, compact }: { name: string; imageUrl: string; compact?: boolean }) {
  const [broken, setBroken] = useState(false);
  const letter = String(name || '?').trim().slice(0, 1).toUpperCase() || '?';
  const showImg = Boolean(imageUrl) && !broken;
  const box = compact ? 'h-10 w-10 text-sm' : 'h-14 w-14 text-lg';
  return (
    <span
      className={`relative flex ${box} items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-slate-700 to-slate-900 border border-slate-600 font-black text-amber-400 shrink-0`}
    >
      {showImg ? (
        <img
          src={imageUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        letter
      )}
    </span>
  );
}

type PartnersPageTab = 'videos' | 'studio';

export const PartnersPage: React.FC = () => {
  const [videos, setVideos] = useState<PartnersShowcaseVideoDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PartnersPageTab>('videos');

  const [partnersState, setPartnersState] = useState<PartnersStatePayload | null>(null);
  const [mySubs, setMySubs] = useState<PartnerYoutubeMySubmission[]>([]);

  const mapStateToUi = useCallback((st: PartnersStatePayload) => {
    const raw = Array.isArray(st.showcase?.videos) ? st.showcase!.videos : [];
    setVideos(raw);
    setPartnersState(st);
    const ms = Array.isArray(st.mySubmissions) ? st.mySubmissions : [];
    setMySubs(
      ms.map((s) => ({
        id: s.publicId,
        title: s.title,
        youtubeUrl: s.youtubeUrl,
        youtubeVideoId: s.youtubeVideoId,
        description: s.description,
        status: s.status,
        createdAt: s.createdAt,
        reviewedAt: s.reviewedAt,
        rejectReason: s.rejectReasonPublic
      }))
    );
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const st = await getPartnersState({ limit: 48 });
      if (!st?.ok) {
        setErr('Não foi possível carregar os vídeos.');
        setVideos([]);
        setPartnersState(null);
        setMySubs([]);
        return;
      }
      mapStateToUi(st);
    } catch {
      setErr('Não foi possível carregar os vídeos.');
      setVideos([]);
      setPartnersState(null);
      setMySubs([]);
    } finally {
      setLoading(false);
    }
  }, [mapStateToUi]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const auth = partnersState?.auth;
  const isPartner = !!auth?.isPartner;
  const canApply = !!auth?.canApply;
  const applicationPending = auth?.application?.status === 'pending';

  const studioTabLabel = isPartner ? 'Meu canal' : 'Credenciamento';

  return (
    <div className="w-full flex flex-col gap-8 text-slate-100 pb-8">
      <div id="parceiros-youtube" className="scroll-mt-6 max-w-7xl mx-auto w-full px-3 sm:px-4 space-y-8">
      <div className="rounded-2xl border border-slate-700/80 bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-amber-950/20 px-4 sm:px-6 py-5 sm:py-6 space-y-2">
        <div className="text-[11px] uppercase tracking-widest text-amber-500/90 font-bold">Painel / Parceiros</div>
        <h1 className="text-2xl sm:text-4xl font-black tracking-tight flex flex-wrap items-center gap-3">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-red-600/90 text-white shadow-lg shadow-red-900/30">
            <Clapperboard className="shrink-0" size={26} />
          </span>
          <span className="bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">Parceiros YouTube</span>
        </h1>
        <p className="text-sm text-slate-400 max-w-3xl">
          {activeTab === 'videos'
            ? 'Vitrine com os vídeos aprovados pela equipa — explora, subscreve e apoia os criadores.'
            : isPartner
              ? 'Gere o teu canal parceiro, envia vídeos (1/dia UTC) e acompanha a Sala Streamer.'
              : 'Candidata o teu canal YouTube, desbloqueia a Sala Streamer e passa a submeter conteúdo após aprovação.'}
        </p>

        <div
          className="flex flex-wrap gap-2 pt-2"
          role="tablist"
          aria-label="Secções Parceiros YouTube"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'videos'}
            onClick={() => setActiveTab('videos')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black uppercase tracking-wide border transition ${
              activeTab === 'videos'
                ? 'bg-violet-600/25 border-violet-500/50 text-violet-100 shadow-lg shadow-violet-950/30'
                : 'bg-slate-950/50 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600'
            }`}
          >
            <Play size={16} className={activeTab === 'videos' ? 'text-violet-300' : 'text-slate-500'} />
            Vídeos
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'studio'}
            onClick={() => setActiveTab('studio')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black uppercase tracking-wide border transition ${
              activeTab === 'studio'
                ? 'bg-red-600/20 border-red-500/45 text-red-100 shadow-lg shadow-red-950/25'
                : 'bg-slate-950/50 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600'
            }`}
          >
            {isPartner ? (
              <BadgeCheck size={16} className={activeTab === 'studio' ? 'text-emerald-300' : 'text-slate-500'} />
            ) : (
              <Sparkles size={16} className={activeTab === 'studio' ? 'text-red-300' : 'text-slate-500'} />
            )}
            {studioTabLabel}
            {applicationPending && activeTab !== 'studio' ? (
              <span className="rounded-full bg-amber-500/90 px-1.5 py-0.5 text-[9px] font-black text-black normal-case tracking-normal">
                Pendente
              </span>
            ) : null}
            {canApply && !applicationPending && !isPartner && activeTab !== 'studio' ? (
              <span className="rounded-full bg-red-500/90 px-1.5 py-0.5 text-[9px] font-black text-white normal-case tracking-normal">
                Novo
              </span>
            ) : null}
          </button>
        </div>
      </div>

      {activeTab === 'studio' ? (
        loading && !partnersState ? (
          <div className="flex justify-center py-16 text-red-400">
            <Loader2 className="animate-spin" size={32} />
          </div>
        ) : partnersState ? (
          <YoutubePartnerStudio state={partnersState} mySubs={mySubs} onReload={loadAll} />
        ) : (
          <div className="text-red-400 text-sm border border-red-900/40 rounded-xl p-6 text-center">
            Não foi possível carregar o painel de credenciamento.
          </div>
        )
      ) : null}

      {activeTab === 'videos' ? (
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-lg sm:text-xl font-black text-white tracking-tight">Últimos vídeos</h2>
            <p className="text-xs text-slate-500 font-semibold mt-0.5 max-w-2xl">
              {!loading && !err && videos.length > 0
                ? `${videos.length} na vitrine — com foto definida no admin (Parceiros → Vitrine por utilizador), a imagem aparece ao lado da miniatura do vídeo; sem foto, só o vídeo.`
                : '🔥 Os mais recentes em destaque — miniatura do vídeo + vitrine lado a lado quando existir foto.'}
            </p>
          </div>
        </div>
        {loading ? (
          <div className="flex justify-center py-16 text-amber-500">
            <Loader2 className="animate-spin" size={32} />
          </div>
        ) : err ? (
          <div className="text-red-400 text-sm">{err}</div>
        ) : videos.length === 0 ? (
          <div className="text-slate-500 text-sm border border-slate-800 rounded-xl p-8 text-center">
            Ainda não há vídeos aprovados. Volta mais tarde!
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {videos.map((v) => {
              const displayName = String(v.creator?.displayName || '').trim() || 'Parceiro';
              const customChannel = String(v.creator?.channelUrl || '').trim();
              const channelHref = channelOpenUrl(customChannel, displayName);
              const channelLabel = customChannel ? 'Ver canal' : 'Procurar canal';
              const subHref = youtubeSubscribeHref(customChannel, displayName);
              const isYoutubeChannel = /^https?:\/\/(www\.)?youtube\.com\//i.test(channelHref);
              const avatarUrl = String(v.creator?.avatarUrl || '').trim();
              const thumb = v.thumbnailUrl || thumbUrl(v.youtubeVideoId);
              return (
                <article
                  key={v.publicId}
                  className="rounded-xl border border-slate-600/80 bg-slate-950/60 overflow-hidden flex flex-col shadow-xl shadow-black/30 ring-1 ring-white/5 hover:ring-amber-500/20 transition-all"
                >
                  <PartnerSplitHero youtubeUrl={v.youtubeUrl} videoThumb={thumb} vitrineUrl={avatarUrl} />
                  <div className="flex items-center gap-2.5 px-3 py-2 bg-slate-950/95 border-t border-slate-800">
                    <PartnerShowcaseAvatar name={displayName} imageUrl={avatarUrl} compact />
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-sm text-white truncate leading-tight">{displayName}</div>
                      <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">Parceiro YouTube</div>
                    </div>
                    <a
                      href={subHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 inline-flex items-center justify-center rounded-md bg-gradient-to-b from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 text-white text-[10px] font-black uppercase px-2.5 py-2 shadow-md shadow-red-900/40 border border-red-500/30 whitespace-nowrap"
                    >
                      {isYoutubeChannel ? 'Subscrever' : 'YouTube'}
                    </a>
                  </div>
                  <div className="p-3 flex flex-col gap-2 flex-1 border-t border-slate-800/80">
                    <h3 className="font-bold text-sm text-white leading-snug line-clamp-2 min-h-[2.5rem]">{v.title}</h3>
                    <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="inline-flex items-center gap-1">
                        <Calendar size={12} /> {fmtDate(v.publishedAt)}
                      </span>
                    </div>
                    <div className="mt-auto grid grid-cols-2 gap-2 pt-1">
                      <a
                        href={v.youtubeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-1.5 text-center text-[10px] sm:text-[11px] font-black uppercase py-2.5 rounded-lg bg-gradient-to-b from-orange-500 to-orange-700 hover:from-orange-400 hover:to-orange-600 text-white shadow-md shadow-orange-900/30 border border-orange-400/30"
                      >
                        <ThumbsUp size={14} className="shrink-0" />
                        Curtir no YouTube
                      </a>
                      <a
                        href={channelHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-1.5 text-center text-[10px] sm:text-[11px] font-black uppercase py-2.5 rounded-lg bg-gradient-to-b from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 text-white shadow-md shadow-red-900/40 border border-red-500/30"
                      >
                        <Youtube size={14} className="shrink-0" />
                        {channelLabel}
                      </a>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      ) : null}
      </div>
    </div>
  );
};
