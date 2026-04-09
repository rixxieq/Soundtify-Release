import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Home, 
  Search, 
  Library, 
  PlusSquare, 
  Heart, 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Repeat, 
  Shuffle, 
  Volume2, 
  VolumeX,
  ListMusic
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

declare global {
  interface Window {
    electronApp?: {
      updateNativeSmtc?: (payload: {
        title: string;
        artist: string;
        artworkUrl?: string;
        trackUrl?: string;
        isPlaying: boolean;
        durationSec: number;
        positionSec: number;
      }) => void;
      clearNativeSmtc?: () => void;
      onNativeSmtcAction?: (callback: (action: string) => void) => (() => void);
      onNativeSmtcStatus?: (callback: (payload: { ready?: boolean; failed?: boolean }) => void) => (() => void);
    };
  }
}

interface Track {
  id: number;
  title: string;
  metadata_artist?: string;
  publisher_metadata?: {
    artist?: string;
  };
  user: {
    id?: number;
    username: string;
    avatar_url?: string;
    permalink_url?: string;
  }
  duration: number;
  artwork_url?: string;
  permalink_url?: string;
  media?: {
    transcodings?: Array<{
      url: string;
      format?: {
        protocol?: string;
        mime_type?: string;
      };
    }>;
  };
  playback_count?: number;
  favoritings_count?: number;
  comment_count?: number;
  streamable?: boolean;
  access?: string;
  available_country_codes?: string[];
}

interface ArtistProfile {
  id: number;
  username: string;
  permalink_url?: string;
  avatar_url?: string;
  description?: string;
  followers_count?: number;
  track_count?: number;
  playlist_count?: number;
  banner_url?: string;
}

interface LibraryItem {
  id: number;
  title: string;
  artwork_url?: string;
  preview_artworks?: Array<string | null>;
  permalink_url?: string;
  track_count?: number;
  author: string;
  kind: 'playlist' | 'album';
  source: 'created' | 'liked';
  set_type?: string;
  release_date?: string;
}

interface CollectionDetails {
  id: number;
  title: string;
  artwork_url?: string;
  permalink_url?: string;
  set_type?: string;
  user?: {
    username: string;
    avatar_url?: string;
  };
  tracks: Track[];
}

interface RecentlyPlayedEntry {
  id: string;
  kind: 'playlist' | 'album' | 'release';
  title: string;
  artwork_url?: string;
  author: string;
  tracks: Track[];
}

interface PersistedPlayerState {
  currentTrack: Track | null;
  queue: Track[];
  playbackOrder: Track[];
  playbackIndex: number;
  currentTimeSec: number;
  volume: number;
  isShuffle: boolean;
  repeatMode: 'none' | 'all' | 'one';
  isPlaying: boolean;
  selectedCollection?: CollectionDetails | null;
  lastView?: 'home' | 'search' | 'liked' | 'library' | 'collection' | 'artist';
  autoplayEnabled?: boolean;
}

interface CachedStreamEntry {
  url: string;
  expiresAt: number | null;
}

interface TrackAvailabilityCacheEntry {
  status: 'available' | 'unavailable';
  checkedAt: number;
}

interface TrackContextMenuState {
  x: number;
  y: number;
  track: Track;
  sourceCollectionId?: number;
  sourceCollectionTitle?: string;
}

const TrackRow: React.FC<{
  track: Track;
  index: number;
  currentTrack: Track | null;
  isPlaying: boolean;
  isUnavailable?: boolean;
  isLiked: boolean;
  isLikePending: boolean;
  onPlay: () => void;
  onTogglePlay?: () => void;
  onArtistClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onToggleLike: (e: React.MouseEvent) => void;
}> = ({ track, index, currentTrack, isPlaying, isUnavailable = false, isLiked, isLikePending, onPlay, onTogglePlay, onArtistClick, onContextMenu, onToggleLike }) => {
  const formatDuration = (ms: number) => {
    if (!Number.isFinite(ms) || ms <= 0) return '0:00';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className={`flex items-center p-2 rounded-md transition-colors group ${
        isUnavailable
          ? 'opacity-45 cursor-default bg-transparent'
          : `cursor-pointer ${currentTrack?.id === track.id ? 'bg-white/10' : 'hover:bg-white/5'}`
      }`}
      onClick={isUnavailable ? undefined : onPlay}
      onContextMenu={isUnavailable ? undefined : onContextMenu}
    >
      <div className={`w-12 pr-2 text-gray-400 text-right ${isUnavailable ? '' : 'group-hover:hidden'}`}>
        {currentTrack?.id === track.id && isPlaying ? (
          <div className="flex items-end justify-end gap-0.5 h-3">
            <motion.div animate={{ height: [4, 12, 6, 10] }} transition={{ repeat: Infinity, duration: 1.1 }} className="w-0.5 accent-bg" />
            <motion.div animate={{ height: [8, 4, 12, 6] }} transition={{ repeat: Infinity, duration: 1.3 }} className="w-0.5 accent-bg" />
            <motion.div animate={{ height: [6, 10, 4, 12] }} transition={{ repeat: Infinity, duration: 1.05 }} className="w-0.5 accent-bg" />
          </div>
        ) : index + 1}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (isUnavailable) return;
          if (currentTrack?.id === track.id) {
            onTogglePlay?.();
            return;
          }
          onPlay();
        }}
        className={`w-12 pr-2 items-center justify-end ${isUnavailable ? 'hidden' : 'hidden group-hover:flex'}`}
      >
        {currentTrack?.id === track.id && isPlaying ? (
          <Pause size={16} className="fill-current" />
        ) : (
          <Play size={16} className="fill-current" />
        )}
      </button>

      {track.artwork_url ? (
        <img
          src={track.artwork_url.replace('large', 't500x500')}
          alt=""
          className="w-10 h-10 rounded mr-4 object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="w-10 h-10 rounded mr-4 bg-zinc-700/80" />
      )}

      <div className="flex-1 min-w-0 mr-4">
        <div className={`font-semibold truncate ${isUnavailable ? 'text-gray-500' : currentTrack?.id === track.id ? 'accent-text' : 'text-white'}`}>
          {track.title}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (isUnavailable) return;
            onArtistClick?.();
          }}
          className={`inline-block max-w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-left ${
            isUnavailable ? 'text-gray-500 cursor-default' : 'text-gray-400 hover:underline cursor-pointer'
          }`}
        >
          {track.metadata_artist || track.publisher_metadata?.artist || track.user.username}
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-4">
        <button
          onClick={onToggleLike}
          disabled={isLikePending || isUnavailable}
          className={`cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-40 ${
            isUnavailable
              ? 'text-gray-600'
              : isLiked ? 'opacity-100 accent-text' : 'text-gray-400 hover:text-white'
          }`}
        >
          <Heart size={16} className={isLiked ? 'fill-current' : ''} />
        </button>
        <div className="text-sm text-gray-400 w-12 text-right">
          {formatDuration(track.duration)}
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const PLAYER_STATE_STORAGE_KEY = 'sc_player_state_v1';
  const PLAYER_VOLUME_STORAGE_KEY = 'sc_player_volume_v1';
  const AUTOPLAY_ON_LAUNCH_KEY = 'sc_autoplay_on_launch_v1';
  const LEGACY_RESTORE_PLAYBACK_ON_LAUNCH_KEY = 'sc_restore_playback_on_launch_v1';
  const UNAVAILABLE_TRACKS_STORAGE_KEY = 'sc_unavailable_tracks_v2';
  const TRACK_AVAILABILITY_CACHE_STORAGE_KEY = 'sc_track_availability_cache_v2';
  const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  const apiUrl = (path: string) => `${API_BASE_URL}${path}`;
  const authCallbackUrl = API_BASE_URL ? `${API_BASE_URL}/auth/callback` : `${window.location.origin}/auth/callback`;

  const [searchQuery, setSearchQuery] = useState('');
  const [trendingTracks, setTrendingTracks] = useState<Track[]>([]);
  const [likedTracks, setLikedTracks] = useState<Track[]>([]);
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [user, setUser] = useState<any>(null);
  const [view, setView] = useState<'home' | 'search' | 'liked' | 'library' | 'collection' | 'artist'>('home');
  const [selectedCollection, setSelectedCollection] = useState<CollectionDetails | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<ArtistProfile | null>(null);
  const [artistTopTracks, setArtistTopTracks] = useState<Track[]>([]);
  const [artistCollections, setArtistCollections] = useState<LibraryItem[]>([]);
  const [showAllArtistTopTracks, setShowAllArtistTopTracks] = useState(false);
  const [artistMusicFilter, setArtistMusicFilter] = useState<'popular' | 'albums_ep' | 'singles_ep'>('popular');
  const [showAllArtistMusic, setShowAllArtistMusic] = useState(false);
  const [isArtistLoading, setIsArtistLoading] = useState(false);
  const [isLibraryLoading, setIsLibraryLoading] = useState(false);
  const [recentlyPlayed, setRecentlyPlayed] = useState<RecentlyPlayedEntry[]>([]);
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [seekDraftSec, setSeekDraftSec] = useState<number | null>(null);
  const [isSeeking, setIsSeeking] = useState(false);
  const [volume, setVolume] = useState(() => {
    const raw = localStorage.getItem('sc_player_volume_v1');
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return 0.6;
    return Math.max(0, Math.min(1, parsed));
  });
  const [isTimelineHovered, setIsTimelineHovered] = useState(false);
  const [isVolumeHovered, setIsVolumeHovered] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<'none' | 'all' | 'one'>('none');
  const [queue, setQueue] = useState<Track[]>([]);
  const [playbackOrder, setPlaybackOrder] = useState<Track[]>([]);
  const [playbackIndex, setPlaybackIndex] = useState(-1);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [pendingLikeTrackIds, setPendingLikeTrackIds] = useState<Set<number>>(new Set());
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [cacheResetNotice, setCacheResetNotice] = useState('');
  const [availabilityScanVersion, setAvailabilityScanVersion] = useState(0);
  const [confirmUnlikeTrack, setConfirmUnlikeTrack] = useState<Track | null>(null);
  const [confirmRemoveFromCollection, setConfirmRemoveFromCollection] = useState<{ collectionId: number; collectionTitle: string; track: Track } | null>(null);
  const [trackContextMenu, setTrackContextMenu] = useState<TrackContextMenuState | null>(null);
  const [openTrackSubmenu, setOpenTrackSubmenu] = useState<'playlist' | 'share' | null>(null);
  const [nativeSmtcState, setNativeSmtcState] = useState<'pending' | 'ready' | 'failed'>(() =>
    window.electronApp?.updateNativeSmtc ? 'pending' : 'failed'
  );
  const [autoplayOnLaunch, setAutoplayOnLaunch] = useState(() => {
    const next = localStorage.getItem(AUTOPLAY_ON_LAUNCH_KEY);
    if (next != null) return next === '1';
    const legacy = localStorage.getItem(LEGACY_RESTORE_PLAYBACK_ON_LAUNCH_KEY);
    return legacy === '1';
  });
  const [unavailableTrackIds, setUnavailableTrackIds] = useState<Set<number>>(() => {
    try {
      const raw = localStorage.getItem(UNAVAILABLE_TRACKS_STORAGE_KEY);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0));
    } catch {
      return new Set();
    }
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const trackMenuRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const lastNonZeroVolumeRef = useRef(0.6);
  const isSeekingRef = useRef(false);
  const isTrackSwitchingRef = useRef(false);
  const restorePlayerStateRef = useRef<PersistedPlayerState | null>(null);
  const didRestorePlayerStateRef = useRef(false);
  const mediaSwitchKeepAliveIntervalRef = useRef<number | null>(null);
  const mediaSwitchKeepAliveTimeoutRef = useRef<number | null>(null);
  const mediaSwitchKeepAliveStartedAtRef = useRef<number>(0);
  const streamUrlCacheRef = useRef<Map<number, CachedStreamEntry>>(new Map());
  const failedStreamFetchRef = useRef<Map<number, number>>(new Map());
  const sessionValidationPromiseRef = useRef<Promise<boolean> | null>(null);
  const trackAvailabilityCacheRef = useRef<Map<number, TrackAvailabilityCacheEntry>>(new Map());
  const availabilityCheckInFlightRef = useRef<Set<number>>(new Set());
  const availabilityRateLimitUntilRef = useRef(0);
  const MAX_AUDIO_VOLUME = 0.45;
  const userCountryCode = useMemo(() => {
    const locales = [navigator.language, ...(navigator.languages || [])].filter(Boolean);
    for (const locale of locales) {
      const match = String(locale).match(/-([A-Z]{2})$/i);
      if (match?.[1]) {
        return match[1].toUpperCase();
      }
    }

    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timeZoneToCountry: Record<string, string> = {
      'Europe/Kiev': 'UA',
      'Europe/Kyiv': 'UA',
      'Europe/Simferopol': 'UA',
      'Europe/Uzhgorod': 'UA',
      'Europe/Zaporozhye': 'UA',
      'Asia/Anadyr': 'RU',
      'Asia/Barnaul': 'RU',
      'Asia/Chita': 'RU',
      'Asia/Irkutsk': 'RU',
      'Asia/Kamchatka': 'RU',
      'Asia/Khandyga': 'RU',
      'Asia/Magadan': 'RU',
      'Asia/Novokuznetsk': 'RU',
      'Asia/Novosibirsk': 'RU',
      'Asia/Omsk': 'RU',
      'Asia/Sakhalin': 'RU',
      'Asia/Srednekolymsk': 'RU',
      'Asia/Tomsk': 'RU',
      'Asia/Ust-Nera': 'RU',
      'Asia/Vladivostok': 'RU',
      'Asia/Yakutsk': 'RU',
      'Asia/Yekaterinburg': 'RU',
      'Europe/Astrakhan': 'RU',
      'Europe/Kaliningrad': 'RU',
      'Europe/Kirov': 'RU',
      'Europe/Moscow': 'RU',
      'Europe/Samara': 'RU',
      'Europe/Saratov': 'RU',
      'Europe/Ulyanovsk': 'RU',
      'Europe/Volgograd': 'RU',
      'W-SU': 'RU',
      'Asia/Almaty': 'KZ',
      'Asia/Aqtau': 'KZ',
      'Asia/Aqtobe': 'KZ',
      'Asia/Atyrau': 'KZ',
      'Asia/Oral': 'KZ',
      'Asia/Qostanay': 'KZ',
      'Asia/Qyzylorda': 'KZ',
      'Europe/Minsk': 'BY',
      'Asia/Jerusalem': 'IL',
      'Asia/Tel_Aviv': 'IL',
      'Israel': 'IL',
      'UTC': 'US',
      'Etc/UTC': 'US',
      'Europe/Berlin': 'DE',
      'Europe/Busingen': 'DE',
      'Europe/Zurich': 'CH',
    };
    return timeZoneToCountry[timeZone] || null;
  }, []);

  const [isLoading, setIsLoading] = useState(true);
  const [isUserLoading, setIsUserLoading] = useState(true);

  useEffect(() => {
    isSeekingRef.current = isSeeking;
  }, [isSeeking]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(TRACK_AVAILABILITY_CACHE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      trackAvailabilityCacheRef.current = new Map(
        parsed
          .map((item: any) => {
            const trackId = Number(item?.[0]);
            const value = item?.[1];
            if (!Number.isFinite(trackId) || trackId <= 0) return null;
            if (value?.status !== 'available' && value?.status !== 'unavailable') return null;
            const checkedAt = Number(value?.checkedAt);
            if (!Number.isFinite(checkedAt) || checkedAt <= 0) return null;
            return [trackId, { status: value.status, checkedAt }] as const;
          })
          .filter(Boolean) as Array<readonly [number, TrackAvailabilityCacheEntry]>
      );
    } catch {
      trackAvailabilityCacheRef.current = new Map();
    }
  }, [TRACK_AVAILABILITY_CACHE_STORAGE_KEY]);

  const handleSessionExpired = useCallback(() => {
    setUser(null);
    setLikedTracks([]);
    setLibraryItems([]);
    setSelectedCollection(null);
    setSelectedArtist(null);
    setArtistTopTracks([]);
    setArtistCollections([]);
    setQueue([]);
    setIsQueueOpen(false);
    setPendingLikeTrackIds(new Set());
    setIsUserMenuOpen(false);
    setIsSettingsOpen(false);
  }, []);

  const parseTrack = (track: any): Track | null => {
    const id = Number(track?.id);
    const title = typeof track?.title === 'string' ? track.title.trim() : '';
    const duration = Number(track?.duration);
    const username = track?.user?.username || track?.metadata_artist || track?.publisher_metadata?.artist || '';

    if (!Number.isFinite(id) || id <= 0) return null;
    if (!title) return null;
    if (!Number.isFinite(duration) || duration <= 0) return null;

    return {
      id,
      title,
      metadata_artist: typeof track?.metadata_artist === 'string' ? track.metadata_artist : undefined,
      publisher_metadata: {
        artist: typeof track?.publisher_metadata?.artist === 'string' ? track.publisher_metadata?.artist : undefined
      },
      user: {
        id: Number.isFinite(Number(track?.user?.id)) ? Number(track.user.id) : undefined,
        username: username || 'Unknown',
        avatar_url: typeof track?.user?.avatar_url === 'string' ? track.user.avatar_url : undefined,
        permalink_url: typeof track?.user?.permalink_url === 'string' ? track.user.permalink_url : undefined
      },
      duration,
      artwork_url: typeof track?.artwork_url === 'string' ? track.artwork_url : undefined,
      permalink_url: typeof track?.permalink_url === 'string' ? track.permalink_url : undefined,
      media: Array.isArray(track?.media?.transcodings)
        ? {
            transcodings: track.media.transcodings
              .map((item: any) => ({
                url: typeof item?.url === 'string' ? item.url : '',
                format: {
                  protocol: typeof item?.format?.protocol === 'string' ? item.format.protocol : undefined,
                  mime_type: typeof item?.format?.mime_type === 'string' ? item.format.mime_type : undefined
                }
              }))
              .filter((item: { url: string }) => Boolean(item.url))
          }
        : undefined,
      playback_count: Number.isFinite(Number(track?.playback_count)) ? Number(track.playback_count) : 0,
      favoritings_count: Number.isFinite(Number(track?.favoritings_count)) ? Number(track.favoritings_count) : 0,
      comment_count: Number.isFinite(Number(track?.comment_count)) ? Number(track.comment_count) : 0,
      streamable: typeof track?.streamable === 'boolean' ? track.streamable : undefined,
      access: typeof track?.access === 'string' ? track.access : undefined,
      available_country_codes: Array.isArray(track?.available_country_codes)
        ? track.available_country_codes
            .map((value: any) => String(value || '').trim().toUpperCase())
            .filter(Boolean)
        : undefined
    };
  };

  const getTrackArtistName = (track: Track) =>
    track.metadata_artist || track.publisher_metadata?.artist || track.user.username;

  const getTrackArtistId = (track: Track) =>
    Number.isFinite(Number(track.user?.id)) ? Number(track.user?.id) : null;

  const getBannerUrl = (entity: any) => {
    const visuals = Array.isArray(entity?.visuals?.visuals) ? entity.visuals.visuals : [];
    const fromVisuals = visuals.find((item: any) => typeof item?.visual_url === 'string')?.visual_url;
    const fallback =
      entity?.banner_url ||
      entity?.header_image_url ||
      entity?.visual_url ||
      null;
    return typeof fromVisuals === 'string' ? fromVisuals : fallback;
  };

  const sanitizeTracks = (items: any[]): Track[] => {
    const seenIds = new Set<number>();
    const result: Track[] = [];
    for (const item of items) {
      const parsed = parseTrack(item);
      if (!parsed) continue;
      if (seenIds.has(parsed.id)) continue;
      seenIds.add(parsed.id);
      result.push(parsed);
    }
    return result;
  };

  const normalizeArtworkUrl = (value?: string | null) => {
    if (!value) return null;
    return value.replace('large', 't500x500');
  };

  const getCollectionArtworkSlots = (item: Pick<LibraryItem, 'artwork_url' | 'preview_artworks'>) => {
    const previews = Array.isArray(item.preview_artworks) ? item.preview_artworks.map((value) => normalizeArtworkUrl(value)) : [];
    const unique: string[] = [];
    for (const preview of previews) {
      if (!preview) continue;
      if (!unique.includes(preview)) {
        unique.push(preview);
      }
    }

    if (unique.length >= 4) {
      return unique.slice(0, 4);
    }
    if (unique.length > 0) {
      return [unique[0]];
    }

    if (item.artwork_url) {
      return [normalizeArtworkUrl(item.artwork_url)].filter(Boolean) as string[];
    }

    return [''];
  };

  const decodeBase64Url = (input: string) => {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    return atob(`${normalized}${padding}`);
  };

  const extractStreamExpiryMs = (streamUrl: string) => {
    try {
      const url = new URL(streamUrl);
      const expires = url.searchParams.get('expires');
      if (expires) {
        const epochSeconds = Number(expires);
        if (Number.isFinite(epochSeconds) && epochSeconds > 0) {
          return epochSeconds * 1000;
        }
      }

      const policy = url.searchParams.get('Policy');
      if (!policy) return null;

      const decoded = JSON.parse(decodeBase64Url(policy));
      const statements = Array.isArray(decoded?.Statement) ? decoded.Statement : [];
      for (const statement of statements) {
        const epochSeconds = Number(statement?.Condition?.DateLessThan?.['AWS:EpochTime']);
        if (Number.isFinite(epochSeconds) && epochSeconds > 0) {
          return epochSeconds * 1000;
        }
      }
    } catch {
      // ignore malformed signed url payloads
    }
    return null;
  };

  const getValidCachedStreamUrl = (trackId: number) => {
    const cached = streamUrlCacheRef.current.get(trackId);
    if (!cached) return '';
    if (cached.expiresAt && Date.now() >= cached.expiresAt - 60_000) {
      streamUrlCacheRef.current.delete(trackId);
      return '';
    }
    return cached.url;
  };

  const renderCollectionArtwork = (
    item: Pick<LibraryItem, 'artwork_url' | 'preview_artworks'>,
    className: string
  ) => {
    const slots = getCollectionArtworkSlots(item);
    if (slots.length >= 4) {
      return (
        <div className={`${className} grid grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden bg-zinc-800`}>
          {slots.slice(0, 4).map((slot, idx) =>
            slot ? (
              <img
                key={idx}
                src={slot}
                alt=""
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div key={idx} className="w-full h-full bg-zinc-700/80" />
            )
          )}
        </div>
      );
    }

    const single = slots[0];
    if (single) {
      return <img src={single} alt="" className={`${className} object-cover`} referrerPolicy="no-referrer" />;
    }

    return <div className={`${className} bg-zinc-700/80`} />;
  };

  const persistUnavailableTrackIds = useCallback((next: Set<number>) => {
    localStorage.setItem(UNAVAILABLE_TRACKS_STORAGE_KEY, JSON.stringify(Array.from(next)));
  }, [UNAVAILABLE_TRACKS_STORAGE_KEY]);

  const persistTrackAvailabilityCache = useCallback((cache: Map<number, TrackAvailabilityCacheEntry>) => {
    localStorage.setItem(
      TRACK_AVAILABILITY_CACHE_STORAGE_KEY,
      JSON.stringify(Array.from(cache.entries()))
    );
  }, [TRACK_AVAILABILITY_CACHE_STORAGE_KEY]);

  const updateUnavailableTrackIds = useCallback((updater: (prev: Set<number>) => Set<number>) => {
    setUnavailableTrackIds((prev) => {
      const next = updater(prev);
      const changed =
        next.size !== prev.size ||
        Array.from(next).some((id) => !prev.has(id)) ||
        Array.from(prev).some((id) => !next.has(id));
      if (!changed) {
        return prev;
      }
      persistUnavailableTrackIds(next);
      return next;
    });
  }, [persistUnavailableTrackIds]);

  const isTrackBlockedByMetadata = useCallback((track?: Track | null) => {
    if (!track) return false;
    if (
      userCountryCode &&
      Array.isArray(track.available_country_codes) &&
      track.available_country_codes.length > 0 &&
      !track.available_country_codes.includes(userCountryCode)
    ) {
      return true;
    }
    return false;
  }, [userCountryCode]);

  const isTrackUnavailable = useCallback((track?: Track | null) => {
    if (!track) return false;
    return isTrackBlockedByMetadata(track) || unavailableTrackIds.has(track.id);
  }, [isTrackBlockedByMetadata, unavailableTrackIds]);

  const markTrackUnavailable = useCallback((trackId: number) => {
    updateUnavailableTrackIds((prev) => {
      if (prev.has(trackId)) return prev;
      const next = new Set(prev);
      next.add(trackId);
      return next;
    });
  }, [updateUnavailableTrackIds]);

  const clearTrackUnavailable = useCallback((trackId: number) => {
    updateUnavailableTrackIds((prev) => {
      if (!prev.has(trackId)) return prev;
      const next = new Set(prev);
      next.delete(trackId);
      return next;
    });
  }, [updateUnavailableTrackIds]);

  const getCachedTrackAvailability = useCallback((trackId: number) => {
    const entry = trackAvailabilityCacheRef.current.get(trackId);
    if (!entry) return null;
    const ttlMs = entry.status === 'unavailable' ? 6 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - entry.checkedAt > ttlMs) {
      trackAvailabilityCacheRef.current.delete(trackId);
      persistTrackAvailabilityCache(trackAvailabilityCacheRef.current);
      return null;
    }
    return entry.status;
  }, [persistTrackAvailabilityCache]);

  const setCachedTrackAvailability = useCallback((trackId: number, status: 'available' | 'unavailable') => {
    trackAvailabilityCacheRef.current.set(trackId, {
      status,
      checkedAt: Date.now()
    });
    persistTrackAvailabilityCache(trackAvailabilityCacheRef.current);
    if (status === 'unavailable') {
      markTrackUnavailable(trackId);
    } else {
      clearTrackUnavailable(trackId);
    }
  }, [clearTrackUnavailable, markTrackUnavailable, persistTrackAvailabilityCache]);

  const resetLocalCaches = useCallback(() => {
    streamUrlCacheRef.current.clear();
    failedStreamFetchRef.current.clear();
    availabilityCheckInFlightRef.current.clear();
    availabilityRateLimitUntilRef.current = 0;
    trackAvailabilityCacheRef.current = new Map();
    setUnavailableTrackIds(new Set());
    setRecentlyPlayed([]);
    localStorage.removeItem(UNAVAILABLE_TRACKS_STORAGE_KEY);
    localStorage.removeItem(TRACK_AVAILABILITY_CACHE_STORAGE_KEY);
    localStorage.removeItem('sc_recently_played');
    localStorage.removeItem('sc_datadome_clientid');
    setAvailabilityScanVersion((prev) => prev + 1);
    setCacheResetNotice('Кэш сброшен');
    window.setTimeout(() => {
      setCacheResetNotice((prev) => (prev === 'Кэш сброшен' ? '' : prev));
    }, 2500);
  }, [TRACK_AVAILABILITY_CACHE_STORAGE_KEY, UNAVAILABLE_TRACKS_STORAGE_KEY]);

  const pushRecentlyPlayed = useCallback((entry: RecentlyPlayedEntry) => {
    setRecentlyPlayed((prev) => {
      const next = [entry, ...prev.filter((item) => item.id !== entry.id)].slice(0, 12);
      localStorage.setItem('sc_recently_played', JSON.stringify(next));
      return next;
    });
  }, []);

  const fetchWithAuthRetry = async (path: string, init: RequestInit = {}) => {
    const baseHeaders = (init.headers || {}) as Record<string, string>;
    const response = await fetch(apiUrl(path), {
      ...init,
      credentials: 'include',
      headers: baseHeaders
    });
    return response;
  };

  const verifySession = useCallback(async () => {
    if (sessionValidationPromiseRef.current) {
      return sessionValidationPromiseRef.current;
    }

    const validationPromise = (async () => {
      try {
        const response = await fetch(apiUrl('/api/me'), {
          credentials: 'include'
        });

        if (response.ok) {
          return true;
        }

        if (response.status === 401) {
          handleSessionExpired();
          return false;
        }

        return true;
      } catch (error) {
        console.error('Session validation error:', error);
        return true;
      } finally {
        sessionValidationPromiseRef.current = null;
      }
    })();

    sessionValidationPromiseRef.current = validationPromise;
    return validationPromise;
  }, [apiUrl, handleSessionExpired]);

  const fetchUser = async () => {
    setIsUserLoading(true);
    try {
      const response = await fetchWithAuthRetry('/api/me');
      if (response.ok) {
        const data = await response.json();
        try {
          const detailsResponse = await fetchWithAuthRetry(`/api/users/${data.id}`);
          if (detailsResponse.ok) {
            const details = await detailsResponse.json();
            setUser({ ...data, ...details });
          } else {
            setUser(data);
          }
        } catch {
          setUser(data);
        }
        fetchLikedSongs();
        fetchLibrary();
      } else if (response.status === 401) {
        await verifySession();
      }
    } catch (error) {
      console.error('User fetch error:', error);
    } finally {
      setIsUserLoading(false);
    }
  };

  const fetchLikedSongs = async () => {
    try {
      const response = await fetchWithAuthRetry('/api/me/favorites');
      if (response.status === 401) {
        await verifySession();
        return;
      }
      if (response.ok) {
        const data = await response.json();
        // Handle both direct array and collection formats
        let rawItems = Array.isArray(data) ? data : (data.collection || []);
        
        // Map items to tracks, filter, and de-duplicate
        const seenIds = new Set();
        const tracks = rawItems
          .map((item: any) => item.track || item)
          .filter((track: any) => {
            if (!track || !track.id || !track.title || seenIds.has(track.id)) return false;
            seenIds.add(track.id);
            return true;
          })
          .map((track: any) => parseTrack(track))
          .filter((track: Track | null): track is Track => Boolean(track));
          
        console.log(`Loaded ${tracks.length} unique liked tracks`);
        setLikedTracks(tracks);
      }
    } catch (error) {
      console.error('Liked songs error:', error);
    }
  };

  const fetchLibrary = async () => {
    setIsLibraryLoading(true);
    try {
      const response = await fetchWithAuthRetry('/api/me/library');
      if (response.status === 401) {
        await verifySession();
        return;
      }
      if (!response.ok) return;
      const data = await response.json();
      const items = Array.isArray(data.items) ? data.items : [];
      setLibraryItems(items);
    } catch (error) {
      console.error('Library fetch error:', error);
    } finally {
      setIsLibraryLoading(false);
    }
  };

  const openCollection = async (item: LibraryItem) => {
    try {
      const response = await fetchWithAuthRetry(`/api/me/collections/${item.id}`);
      if (response.status === 401) {
        await verifySession();
        return;
      }
      if (!response.ok) throw new Error('Failed to fetch collection');
      const collection = await response.json();
      const tracks = Array.isArray(collection.tracks) ? sanitizeTracks(collection.tracks) : [];
      const normalized: CollectionDetails = {
        ...collection,
        tracks
      };
      setSelectedCollection(normalized);
      setView('collection');
    } catch (error) {
      console.error('Open collection error:', error);
    }
  };

  const openArtistProfile = async (userId: number) => {
    if (!Number.isFinite(userId) || userId <= 0) return;
    setIsArtistLoading(true);
    setView('artist');
    try {
      const [profileResponse, tracksResponse, playlistsResponse] = await Promise.all([
        fetchWithAuthRetry(`/api/users/${userId}`),
        fetchWithAuthRetry(`/api/users/${userId}/tracks?limit=30`),
        fetchWithAuthRetry(`/api/users/${userId}/playlists?limit=30`)
      ]);

      if (!profileResponse.ok) {
        throw new Error('Failed to fetch artist profile');
      }

      const profile = await profileResponse.json();
      const tracksData = tracksResponse.ok ? await tracksResponse.json() : [];
      const playlistsData = playlistsResponse.ok ? await playlistsResponse.json() : [];

      const normalizedProfile: ArtistProfile = {
        id: Number(profile.id),
        username: profile.username || 'Unknown',
        permalink_url: profile.permalink_url,
        avatar_url: profile.avatar_url,
        description: profile.description,
        followers_count: Number(profile.followers_count) || 0,
        track_count: Number(profile.track_count) || 0,
        playlist_count: Number(profile.playlist_count) || 0,
        banner_url: getBannerUrl(profile)
      };

      const normalizedTracks = sanitizeTracks(Array.isArray(tracksData) ? tracksData : tracksData?.collection || [])
        .sort((a, b) => {
          const aScore = (a.playback_count || 0) * 100 + (a.favoritings_count || 0) * 20 + (a.comment_count || 0) * 5;
          const bScore = (b.playback_count || 0) * 100 + (b.favoritings_count || 0) * 20 + (b.comment_count || 0) * 5;
          return bScore - aScore;
        })
        .slice(0, 10);
      const normalizedCollections = (Array.isArray(playlistsData) ? playlistsData : playlistsData?.collection || [])
        .map((item: any) => ({
          id: Number(item?.id),
          title: String(item?.title || '').trim(),
          artwork_url: item?.artwork_url || undefined,
          preview_artworks: Array.isArray(item?.tracks)
            ? item.tracks.slice(0, 8).map((track: any) => track?.artwork_url || null)
            : [],
          permalink_url: item?.permalink_url || undefined,
          track_count: Number(item?.track_count) || 0,
          author: profile?.username || 'Unknown',
          kind: item?.set_type === 'album' ? 'album' : 'playlist',
          source: 'liked',
          set_type: item?.set_type || undefined,
          release_date: item?.release_date || item?.display_date || item?.published_at || item?.last_modified || item?.created_at || undefined
        }))
        .filter((item: LibraryItem) => Number.isFinite(item.id) && item.id > 0 && Boolean(item.title));

      setSelectedArtist(normalizedProfile);
      setArtistTopTracks(normalizedTracks);
      setArtistCollections(normalizedCollections);
      setShowAllArtistTopTracks(false);
      setArtistMusicFilter('popular');
      setShowAllArtistMusic(false);
    } catch (error) {
      console.error('Open artist error:', error);
      setSelectedArtist(null);
      setArtistTopTracks([]);
      setArtistCollections([]);
    } finally {
      setIsArtistLoading(false);
    }
  };

  const handleArtistClick = (track: Track) => {
    const artistId = getTrackArtistId(track);
    if (!artistId) return;
    openArtistProfile(artistId);
  };

  const getPlayableTracks = useCallback((tracks: Track[]) => tracks.filter((track) => !isTrackUnavailable(track)), [isTrackUnavailable]);

  const playSearchRelease = (track: Track, fromList: Track[]) => {
    if (isTrackUnavailable(track)) return;
    pushRecentlyPlayed({
      id: `release-${track.id}`,
      kind: 'release',
      title: track.title,
      artwork_url: track.artwork_url,
      author: track.metadata_artist || track.publisher_metadata?.artist || track.user.username,
      tracks: fromList
    });
    playTrack(track, fromList);
  };

  const playLikedSongs = (track: Track) => {
    if (isTrackUnavailable(track)) return;
    pushRecentlyPlayed({
      id: 'playlist-liked-songs',
      kind: 'playlist',
      title: 'Liked Songs',
      artwork_url: track.artwork_url,
      author: user?.username || 'User',
      tracks: likedTracks
    });
    playTrack(track, likedTracks);
  };

  const handlePlayRecent = (entry: RecentlyPlayedEntry) => {
    if (!entry.tracks || entry.tracks.length === 0) return;
    const playableTracks = getPlayableTracks(entry.tracks);
    if (playableTracks.length === 0) return;
    if (entry.kind === 'playlist' || entry.kind === 'album') {
      setSelectedCollection({
        id: Number(entry.id.split('-').pop() || 0),
        title: entry.title,
        artwork_url: entry.artwork_url,
        user: { username: entry.author },
        set_type: entry.kind,
        tracks: entry.tracks
      });
      setView('collection');
    }
    playTrack(playableTracks[0], playableTracks);
  };

  const handleLogin = async () => {
    try {
      const openerOrigin = window.location.origin === 'null' ? 'null' : window.location.origin;
      const response = await fetch(apiUrl(`/api/auth/url?openerOrigin=${encodeURIComponent(openerOrigin)}`), {
        credentials: 'include'
      });
      const { url } = await response.json();
      window.open(url, 'soundcloud_auth', 'width=600,height=700');
    } catch (error) {
      console.error('Login error:', error);
    }
  };

  const handleLogout = () => {
    setIsUserMenuOpen(false);
    setIsSettingsOpen(false);
    fetch(apiUrl('/api/auth/logout'), { method: 'POST', credentials: 'include' });
    setUser(null);
    setLikedTracks([]);
    setLibraryItems([]);
    setSelectedCollection(null);
    setView('home');
  };

  const handleCreatePlaylist = async () => {
    if (!user) {
      handleLogin();
      return;
    }

    const title = window.prompt('Название плейлиста');
    if (!title || !title.trim()) return;

    try {
      const response = await fetch(apiUrl('/api/me/playlists'), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ title: title.trim() })
      });
      if (response.status === 401) {
        await verifySession();
        return;
      }
      if (!response.ok) {
        throw new Error('Failed to create playlist');
      }

      const playlist = await response.json();
      const newItem: LibraryItem = {
        id: playlist.id,
        title: playlist.title,
        artwork_url: playlist.artwork_url,
        permalink_url: playlist.permalink_url,
        author: playlist.user?.username || user.username || 'You',
        kind: playlist.set_type === 'album' ? 'album' : 'playlist',
        source: 'created'
      };
      setLibraryItems((prev) => {
        if (prev.some((item) => item.id === newItem.id)) return prev;
        return [newItem, ...prev];
      });
    } catch (error) {
      console.error('Create playlist error:', error);
    }
  };

  const addTrackToPlaylist = async (playlistId: number, track: Track) => {
    if (!user) return;

    try {
      const response = await fetch(apiUrl(`/api/me/playlists/${playlistId}/tracks`), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ trackId: track.id })
      });

      if (response.status === 401) {
        await verifySession();
        return;
      }
      if (!response.ok) {
        throw new Error('Failed to add track to playlist');
      }
    } catch (error) {
      console.error('Add track to playlist error:', error);
    }
  };

  const removeTrackFromCollection = async (collectionId: number, track: Track) => {
    if (!user) return;

    const prevCollection = selectedCollection;
    if (selectedCollection && selectedCollection.id === collectionId) {
      setSelectedCollection({
        ...selectedCollection,
        tracks: selectedCollection.tracks.filter((item) => item.id !== track.id)
      });
    }

    try {
      const response = await fetch(apiUrl(`/api/me/playlists/${collectionId}/tracks/${track.id}`), {
        method: 'DELETE',
        credentials: 'include'
      });

      if (response.status === 401) {
        await verifySession();
        return;
      }
      if (!response.ok) {
        throw new Error('Failed to remove track from playlist');
      }
    } catch (error) {
      console.error('Remove track from playlist error:', error);
      if (prevCollection && prevCollection.id === collectionId) {
        setSelectedCollection(prevCollection);
      }
    }
  };

  const handleCopyTrackTitleArtist = async (track: Track) => {
    const text = `${getTrackArtistName(track)} - ${track.title}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error('Clipboard write failed:', error);
    }
  };

  const handleCopyTrackLink = async (track: Track) => {
    const text = track.permalink_url || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error('Clipboard write failed:', error);
    }
  };

  const addToQueueNext = (track: Track) => {
    if (isTrackUnavailable(track)) return;
    if (!currentTrack) {
      setQueue([track]);
      setPlaybackOrder([track]);
      setPlaybackIndex(0);
      void playTrack(track, [track]);
      return;
    }

    if (playbackOrder.length > 0) {
      const activeIndex = Math.max(0, playbackIndex);
      const nextOrder = [...playbackOrder];
      nextOrder.splice(activeIndex + 1, 0, track);
      setPlaybackOrder(nextOrder);
    }

    const sourceQueue = queue.length > 0 ? queue : playbackOrder;
    if (sourceQueue.length > 0) {
      const currentIndexInQueue = sourceQueue.findIndex((item) => item.id === currentTrack.id);
      const insertIndex = currentIndexInQueue >= 0 ? currentIndexInQueue + 1 : sourceQueue.length;
      const nextQueue = [...sourceQueue];
      nextQueue.splice(insertIndex, 0, track);
      setQueue(nextQueue);
    } else {
      setQueue(isTrackUnavailable(currentTrack) ? [track] : [currentTrack, track]);
    }
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        fetchUser();
      }
    };
    window.addEventListener('message', handleMessage);
    try {
      const savedRecentlyPlayed = localStorage.getItem('sc_recently_played');
      if (savedRecentlyPlayed) {
        const parsed = JSON.parse(savedRecentlyPlayed);
        if (Array.isArray(parsed)) {
          const normalized = parsed
            .map((entry: any) => ({
              id: String(entry?.id || ''),
              kind: entry?.kind === 'album' || entry?.kind === 'playlist' || entry?.kind === 'release' ? entry.kind : 'release',
              title: String(entry?.title || '').trim(),
              artwork_url: entry?.artwork_url ? String(entry.artwork_url) : undefined,
              author: String(entry?.author || '').trim(),
              tracks: sanitizeTracks(Array.isArray(entry?.tracks) ? entry.tracks : [])
            }))
            .filter((entry: RecentlyPlayedEntry) => entry.id && entry.title && entry.author && entry.tracks.length > 0);
          setRecentlyPlayed(normalized);
        }
      }

      const savedPlayerState = localStorage.getItem(PLAYER_STATE_STORAGE_KEY);
      if (savedPlayerState) {
        const parsedPlayer = JSON.parse(savedPlayerState) as Partial<PersistedPlayerState>;
        const restoredQueue = sanitizeTracks(Array.isArray(parsedPlayer.queue) ? parsedPlayer.queue : []);
        const restoredOrder = sanitizeTracks(Array.isArray(parsedPlayer.playbackOrder) ? parsedPlayer.playbackOrder : []);
        const restoredCurrentTrack = parseTrack(parsedPlayer.currentTrack);
        const resolvedCurrentTrack = restoredCurrentTrack || restoredOrder[0] || restoredQueue[0] || null;

        const playableQueue = getPlayableTracks(restoredQueue);
        const playableOrder = getPlayableTracks(restoredOrder);

        const restoredPlaybackIndex = resolvedCurrentTrack
          ? playableOrder.findIndex((item) => item.id === resolvedCurrentTrack.id)
          : -1;

        const restoredState: PersistedPlayerState = {
          currentTrack: resolvedCurrentTrack,
          queue: playableQueue,
          playbackOrder: playableOrder,
          playbackIndex: restoredPlaybackIndex >= 0
            ? restoredPlaybackIndex
            : Number.isFinite(Number(parsedPlayer.playbackIndex)) ? Number(parsedPlayer.playbackIndex) : -1,
          currentTimeSec: Number.isFinite(Number(parsedPlayer.currentTimeSec)) ? Number(parsedPlayer.currentTimeSec) : 0,
          volume: Number.isFinite(Number(parsedPlayer.volume)) ? Math.max(0, Math.min(1, Number(parsedPlayer.volume))) : 0.6,
          isShuffle: Boolean(parsedPlayer.isShuffle),
          repeatMode: parsedPlayer.repeatMode === 'all' || parsedPlayer.repeatMode === 'one' ? parsedPlayer.repeatMode : 'none',
          isPlaying: autoplayOnLaunch ? Boolean(parsedPlayer.isPlaying) : false,
          selectedCollection: parsedPlayer.selectedCollection || null,
          lastView:
            parsedPlayer.lastView === 'search' ||
            parsedPlayer.lastView === 'liked' ||
            parsedPlayer.lastView === 'library' ||
            parsedPlayer.lastView === 'collection' ||
            parsedPlayer.lastView === 'artist'
              ? parsedPlayer.lastView
              : 'home',
          autoplayEnabled: autoplayOnLaunch
        };

        restorePlayerStateRef.current = restoredState;
        setCurrentTrack(restoredState.currentTrack);
        setCurrentTimeSec(Math.max(0, restoredState.currentTimeSec));
        setProgress(0);
        setDurationSec(
          restoredState.currentTrack
            ? Math.max(0, Math.floor(restoredState.currentTrack.duration / 1000))
            : 0
        );
        setVolume(restoredState.volume);
        setIsShuffle(restoredState.isShuffle);
        setRepeatMode(restoredState.repeatMode);
        setQueue(restoredState.queue);
        setPlaybackOrder(restoredState.playbackOrder);
        setPlaybackIndex(restoredState.playbackIndex);
        if (restoredState.selectedCollection) {
          setSelectedCollection(restoredState.selectedCollection);
        }
        if (restoredState.lastView) {
          setView(restoredState.lastView);
        }
      }
    } catch (error) {
      console.error('Recently played parse error:', error);
    }
    fetchUser();
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (userMenuRef.current && !userMenuRef.current.contains(target)) {
        setIsUserMenuOpen(false);
      }
      if (trackContextMenu && trackMenuRef.current && !trackMenuRef.current.contains(target)) {
        setTrackContextMenu(null);
        setOpenTrackSubmenu(null);
      }
    };
    window.addEventListener('mousedown', closeOnOutsideClick);
    return () => window.removeEventListener('mousedown', closeOnOutsideClick);
  }, [trackContextMenu]);

  useEffect(() => {
    localStorage.setItem(AUTOPLAY_ON_LAUNCH_KEY, autoplayOnLaunch ? '1' : '0');
  }, [AUTOPLAY_ON_LAUNCH_KEY, autoplayOnLaunch]);

  useEffect(() => {
    const fetchTrending = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(apiUrl('/api/trending'));
        if (!response.ok) throw new Error('Failed to fetch trending');
        const data = await response.json();
        // Charts collection has item.track, search collection has track directly
        const tracks = sanitizeTracks((data.collection || []).map((item: any) => item.track || item));
        setTrendingTracks(tracks);
      } catch (error) {
        console.error('Trending error:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchTrending();
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery) return;
    setView('search');
    
    try {
      const response = await fetch(apiUrl(`/api/search?q=${encodeURIComponent(searchQuery)}`));
      const data = await response.json();
      setSearchResults(sanitizeTracks(data.collection || []));
    } catch (error) {
      console.error('Search error:', error);
    }
  };

  const stopMediaSwitchKeepAlive = useCallback(() => {
    if (mediaSwitchKeepAliveIntervalRef.current !== null) {
      window.clearInterval(mediaSwitchKeepAliveIntervalRef.current);
      mediaSwitchKeepAliveIntervalRef.current = null;
    }
    if (mediaSwitchKeepAliveTimeoutRef.current !== null) {
      window.clearTimeout(mediaSwitchKeepAliveTimeoutRef.current);
      mediaSwitchKeepAliveTimeoutRef.current = null;
    }
    mediaSwitchKeepAliveStartedAtRef.current = 0;
  }, []);

  const getStreamUrlForTrack = useCallback(async (trackOrId: number | Track, options?: { force?: boolean; background?: boolean }) => {
    const track = typeof trackOrId === 'number' ? null : trackOrId;
    const trackId = typeof trackOrId === 'number' ? trackOrId : trackOrId.id;
    const isBackgroundCheck = options?.background === true;
    const cached = !options?.force ? getValidCachedStreamUrl(trackId) : '';
    if (cached) return cached;

    if (isBackgroundCheck && availabilityRateLimitUntilRef.current > Date.now()) {
      return '';
    }

    const force = options?.force === true;
    const failedAt = failedStreamFetchRef.current.get(trackId);
    const retryCooldownMs = 5 * 60 * 1000;
    if (!force && failedAt && Date.now() - failedAt < retryCooldownMs) {
      return '';
    }

    const transcodings = track?.media?.transcodings || [];
    const preferredTranscoding = transcodings.find((item) => item?.format?.protocol === 'progressive' && item.url)
      || transcodings.find((item) => item?.format?.protocol === 'hls' && item.url);

    if (preferredTranscoding?.url) {
      const transcodingResponse = await fetch(
        apiUrl(`/api/stream/transcoding?url=${encodeURIComponent(preferredTranscoding.url)}`),
        {
          credentials: 'include',
          cache: 'no-store'
        }
      );
      if (transcodingResponse.status === 429) {
        availabilityRateLimitUntilRef.current = Date.now() + 15 * 60 * 1000;
        failedStreamFetchRef.current.set(trackId, Date.now());
        return '';
      }
      if (transcodingResponse.ok) {
        const data = await transcodingResponse.json();
        const url = typeof data?.url === 'string' ? data.url : '';
        if (url) {
          failedStreamFetchRef.current.delete(trackId);
          setCachedTrackAvailability(trackId, 'available');
          streamUrlCacheRef.current.set(trackId, {
            url,
            expiresAt: extractStreamExpiryMs(url)
          });
          return url;
        }
      }
    }

    const response = await fetch(apiUrl(`/api/stream/${trackId}`), {
      credentials: 'include',
      cache: 'no-store'
    });
    if (!response.ok) {
      if (response.status === 429) {
        availabilityRateLimitUntilRef.current = Date.now() + 15 * 60 * 1000;
      }
      if (response.status === 403 || response.status === 404) {
        setCachedTrackAvailability(trackId, 'unavailable');
      }
      failedStreamFetchRef.current.set(trackId, Date.now());
      return '';
    }

    const data = await response.json();
    const url = typeof data?.url === 'string' ? data.url : '';
    if (url) {
      failedStreamFetchRef.current.delete(trackId);
      setCachedTrackAvailability(trackId, 'available');
      streamUrlCacheRef.current.set(trackId, {
        url,
        expiresAt: extractStreamExpiryMs(url)
      });
    } else {
      failedStreamFetchRef.current.set(trackId, Date.now());
    }
    return url;
  }, [apiUrl, setCachedTrackAvailability]);

  const prefetchTrackStream = useCallback((track?: Track | null) => {
    if (!track?.id) return;
    if (isTrackUnavailable(track)) return;
    if (streamUrlCacheRef.current.has(track.id)) return;
    void getStreamUrlForTrack(track).catch(() => {
      // ignore prefetch failures
    });
  }, [getStreamUrlForTrack, isTrackUnavailable]);

  const playTrack = useCallback(async (track: Track, fromList?: Track[]) => {
    if (isTrackUnavailable(track)) {
      setIsPlaying(false);
      return;
    }
    didRestorePlayerStateRef.current = true;
    restorePlayerStateRef.current = null;
    isTrackSwitchingRef.current = true;

    const playableFromList = fromList ? getPlayableTracks(fromList) : undefined;
    const sourceQueue = playableFromList || getPlayableTracks(queue);
    if (fromList) {
      setQueue(playableFromList || []);
      if (isShuffle) {
        const rest = (playableFromList || []).filter((item) => item.id !== track.id);
        for (let i = rest.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        const nextOrder = [track, ...rest];
        setPlaybackOrder(nextOrder);
        setPlaybackIndex(0);
      } else {
        setPlaybackOrder(playableFromList || []);
        setPlaybackIndex(Math.max(0, (playableFromList || []).findIndex((item) => item.id === track.id)));
      }
    } else if (sourceQueue.length > 0 && playbackOrder.length === 0) {
      setPlaybackOrder(sourceQueue);
      setPlaybackIndex(Math.max(0, sourceQueue.findIndex((item) => item.id === track.id)));
    }
    try {
      const url = await getStreamUrlForTrack(track, { force: true });
      if (url) {
        if (audioRef.current) {
          audioRef.current.src = url;
          audioRef.current.currentTime = 0;
          setCurrentTimeSec(0);
          setProgress(0);
          setDurationSec(Math.max(0, Math.floor(track.duration / 1000)));
          void audioRef.current.play().finally(() => {
            isTrackSwitchingRef.current = false;
            stopMediaSwitchKeepAlive();
          });
          setCurrentTrack(track);
        } else {
          isTrackSwitchingRef.current = false;
          stopMediaSwitchKeepAlive();
          setIsPlaying(false);
        }
      } else {
        isTrackSwitchingRef.current = false;
        stopMediaSwitchKeepAlive();
        setIsPlaying(false);
      }
    } catch (error) {
      console.error('Playback error:', error);
      isTrackSwitchingRef.current = false;
      stopMediaSwitchKeepAlive();
      setIsPlaying(false);
    }
  }, [queue, isShuffle, playbackOrder.length, stopMediaSwitchKeepAlive, getStreamUrlForTrack, isTrackUnavailable, getPlayableTracks]);

  const primeMediaSessionForSwitch = useCallback((track: Track) => {
    if (nativeSmtcState === 'ready') return;
    if (!('mediaSession' in navigator)) return;
    stopMediaSwitchKeepAlive();

    const duration = Math.max(1, Math.floor(track.duration / 1000));
    mediaSwitchKeepAliveStartedAtRef.current = Date.now();
    const apply = (elapsedSec?: number) => {
      const safeElapsed = Number.isFinite(Number(elapsedSec))
        ? Math.max(0, Math.min(duration - 0.05, Number(elapsedSec)))
        : 0;
      try {
        navigator.mediaSession.playbackState = 'playing';
        navigator.mediaSession.setPositionState({
          duration,
          position: safeElapsed,
          playbackRate: 1
        });
      } catch {
        // ignore
      }
    };

    try {
      const artworkBase = track.artwork_url?.replace('large', 't500x500') || track.artwork_url || '';
      const artwork = artworkBase
        ? [
            { src: artworkBase, sizes: '96x96', type: 'image/jpeg' },
            { src: artworkBase, sizes: '192x192', type: 'image/jpeg' },
            { src: artworkBase, sizes: '512x512', type: 'image/jpeg' }
          ]
        : [];

      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || 'Unknown track',
        artist: getTrackArtistName(track) || 'Unknown artist',
        album: selectedCollection?.title || 'Soundtify',
        artwork
      });
      apply(0);

      // Aggressive keep-alive while next stream URL is loading, to reduce SMTC focus jumps.
      mediaSwitchKeepAliveIntervalRef.current = window.setInterval(() => {
        const elapsed = (Date.now() - mediaSwitchKeepAliveStartedAtRef.current) / 1000;
        apply(elapsed);
      }, 200);
      mediaSwitchKeepAliveTimeoutRef.current = window.setTimeout(() => {
        stopMediaSwitchKeepAlive();
      }, 3500);
    } catch {
      // ignore
    }
  }, [selectedCollection?.title, stopMediaSwitchKeepAlive, nativeSmtcState]);

  const playNext = useCallback(() => {
    const source = playbackOrder.length > 0 ? playbackOrder : queue;
    if (!currentTrack || source.length === 0) return;

    const activeIndex = playbackOrder.length > 0
      ? playbackIndex
      : source.findIndex((t) => t.id === currentTrack.id);

    let nextIndex = activeIndex;
    for (let steps = 0; steps < source.length; steps++) {
      nextIndex += 1;
      if (nextIndex >= source.length) {
        if (repeatMode === 'all') {
          if (isShuffle && queue.length > 0) {
            const rest = queue.filter((item) => item.id !== currentTrack.id);
            for (let i = rest.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [rest[i], rest[j]] = [rest[j], rest[i]];
            }
            const nextOrder = [currentTrack, ...rest];
            setPlaybackOrder(nextOrder);
            const nextPlayableIndex = nextOrder.findIndex((item, index) => index > 0 && !isTrackUnavailable(item));
            if (nextPlayableIndex > 0) {
              setPlaybackIndex(nextPlayableIndex);
              primeMediaSessionForSwitch(nextOrder[nextPlayableIndex]);
              playTrack(nextOrder[nextPlayableIndex]);
            }
            return;
          }
          nextIndex = 0;
        } else {
          return;
        }
      }
      const candidate = source[nextIndex];
      if (!candidate || isTrackUnavailable(candidate)) {
        continue;
      }
      primeMediaSessionForSwitch(candidate);
      if (playbackOrder.length > 0) {
        setPlaybackIndex(nextIndex);
      }
      playTrack(candidate);
      return;
    }
  }, [currentTrack, queue, isShuffle, repeatMode, playTrack, playbackOrder, playbackIndex, primeMediaSessionForSwitch, isTrackUnavailable]);

  const playPrevious = () => {
    const source = playbackOrder.length > 0 ? playbackOrder : queue;
    if (!currentTrack || source.length === 0) return;
    const activeIndex = playbackOrder.length > 0
      ? playbackIndex
      : source.findIndex((t) => t.id === currentTrack.id);
    let prevIndex = activeIndex;

    for (let steps = 0; steps < source.length; steps++) {
      prevIndex -= 1;
      if (prevIndex < 0) {
        if (repeatMode === 'all') {
          prevIndex = source.length - 1;
        } else {
          prevIndex = 0;
        }
      }
      const candidate = source[prevIndex];
      if (!candidate || isTrackUnavailable(candidate)) {
        if (prevIndex === 0 && repeatMode !== 'all') {
          return;
        }
        continue;
      }
      if (playbackOrder.length > 0) {
        setPlaybackIndex(prevIndex);
      }
      primeMediaSessionForSwitch(candidate);
      playTrack(candidate);
      return;
    }
  };

  const handlePlayNext = useCallback(() => {
    playNext();
  }, [playNext]);

  const handlePlayPrevious = useCallback(() => {
    playPrevious();
  }, [playPrevious]);

  const getAvailabilityCandidates = useCallback(() => {
    const dedupedTracks = new Map<number, Track>();

    const addTracks = (tracks: Array<Track | null | undefined>, limit?: number) => {
      let added = 0;
      for (const track of tracks) {
        if (!track?.id || dedupedTracks.has(track.id)) {
          continue;
        }
        dedupedTracks.set(track.id, track);
        added += 1;
        if (limit && added >= limit) {
          break;
        }
      }
    };

    if (currentTrack) {
      addTracks([currentTrack]);
    }

    const playbackSource = playbackOrder.length > 0 ? playbackOrder : queue;
    const activeIndex = playbackOrder.length > 0
      ? playbackIndex
      : currentTrack
        ? playbackSource.findIndex((track) => track.id === currentTrack.id)
        : 0;
    const safeIndex = activeIndex >= 0 ? activeIndex : 0;

    addTracks(playbackSource.slice(Math.max(0, safeIndex - 2), safeIndex + 10));

    if (view === 'collection') {
      addTracks(selectedCollection?.tracks || []);
    } else if (view === 'search') {
      addTracks(searchResults);
    } else if (view === 'artist') {
      addTracks(artistTopTracks);
    } else if (view === 'liked') {
      addTracks(likedTracks, 120);
    } else {
      addTracks(trendingTracks);
    }

    return Array.from(dedupedTracks.values());
  }, [
    artistTopTracks,
    currentTrack,
    likedTracks,
    playbackIndex,
    playbackOrder,
    queue,
    searchResults,
    selectedCollection?.tracks,
    trendingTracks,
    view
  ]);

  useEffect(() => {
    const unsubscribe = window.electronApp?.onNativeSmtcStatus?.((payload) => {
      if (payload?.ready) {
        setNativeSmtcState('ready');
        return;
      }
      if (payload?.failed) {
        setNativeSmtcState('failed');
      }
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const knownTracks = getAvailabilityCandidates();

    updateUnavailableTrackIds((prev) => {
      const next = new Set(prev);
      const dedupedTracks = new Map<number, Track>();
      for (const track of knownTracks) {
        dedupedTracks.set(track.id, track);
      }
      for (const track of dedupedTracks.values()) {
        if (isTrackBlockedByMetadata(track)) {
          next.add(track.id);
          trackAvailabilityCacheRef.current.set(track.id, {
            status: 'unavailable',
            checkedAt: Date.now()
          });
          continue;
        }

        const cachedStatus = getCachedTrackAvailability(track.id);
        if (cachedStatus === 'unavailable') {
          next.add(track.id);
        } else if (cachedStatus === 'available') {
          next.delete(track.id);
        }
      }
      persistTrackAvailabilityCache(trackAvailabilityCacheRef.current);
      return next;
    });
  }, [getAvailabilityCandidates, getCachedTrackAvailability, isTrackBlockedByMetadata, persistTrackAvailabilityCache, updateUnavailableTrackIds]);

  useEffect(() => {
    if (availabilityRateLimitUntilRef.current > Date.now()) {
      return;
    }

    const pendingTracks = getAvailabilityCandidates().filter((track) => {
      if (!track?.id) return false;
      if (isTrackBlockedByMetadata(track)) return false;
      if (getCachedTrackAvailability(track.id)) return false;
      if (availabilityCheckInFlightRef.current.has(track.id)) return false;
      return true;
    });

    if (pendingTracks.length === 0) {
      return;
    }

    let cancelled = false;
    const parallelChecks = Math.min(2, pendingTracks.length);

    const runChecks = async () => {
      let nextIndex = 0;

      const worker = async () => {
        while (!cancelled) {
          if (availabilityRateLimitUntilRef.current > Date.now()) {
            return;
          }

          const track = pendingTracks[nextIndex++];
          if (!track) {
            return;
          }

          availabilityCheckInFlightRef.current.add(track.id);
          try {
            await getStreamUrlForTrack(track, { background: true });
          } catch {
            // Ignore individual background availability failures.
          } finally {
            availabilityCheckInFlightRef.current.delete(track.id);
          }
        }
      };

      await Promise.allSettled(
        Array.from({ length: parallelChecks }, () => worker())
      );
    };

    void runChecks();

    return () => {
      cancelled = true;
    };
  }, [availabilityScanVersion, getAvailabilityCandidates, getCachedTrackAvailability, getStreamUrlForTrack, isTrackBlockedByMetadata]);

  useEffect(() => {
    const source = playbackOrder.length > 0 ? playbackOrder : queue;
    if (!currentTrack || source.length === 0) return;

    const activeIndex = playbackOrder.length > 0
      ? playbackIndex
      : source.findIndex((track) => track.id === currentTrack.id);
    if (activeIndex < 0) return;

    const nextTrack = source[activeIndex + 1];
    const prevTrack = source[activeIndex - 1];
    prefetchTrackStream(nextTrack);
    prefetchTrackStream(prevTrack);
  }, [currentTrack, playbackOrder, queue, playbackIndex, prefetchTrackStream]);

  useEffect(() => {
    const unsubscribe = window.electronApp?.onNativeSmtcAction?.((action) => {
      if (action === 'next') {
        handlePlayNext();
        return;
      }
      if (action === 'previous') {
        handlePlayPrevious();
        return;
      }
      if (action === 'play') {
        if (!isPlaying) {
          togglePlay();
        }
        return;
      }
      if (action === 'pause' || action === 'stop') {
        if (isPlaying) {
          togglePlay();
        }
      }
    });
    return () => {
      unsubscribe?.();
    };
  }, [handlePlayNext, handlePlayPrevious, isPlaying]);

  const handleQueueSelect = (track: Track) => {
    const source = playbackOrder.length > 0 ? playbackOrder : queue;
    const selectedIndex = source.findIndex((item) => item.id === track.id);
    if (playbackOrder.length > 0 && selectedIndex >= 0) {
      setPlaybackIndex(selectedIndex);
    }
    playTrack(track);
  };

  const toggleLike = async (track: Track, options?: { skipUnlikeConfirm?: boolean }) => {
    if (!user) return;

    if (pendingLikeTrackIds.has(track.id)) return;

    const isLiked = likedTracks.some((t) => t.id === track.id);
    if (isLiked && !options?.skipUnlikeConfirm) {
      setConfirmUnlikeTrack(track);
      return;
    }
    setPendingLikeTrackIds((prev) => {
      const next = new Set(prev);
      next.add(track.id);
      return next;
    });

    setLikedTracks((prev) => {
      if (isLiked) {
        return prev.filter((t) => t.id !== track.id);
      }

      if (prev.some((t) => t.id === track.id)) {
        return prev;
      }

      return [track, ...prev];
    });

    try {
      const datadomeClientId = localStorage.getItem('sc_datadome_clientid');
      const response = await fetch(apiUrl(`/api/me/favorites/${track.id}`), {
        method: isLiked ? 'DELETE' : 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(datadomeClientId ? { 'X-Datadome-ClientId': datadomeClientId } : {})
        },
        body: JSON.stringify({ userId: user.id })
      });

      if (response.status === 401) {
        throw new Error('UNAUTHORIZED');
      }

      if (!response.ok) {
        throw new Error('Failed to toggle like');
      }
    } catch (error) {
      console.error('Toggle like error:', error);
      if ((error as Error).message === 'UNAUTHORIZED') {
        await verifySession();
      }
      setLikedTracks((prev) => {
        if (isLiked) {
          if (prev.some((t) => t.id === track.id)) {
            return prev;
          }
          return [track, ...prev];
        }
        return prev.filter((t) => t.id !== track.id);
      });
    } finally {
      setPendingLikeTrackIds((prev) => {
        const next = new Set(prev);
        next.delete(track.id);
        return next;
      });
    }
  };

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        void audioRef.current.play();
      }
    }
  };

  const toggleMute = () => {
    if (volume > 0) {
      lastNonZeroVolumeRef.current = volume;
      setVolume(0);
      return;
    }

    const restored = lastNonZeroVolumeRef.current > 0 ? lastNonZeroVolumeRef.current : 0.6;
    setVolume(Math.max(0, Math.min(1, restored)));
  };

  const adjustVolumeByStep = useCallback((delta: number) => {
    setVolume((prev) => {
      const next = Math.max(0, Math.min(1, prev + delta));
      return Number(next.toFixed(4));
    });
  }, []);

  const cycleRepeatMode = useCallback(() => {
    setRepeatMode((prev) => prev === 'none' ? 'all' : prev === 'all' ? 'one' : 'none');
  }, []);

  const toggleShuffleMode = useCallback(() => {
    setIsShuffle((prev) => !prev);
  }, []);

  const focusSearch = useCallback(() => {
    setView('search');
    window.setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 0);
  }, []);

  const reloadApplication = useCallback(() => {
    window.location.reload();
  }, []);

  const seekByStep = useCallback((deltaSec: number) => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    const rawDuration = Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : (Number.isFinite(durationSec) ? durationSec : currentTrack.duration / 1000);
    const safeDuration = Math.max(0, rawDuration || 0);
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : currentTimeSec;

    let nextTime = current;
    if (deltaSec > 0) {
      const maxForwardTime = safeDuration > 1 ? Math.max(0, safeDuration - 1) : safeDuration;
      nextTime = Math.min(current + deltaSec, maxForwardTime);
    } else {
      nextTime = Math.max(0, current + deltaSec);
    }

    audio.currentTime = nextTime;
    setCurrentTimeSec(nextTime);
    setProgress(safeDuration > 0 ? (nextTime / safeDuration) * 100 : 0);
  }, [currentTimeSec, currentTrack, durationSec]);

  const handleKeyboardPrevious = useCallback(() => {
    const audio = audioRef.current;
    if (!currentTrack || !audio) return;

    const activeTime = Number.isFinite(audio.currentTime) ? audio.currentTime : currentTimeSec;
    if (activeTime > 5) {
      audio.currentTime = 0;
      setCurrentTimeSec(0);
      setProgress(0);
      return;
    }

    handlePlayPrevious();
  }, [currentTimeSec, currentTrack, handlePlayPrevious]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      const tagName = element.tagName;
      return element.isContentEditable ||
        tagName === 'INPUT' ||
        tagName === 'TEXTAREA' ||
        tagName === 'SELECT';
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.key === ' ' && !event.ctrlKey && !event.altKey && !event.metaKey && currentTrack) {
        event.preventDefault();
        togglePlay();
        return;
      }

      if (!event.ctrlKey && !event.altKey && !event.metaKey && event.shiftKey) {
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          seekByStep(5);
          return;
        }

        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          seekByStep(-5);
          return;
        }
      }

      if (!event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }

      if (event.key.toLowerCase() === 's' && !event.shiftKey) {
        event.preventDefault();
        toggleShuffleMode();
        return;
      }

      if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        if (event.shiftKey) {
          reloadApplication();
        } else {
          cycleRepeatMode();
        }
        return;
      }

      if (event.key.toLowerCase() === 'l' && !event.shiftKey) {
        event.preventDefault();
        focusSearch();
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        handlePlayNext();
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        handleKeyboardPrevious();
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        adjustVolumeByStep(0.06);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        adjustVolumeByStep(-0.06);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [
    adjustVolumeByStep,
    currentTrack,
    cycleRepeatMode,
    focusSearch,
    handleKeyboardPrevious,
    handlePlayNext,
    reloadApplication,
    seekByStep,
    togglePlay,
    toggleShuffleMode
  ]);

  const handleSeekChange = (nextValue: number) => {
    if (!Number.isFinite(nextValue)) return;
    setIsSeeking(true);
    setSeekDraftSec(nextValue);
  };

  const commitSeek = () => {
    const nextValue = seekDraftSec;
    if (nextValue === null) {
      setIsSeeking(false);
      return;
    }

    const audio = audioRef.current;
    if (!audio || !Number.isFinite(nextValue)) {
      setIsSeeking(false);
      setSeekDraftSec(null);
      return;
    }

    const safeDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : durationSec;
    const safeTime = Math.max(0, Math.min(safeDuration || 0, nextValue));
    audio.currentTime = safeTime;
    setCurrentTimeSec(safeTime);

    if (safeDuration > 0) {
      setProgress((safeTime / safeDuration) * 100);
    } else {
      setProgress(0);
    }
    setIsSeeking(false);
    setSeekDraftSec(null);
  };

  useEffect(() => {
    const audio = new Audio();
    audio.volume = volume;
    audio.preload = 'metadata';
    audio.ontimeupdate = () => {
      if (audio.duration) {
        setProgress((audio.currentTime / audio.duration) * 100);
        if (!isSeekingRef.current) {
          setCurrentTimeSec(audio.currentTime);
        }
      }
    };
    audio.onloadedmetadata = () => {
      if (audio.duration) {
        setDurationSec(audio.duration);
      }
    };
    audio.onplay = () => {
      isTrackSwitchingRef.current = false;
      stopMediaSwitchKeepAlive();
      setIsPlaying(true);
    };
    audio.onpause = () => {
      if (isTrackSwitchingRef.current) return;
      setIsPlaying(false);
    };
    audioRef.current = audio;

    return () => {
      audio.pause();
      stopMediaSwitchKeepAlive();
      audioRef.current = null;
    };
  }, [stopMediaSwitchKeepAlive]);

  useEffect(() => {
    const restored = restorePlayerStateRef.current;
    const audio = audioRef.current;
    if (!audio || !restored || didRestorePlayerStateRef.current) return;
    if (!restored.currentTrack) return;
    let cancelled = false;

    const restorePlayback = async () => {
      try {
        const restoredTrack = restored.currentTrack;
        if (!restoredTrack) {
          didRestorePlayerStateRef.current = true;
          return;
        }
        const url = await getStreamUrlForTrack(restoredTrack, { force: true });
        if (cancelled || didRestorePlayerStateRef.current || restorePlayerStateRef.current !== restored) {
          didRestorePlayerStateRef.current = true;
          return;
        }
        if (!url || !audioRef.current) {
          didRestorePlayerStateRef.current = true;
          return;
        }

        const nextAudio = audioRef.current;
        nextAudio.src = url;
        setCurrentTrack(restoredTrack);
        setDurationSec(Math.max(0, Math.floor(restoredTrack.duration / 1000)));

        const applyRestoreTime = () => {
          if (!audioRef.current) return;
          const duration = Number.isFinite(audioRef.current.duration) && audioRef.current.duration > 0
            ? audioRef.current.duration
            : restoredTrack.duration / 1000;
          const safeTime = Math.max(0, Math.min(duration || 0, restored.currentTimeSec || 0));
          audioRef.current.currentTime = safeTime;
          setCurrentTimeSec(safeTime);
          setProgress(duration > 0 ? (safeTime / duration) * 100 : 0);
        };

        nextAudio.addEventListener('loadedmetadata', applyRestoreTime, { once: true });
        applyRestoreTime();

        if (restored.isPlaying) {
          try {
            await nextAudio.play();
            if (cancelled || didRestorePlayerStateRef.current || restorePlayerStateRef.current !== restored) {
              nextAudio.pause();
              return;
            }
            setIsPlaying(true);
          } catch {
            nextAudio.pause();
            setIsPlaying(false);
          }
        } else {
          nextAudio.pause();
          setIsPlaying(false);
        }
      } catch (error) {
        console.error('Restore playback error:', error);
      } finally {
        didRestorePlayerStateRef.current = true;
      }
    };

    void restorePlayback();
    return () => {
      cancelled = true;
    };
  }, [autoplayOnLaunch, getStreamUrlForTrack]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.onended = () => {
      if (repeatMode === 'one') {
        audio.currentTime = 0;
        void audio.play();
        return;
      }
      playNext();
    };
  }, [repeatMode, playNext]);

  useEffect(() => {
    if (!currentTrack || queue.length === 0) return;
    if (isShuffle) {
      const rest = queue.filter((item) => item.id !== currentTrack.id);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      const nextOrder = [currentTrack, ...rest];
      setPlaybackOrder(nextOrder);
      setPlaybackIndex(0);
    } else {
      setPlaybackOrder(queue);
      setPlaybackIndex(Math.max(0, queue.findIndex((item) => item.id === currentTrack.id)));
    }
  }, [isShuffle]);

  useEffect(() => {
    if (audioRef.current) {
      const clampedVolume = Math.max(0, Math.min(1, volume));
      audioRef.current.volume = clampedVolume * MAX_AUDIO_VOLUME;
      if (clampedVolume > 0) {
        lastNonZeroVolumeRef.current = clampedVolume;
      }
    }
    localStorage.setItem(PLAYER_VOLUME_STORAGE_KEY, String(Math.max(0, Math.min(1, volume))));
  }, [PLAYER_VOLUME_STORAGE_KEY, volume]);

  useEffect(() => {
    if (!window.electronApp?.updateNativeSmtc || !window.electronApp?.clearNativeSmtc) return;

    if (!currentTrack) {
      window.electronApp.clearNativeSmtc();
      return;
    }

    const artworkUrl = currentTrack.artwork_url?.replace('large', 't500x500') || currentTrack.artwork_url || undefined;
    const duration = Math.max(1, Number.isFinite(durationSec) && durationSec > 0 ? durationSec : Math.floor(currentTrack.duration / 1000));
    const position = Math.max(0, Math.min(duration, Number.isFinite(currentTimeSec) ? currentTimeSec : 0));

    window.electronApp.updateNativeSmtc({
      title: currentTrack.title || 'Unknown track',
      artist: getTrackArtistName(currentTrack) || 'Unknown artist',
      artworkUrl,
      trackUrl: currentTrack.permalink_url || undefined,
      isPlaying,
      durationSec: duration,
      positionSec: position
    });
  }, [currentTrack, selectedCollection?.title, isPlaying, durationSec, currentTimeSec]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const mediaSession = navigator.mediaSession;

    const safeSetActionHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        mediaSession.setActionHandler(action, handler);
      } catch {
        // Some actions are not supported in all environments.
      }
    };

    if (nativeSmtcState === 'ready') {
      safeSetActionHandler('play', null);
      safeSetActionHandler('pause', null);
      safeSetActionHandler('previoustrack', null);
      safeSetActionHandler('nexttrack', null);
      safeSetActionHandler('seekto', null);
      safeSetActionHandler('stop', null);
      try {
        mediaSession.playbackState = 'none';
        mediaSession.metadata = null;
      } catch {
        // ignore
      }
      return;
    }

    if (nativeSmtcState === 'pending') {
      safeSetActionHandler('play', null);
      safeSetActionHandler('pause', null);
      safeSetActionHandler('previoustrack', null);
      safeSetActionHandler('nexttrack', null);
      safeSetActionHandler('seekto', null);
      safeSetActionHandler('stop', null);
      try {
        mediaSession.playbackState = 'none';
        mediaSession.metadata = null;
      } catch {
        // ignore
      }
      return;
    }

    if (currentTrack) {
      const artworkBase = currentTrack.artwork_url?.replace('large', 't500x500') || currentTrack.artwork_url || '';
      const artwork = artworkBase
        ? [
            { src: artworkBase, sizes: '96x96', type: 'image/jpeg' },
            { src: artworkBase, sizes: '192x192', type: 'image/jpeg' },
            { src: artworkBase, sizes: '512x512', type: 'image/jpeg' }
          ]
        : [];

      mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title || 'Unknown track',
        artist: getTrackArtistName(currentTrack) || 'Unknown artist',
        album: selectedCollection?.title || 'Soundtify',
        artwork
      });
    }
    mediaSession.playbackState = currentTrack ? (isPlaying ? 'playing' : 'paused') : 'paused';

    safeSetActionHandler('play', () => {
      if (audioRef.current) {
        void audioRef.current.play();
      }
    });
    safeSetActionHandler('pause', () => {
      audioRef.current?.pause();
    });
    safeSetActionHandler('previoustrack', () => {
      handlePlayPrevious();
    });
    safeSetActionHandler('nexttrack', () => {
      handlePlayNext();
    });
    safeSetActionHandler('seekto', (details) => {
      if (!audioRef.current || details.seekTime == null) return;
      audioRef.current.currentTime = details.seekTime;
      setCurrentTimeSec(details.seekTime);
    });
    safeSetActionHandler('stop', () => {
      if (!audioRef.current) return;
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setCurrentTimeSec(0);
      setProgress(0);
      setIsPlaying(false);
    });

  }, [currentTrack, isPlaying, selectedCollection?.title, handlePlayNext, handlePlayPrevious, nativeSmtcState]);

  useEffect(() => {
    if (nativeSmtcState !== 'failed') return;
    if (!('mediaSession' in navigator)) return;
    if (!currentTrack) return;
    if (!Number.isFinite(durationSec) || durationSec <= 0) return;

    try {
      navigator.mediaSession.setPositionState({
        duration: durationSec,
        position: Math.max(0, Math.min(durationSec, currentTimeSec)),
        playbackRate: 1
      });
    } catch {
      // setPositionState is not fully supported everywhere.
    }
  }, [currentTrack, durationSec, currentTimeSec, nativeSmtcState]);

  useEffect(() => {
    const state: PersistedPlayerState = {
      currentTrack,
      queue,
      playbackOrder,
      playbackIndex,
      currentTimeSec: Math.max(0, Math.floor(currentTimeSec)),
      volume,
      isShuffle,
      repeatMode,
      isPlaying,
      selectedCollection: selectedCollection || null,
      lastView: view,
      autoplayEnabled: autoplayOnLaunch
    };
    localStorage.setItem(PLAYER_STATE_STORAGE_KEY, JSON.stringify(state));
  }, [
    currentTrack,
    queue,
    playbackOrder,
    playbackIndex,
    Math.floor(currentTimeSec),
    volume,
    isShuffle,
    repeatMode,
    isPlaying,
    selectedCollection,
    view,
    autoplayOnLaunch
  ]);

  const timelineDuration = durationSec || (currentTrack ? currentTrack.duration / 1000 : 0);
  const isCurrentTrackUnavailable = isTrackUnavailable(currentTrack);
  const displayedTime = isSeeking && seekDraftSec !== null ? seekDraftSec : currentTimeSec;
  const displayedProgress = timelineDuration > 0 ? (Math.max(0, Math.min(timelineDuration, displayedTime)) / timelineDuration) * 100 : 0;
  const queueSource = playbackOrder.length > 0 ? playbackOrder : queue;
  const sourceCurrentIndex = playbackOrder.length > 0
    ? playbackIndex
    : (currentTrack ? queueSource.findIndex((track) => track.id === currentTrack.id) : -1);
  const queueStartIndex = sourceCurrentIndex >= 0 ? sourceCurrentIndex : 0;
  // Show current track + up to 80 next tracks.
  const visibleQueue = queueSource.slice(queueStartIndex, queueStartIndex + 81);

  const formatDuration = (ms: number) => {
    if (!Number.isFinite(ms) || ms <= 0) return '0:00';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const formatCount = (value?: number) => {
    const safe = Number.isFinite(Number(value)) ? Number(value) : 0;
    return new Intl.NumberFormat('ru-RU').format(safe);
  };

  const getReleaseYear = (value?: string) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return String(date.getUTCFullYear());
  };

  const artistPopularVisibleTracks = showAllArtistTopTracks ? artistTopTracks : artistTopTracks.slice(0, 5);
  const artistReleaseCollections = artistCollections.filter((item) => item.kind === 'album');
  const artistPlaylistCollections = artistCollections.filter((item) => item.kind === 'playlist');

  const popularReleaseCollections = [...artistReleaseCollections].sort((a, b) => {
    const dateA = new Date(a.release_date || '').getTime() || 0;
    const dateB = new Date(b.release_date || '').getTime() || 0;
    if (dateB !== dateA) return dateB - dateA;
    return (b.track_count || 0) - (a.track_count || 0);
  });
  const albumsEpCollections = artistReleaseCollections.filter((item) => (item.track_count || 0) > 4);
  const singlesEpCollections = artistReleaseCollections.filter((item) => (item.track_count || 0) <= 4);

  const selectedMusicCollections =
    artistMusicFilter === 'albums_ep'
      ? albumsEpCollections
      : artistMusicFilter === 'singles_ep'
        ? singlesEpCollections
        : popularReleaseCollections;
  const visibleMusicCollections = showAllArtistMusic ? selectedMusicCollections : selectedMusicCollections.slice(0, 4);
  const editablePlaylists = libraryItems.filter((item) => item.kind === 'playlist' && item.source === 'created');
  const submenuOnLeft = Boolean(trackContextMenu && trackContextMenu.x > window.innerWidth * 0.62);

  return (
    <div className="flex h-screen bg-black text-white font-sans select-none">
      {/* Sidebar */}
      <div className="w-64 bg-black flex flex-col p-6 gap-6 border-r border-white/5 shrink-0">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center">
            <Play className="text-black fill-current w-4 h-4" />
          </div>
          <span className="text-xl font-bold tracking-tight">Soundtify</span>
        </div>

        <nav className="flex flex-col gap-4">
          <div 
            className={`flex items-center gap-4 cursor-pointer transition-colors font-semibold ${view === 'home' ? 'text-white' : 'text-gray-400 hover:text-white'}`}
            onClick={() => setView('home')}
          >
            <Home size={24} />
            <span>Home</span>
          </div>
          <div 
            className={`flex items-center gap-4 cursor-pointer transition-colors font-semibold ${view === 'search' ? 'text-white' : 'text-gray-400 hover:text-white'}`}
            onClick={() => setView('search')}
          >
            <Search size={24} />
            <span>Search</span>
          </div>
          <div
            className={`flex items-center gap-4 cursor-pointer transition-colors font-semibold ${view === 'library' || view === 'collection' ? 'text-white' : 'text-gray-400 hover:text-white'}`}
            onClick={() => setView('library')}
          >
            <Library size={24} />
            <span>Your Library</span>
          </div>
        </nav>

        <div className="mt-8 flex flex-col gap-4 min-h-0">
          <button
            onClick={handleCreatePlaylist}
            className="flex items-center gap-4 text-gray-400 hover:text-white cursor-pointer transition-colors font-semibold group text-left"
          >
            <div className="bg-gray-400 p-1 rounded-sm text-black group-hover:bg-white transition-colors">
              <PlusSquare size={20} />
            </div>
            <span>Create Playlist</span>
          </button>
          <div 
            className={`flex items-center gap-4 cursor-pointer transition-colors font-semibold group ${view === 'liked' ? 'text-white' : 'text-gray-400 hover:text-white'}`}
            onClick={() => setView('liked')}
          >
            <div className="bg-gradient-to-br from-indigo-700 to-blue-300 p-1 rounded-sm opacity-80 group-hover:opacity-100 transition-opacity">
              <Heart size={20} className="fill-current text-white" />
            </div>
            <span>Liked Songs</span>
          </div>

          <div className="mt-2 flex-1 min-h-0 overflow-y-auto pr-1">
            <div className="flex flex-col gap-1">
              {libraryItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => openCollection(item)}
                  className="w-full flex items-center gap-3 p-2 rounded-md hover:bg-white/10 transition-colors text-left"
                >
                  {renderCollectionArtwork(item, 'w-12 h-12 rounded shrink-0')}
                  <div className="min-w-0">
                    <div className="text-sm text-white truncate text-left">{item.title}</div>
                    <div className="text-xs text-gray-400 truncate">
                      {item.kind === 'album' ? 'Альбом' : 'Плейлист'} • {item.author}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-auto pt-4 border-t border-white/10">
          <div className="text-xs text-gray-400 hover:underline cursor-pointer">Cookies</div>
          <div className="text-xs text-gray-400 hover:underline cursor-pointer mt-2">Privacy</div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gradient-to-b from-zinc-900 to-black">
        {/* Header */}
        <header className="p-4 flex items-center justify-between sticky top-0 bg-transparent z-10">
          <div className="flex gap-4">
            <div className="w-8 h-8 bg-black/40 rounded-full flex items-center justify-center cursor-pointer">
              <SkipBack size={20} className="text-gray-400" />
            </div>
            <div className="w-8 h-8 bg-black/40 rounded-full flex items-center justify-center cursor-pointer">
              <SkipForward size={20} className="text-gray-400" />
            </div>
          </div>

          <form onSubmit={handleSearch} className="flex-1 max-w-md mx-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input 
                ref={searchInputRef}
                type="text" 
                placeholder="What do you want to listen to?"
                className="w-full bg-white text-black rounded-full py-2 pl-10 pr-4 focus:outline-none text-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </form>

          <div className="flex items-center gap-4">
            {isUserLoading ? (
              <div className="w-28 h-9 rounded-full bg-white/10 animate-pulse" />
            ) : user ? (
              <div ref={userMenuRef} className="relative">
                <button
                  onClick={() => setIsUserMenuOpen((prev) => !prev)}
                  className="flex items-center gap-3 bg-black/40 rounded-full pl-1 pr-3 py-1 border border-white/10 hover:bg-black/60 transition-colors cursor-pointer"
                >
                  <img src={user.avatar_url} alt="" className="w-7 h-7 rounded-full" />
                  <span className="text-sm font-bold">{user.username}</span>
                </button>
                {isUserMenuOpen ? (
                  <div className="absolute right-0 mt-2 w-56 bg-zinc-900 border border-white/10 rounded-lg shadow-xl overflow-hidden z-30">
                    <button
                      onClick={() => {
                        const userId = Number(user?.id);
                        if (Number.isFinite(userId) && userId > 0) {
                          openArtistProfile(userId);
                        }
                        setIsUserMenuOpen(false);
                      }}
                      className="w-full text-left px-4 py-3 text-sm hover:bg-white/10 transition-colors"
                    >
                      Профиль
                    </button>
                    <button
                      onClick={() => {
                        setIsSettingsOpen(true);
                        setIsUserMenuOpen(false);
                      }}
                      className="w-full text-left px-4 py-3 text-sm hover:bg-white/10 transition-colors"
                    >
                      Настройки
                    </button>
                    <div className="h-px bg-white/10" />
                    <button
                      onClick={handleLogout}
                      className="w-full text-left px-4 py-3 text-sm text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
                    >
                      Logout
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <button 
                onClick={handleLogin}
                className="bg-white text-black font-bold py-2 px-6 rounded-full text-sm hover:scale-105 transition-transform"
              >
                Log In
              </button>
            )}
          </div>
        </header>

        {/* Scrollable Area */}
        <main className="flex-1 overflow-y-auto p-8 pb-36">
          <AnimatePresence mode="wait">
            {view === 'search' ? (
              <motion.div 
                key="search"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex flex-col gap-4"
              >
                <h2 className="text-2xl font-bold mb-4">Search Results</h2>
                <div className="grid grid-cols-1 gap-1">
                  {searchResults.length > 0 ? searchResults.map((track, index) => (
                    <TrackRow 
                      key={`${track.id}-${index}`} 
                      track={track} 
                      index={index} 
                      currentTrack={currentTrack} 
                      isPlaying={isPlaying} 
                      isUnavailable={isTrackUnavailable(track)}
                      isLiked={likedTracks.some(t => t.id === track.id)}
                      isLikePending={pendingLikeTrackIds.has(track.id)}
                      onTogglePlay={togglePlay}
                      onPlay={() => playSearchRelease(track, searchResults)}
                      onArtistClick={() => handleArtistClick(track)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setTrackContextMenu({ x: e.clientX, y: e.clientY, track });
                        setOpenTrackSubmenu(null);
                      }}
                      onToggleLike={(e) => {
                        e.stopPropagation();
                        toggleLike(track);
                      }}
                    />
                  )) : (
                    <div className="text-center py-20 text-gray-400">
                      No results found for "{searchQuery}"
                    </div>
                  )}
                </div>
              </motion.div>
            ) : view === 'liked' ? (
              <motion.div 
                key="liked"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex flex-col gap-8"
              >
                <div className="relative overflow-hidden rounded-2xl mb-4">
                  {getBannerUrl(user) ? (
                    <img
                      src={getBannerUrl(user) || ''}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-r from-indigo-600/40 via-sky-500/30 to-zinc-900/80" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-zinc-900/60 to-black" />
                  <div className="relative flex items-end gap-6 px-8 py-10 min-h-[300px]">
                    <div className="w-52 h-52 bg-gradient-to-br from-indigo-700 to-blue-300 shadow-2xl flex items-center justify-center rounded-md shrink-0">
                      <Heart size={96} className="fill-current text-white" />
                    </div>
                    <div className="flex flex-col gap-2">
                      <span className="text-sm font-bold uppercase">Playlist</span>
                      <h1 className="text-8xl font-black">Liked Songs</h1>
                      <div className="flex items-center gap-2 text-sm font-semibold mt-4">
                        {user && <img src={user.avatar_url} className="w-6 h-6 rounded-full" />}
                        <span>{user?.username || 'User'}</span>
                        <span className="text-gray-300">• {likedTracks.length} songs</span>
                      </div>
                    </div>
                  </div>
                </div>

                {user && likedTracks.length > 0 ? (
                  <div className="flex items-center gap-6 -mt-2 mb-2">
                    <button
                      onClick={() => {
                        if (currentTrack && likedTracks.some((track) => track.id === currentTrack.id)) {
                          togglePlay();
                          return;
                        }
                        const startTrack = isShuffle
                          ? getPlayableTracks(likedTracks)[Math.floor(Math.random() * Math.max(getPlayableTracks(likedTracks).length, 1))]
                          : getPlayableTracks(likedTracks)[0];
                        if (startTrack) {
                          playLikedSongs(startTrack);
                        }
                      }}
                      className="w-14 h-14 rounded-full accent-bg accent-bg-hover transition-colors flex items-center justify-center shadow-xl"
                    >
                      {isPlaying && currentTrack && likedTracks.some((track) => track.id === currentTrack.id) ? (
                        <Pause size={24} className="text-black fill-current" />
                      ) : (
                        <Play size={24} className="text-black fill-current ml-1" />
                      )}
                    </button>
                    <button
                      onClick={() => setIsShuffle((prev) => !prev)}
                      className={`text-2xl transition-colors ${isShuffle ? 'accent-text' : 'text-gray-400 hover:text-white'}`}
                    >
                      <Shuffle size={28} />
                    </button>
                  </div>
                ) : null}

                {isUserLoading ? (
                  <div className="text-gray-400">Загрузка аккаунта...</div>
                ) : !user ? (
                  <div className="flex flex-col items-center justify-center py-12 px-6 bg-zinc-900/50 rounded-2xl border border-white/5 gap-6">
                    <div className="w-20 h-20 bg-indigo-600/20 rounded-full flex items-center justify-center">
                      <Heart size={40} className="text-indigo-500" />
                    </div>
                    <div className="text-center max-w-md">
                      <h2 className="text-2xl font-bold mb-2">Connect SoundCloud</h2>
                      <p className="text-gray-400 text-sm mb-6">
                        To see your liked songs, you need to authorize this app in your SoundCloud settings.
                      </p>
                      
                      <div className="bg-black/40 p-4 rounded-lg text-left mb-6 border border-white/10">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-2">Required Redirect URI:</p>
                        <code className="text-xs break-all accent-text">
                          {authCallbackUrl}
                        </code>
                        <p className="text-[10px] text-gray-500 mt-2">
                          * Copy this to "Redirect URI" in your SoundCloud App dashboard.
                        </p>
                      </div>

                      <button 
                        onClick={handleLogin}
                        className="w-full bg-white text-black font-bold py-3 px-8 rounded-full hover:scale-105 transition-transform flex items-center justify-center gap-2"
                      >
                        <Play size={18} className="fill-current" />
                        Authorize Now
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-1">
                    {likedTracks.map((track, index) => (
                      <TrackRow 
                        key={`${track.id}-${index}`} 
                        track={track} 
                        index={index} 
                        currentTrack={currentTrack} 
                        isPlaying={isPlaying} 
                        isUnavailable={isTrackUnavailable(track)}
                        isLiked={true}
                        isLikePending={pendingLikeTrackIds.has(track.id)}
                        onTogglePlay={togglePlay}
                        onPlay={() => playLikedSongs(track)}
                      onArtistClick={() => handleArtistClick(track)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setTrackContextMenu({ x: e.clientX, y: e.clientY, track });
                        setOpenTrackSubmenu(null);
                      }}
                      onToggleLike={(e) => {
                          e.stopPropagation();
                          toggleLike(track);
                        }}
                      />
                    ))}
                  </div>
                )}
              </motion.div>
            ) : view === 'library' ? (
              <motion.div
                key="library"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex flex-col gap-8"
              >
                <div className="flex items-end gap-6 mb-8">
                  <div className="w-52 h-52 bg-zinc-800 shadow-2xl flex items-center justify-center rounded-md">
                    <Library size={96} className="text-white" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-bold uppercase">Library</span>
                    <h1 className="text-7xl font-black">Your Library</h1>
                    <div className="text-sm text-gray-400">
                      {libraryItems.length + 1} collections
                    </div>
                  </div>
                </div>

                {isLibraryLoading ? (
                  <div className="text-gray-400">Loading library...</div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                    <div
                      className="bg-zinc-900/40 p-4 rounded-lg hover:bg-zinc-800/60 transition-colors cursor-pointer group"
                      onClick={() => setView('liked')}
                    >
                      <div className="relative mb-4 aspect-square">
                        <div className="w-full h-full rounded-md bg-gradient-to-br from-indigo-700 to-blue-300 shadow-2xl flex items-center justify-center">
                          <Heart size={72} className="fill-current text-white" />
                        </div>
                        <button className="absolute bottom-2 right-2 w-12 h-12 accent-bg rounded-full flex items-center justify-center shadow-xl opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300">
                          <Play size={24} className="text-black fill-current ml-1" />
                        </button>
                      </div>
                      <div className="font-bold truncate mb-1">Liked Songs</div>
                      <div className="text-sm text-gray-400 truncate">Плейлист • {user?.username || 'User'}</div>
                    </div>

                    {libraryItems.map((item) => (
                      <div
                        key={`lib-${item.id}`}
                        className="bg-zinc-900/40 p-4 rounded-lg hover:bg-zinc-800/60 transition-colors cursor-pointer group"
                        onClick={() => openCollection(item)}
                      >
                        <div className="relative mb-4 aspect-square">
                          {renderCollectionArtwork(item, 'w-full h-full rounded-md shadow-2xl')}
                          <button className="absolute bottom-2 right-2 w-12 h-12 accent-bg rounded-full flex items-center justify-center shadow-xl opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-300">
                            <Play size={24} className="text-black fill-current ml-1" />
                          </button>
                        </div>
                        <div className="font-bold truncate mb-1">{item.title}</div>
                        <div className="text-sm text-gray-400 truncate">
                          {item.kind === 'album' ? 'Альбом' : 'Плейлист'} • {item.author}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            ) : view === 'collection' ? (
              <motion.div
                key={`collection-${selectedCollection?.set_type || 'playlist'}-${selectedCollection?.id || 'empty'}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex flex-col gap-8"
              >
                {selectedCollection ? (
                  <>
                    <div className="flex items-end gap-6 mb-4">
                      {renderCollectionArtwork(
                        {
                          artwork_url: selectedCollection.artwork_url,
                          preview_artworks: selectedCollection.tracks.slice(0, 4).map((track) => track.artwork_url || null)
                        },
                        'w-52 h-52 rounded-md shadow-2xl'
                      )}
                      <div className="flex flex-col gap-2">
                        <span className="text-sm font-bold uppercase">
                          {selectedCollection.set_type === 'album' ? 'Album' : 'Playlist'}
                        </span>
                        <h1 className="text-7xl font-black">{selectedCollection.title}</h1>
                        <div className="flex items-center gap-2 text-sm font-semibold mt-2">
                          {selectedCollection.user?.avatar_url ? (
                            <img
                              src={selectedCollection.user.avatar_url}
                              alt=""
                              className="w-6 h-6 rounded-full"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-zinc-700/80" />
                          )}
                          <button
                            type="button"
                            className="hover:underline"
                            onClick={() => {
                              const artistId = Number((selectedCollection as any)?.user?.id);
                              if (Number.isFinite(artistId) && artistId > 0) {
                                openArtistProfile(artistId);
                              }
                            }}
                          >
                            {selectedCollection.user?.username || 'Unknown'}
                          </button>
                          <span className="text-gray-400">• {selectedCollection.tracks.length} songs</span>
                        </div>
                      </div>
                    </div>

                    {selectedCollection.tracks.length > 0 ? (
                      <div className="flex items-center gap-6 -mt-2 mb-2">
                        <button
                          onClick={() => {
                            if (currentTrack && selectedCollection.tracks.some((track) => track.id === currentTrack.id)) {
                              togglePlay();
                              return;
                            }
                            const startTrack = isShuffle
                              ? getPlayableTracks(selectedCollection.tracks)[Math.floor(Math.random() * Math.max(getPlayableTracks(selectedCollection.tracks).length, 1))]
                              : getPlayableTracks(selectedCollection.tracks)[0];
                            if (!startTrack) return;
                            pushRecentlyPlayed({
                              id: `${selectedCollection.set_type === 'album' ? 'album' : 'playlist'}-${selectedCollection.id}`,
                              kind: selectedCollection.set_type === 'album' ? 'album' : 'playlist',
                              title: selectedCollection.title,
                              artwork_url: selectedCollection.artwork_url,
                              author: selectedCollection.user?.username || 'Unknown',
                              tracks: selectedCollection.tracks
                            });
                            playTrack(startTrack, selectedCollection.tracks);
                          }}
                          className="w-14 h-14 rounded-full accent-bg accent-bg-hover transition-colors flex items-center justify-center shadow-xl"
                        >
                          {isPlaying && currentTrack && selectedCollection.tracks.some((track) => track.id === currentTrack.id) ? (
                            <Pause size={24} className="text-black fill-current" />
                          ) : (
                            <Play size={24} className="text-black fill-current ml-1" />
                          )}
                        </button>
                        <button
                          onClick={() => setIsShuffle((prev) => !prev)}
                          className={`text-2xl transition-colors ${isShuffle ? 'accent-text' : 'text-gray-400 hover:text-white'}`}
                        >
                          <Shuffle size={28} />
                        </button>
                      </div>
                    ) : null}

                    <div className="grid grid-cols-1 gap-1">
                      {selectedCollection.tracks.map((track, index) => (
                        <TrackRow
                          key={`${track.id}-${index}`}
                          track={track}
                          index={index}
                          currentTrack={currentTrack}
                          isPlaying={isPlaying}
                          isUnavailable={isTrackUnavailable(track)}
                          isLiked={likedTracks.some((t) => t.id === track.id)}
                          isLikePending={pendingLikeTrackIds.has(track.id)}
                          onTogglePlay={togglePlay}
                          onArtistClick={() => handleArtistClick(track)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setTrackContextMenu({
                              x: e.clientX,
                              y: e.clientY,
                              track,
                              sourceCollectionId: selectedCollection.id,
                              sourceCollectionTitle: selectedCollection.title
                            });
                            setOpenTrackSubmenu(null);
                          }}
                          onPlay={() => {
                            pushRecentlyPlayed({
                              id: `${selectedCollection.set_type === 'album' ? 'album' : 'playlist'}-${selectedCollection.id}`,
                              kind: selectedCollection.set_type === 'album' ? 'album' : 'playlist',
                              title: selectedCollection.title,
                              artwork_url: selectedCollection.artwork_url,
                              author: selectedCollection.user?.username || 'Unknown',
                              tracks: selectedCollection.tracks
                            });
                            playTrack(track, selectedCollection.tracks);
                          }}
                          onToggleLike={(e) => {
                            e.stopPropagation();
                            toggleLike(track);
                          }}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="text-gray-400">Collection not selected.</div>
                )}
              </motion.div>
            ) : view === 'artist' ? (
              <motion.div
                key="artist"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex flex-col gap-8"
              >
                {isArtistLoading ? (
                  <div className="text-gray-400">Loading artist...</div>
                ) : selectedArtist ? (
                  <>
                    <div className="relative overflow-hidden rounded-2xl">
                      {selectedArtist.banner_url ? (
                        <img
                          src={selectedArtist.banner_url}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-gradient-to-r from-orange-500/40 via-zinc-700/40 to-black" />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/50 to-black" />
                      <div className="relative flex items-end gap-6 px-8 py-10 min-h-[300px]">
                        {selectedArtist.avatar_url ? (
                          <img
                            src={selectedArtist.avatar_url}
                            alt=""
                            className="w-44 h-44 rounded-full object-cover shadow-2xl shrink-0 border border-white/10"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-44 h-44 rounded-full bg-zinc-700/80 shadow-2xl shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="text-sm font-bold uppercase">Artist</div>
                          <h1 className="text-7xl font-black truncate">{selectedArtist.username}</h1>
                          <div className="text-sm text-gray-200 mt-3">
                            {selectedArtist.followers_count || 0} followers • {selectedArtist.track_count || 0} tracks • {selectedArtist.playlist_count || 0} playlists
                          </div>
                          {selectedArtist.description ? (
                            <p className="text-sm text-gray-300 mt-2 max-w-3xl line-clamp-2">{selectedArtist.description}</p>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <section>
                      <h2 className="text-2xl font-bold mb-4">Популярные треки</h2>
                      {artistTopTracks.length > 0 ? (
                        <div className="grid grid-cols-1 gap-1">
                          {artistPopularVisibleTracks.map((track, index) => (
                            <div
                              key={`artist-popular-${track.id}-${index}`}
                              onClick={isTrackUnavailable(track) ? undefined : () => playTrack(track, artistTopTracks)}
                              onContextMenu={isTrackUnavailable(track) ? undefined : (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setTrackContextMenu({ x: e.clientX, y: e.clientY, track });
                                setOpenTrackSubmenu(null);
                              }}
                              className={`flex items-center p-2 rounded-md transition-colors group ${
                                isTrackUnavailable(track)
                                  ? 'opacity-45 cursor-default'
                                  : `cursor-pointer ${currentTrack?.id === track.id ? 'bg-white/10' : 'hover:bg-white/5'}`
                              }`}
                            >
                              <div className="w-12 pr-2 text-gray-400 text-right">{index + 1}</div>

                              {track.artwork_url ? (
                                <img
                                  src={track.artwork_url.replace('large', 't500x500')}
                                  alt=""
                                  className="w-10 h-10 rounded mr-4 object-cover"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div className="w-10 h-10 rounded mr-4 bg-zinc-700/80" />
                              )}

                              <div className="flex-1 min-w-0">
                                <div className={`font-semibold truncate ${isTrackUnavailable(track) ? 'text-gray-500' : currentTrack?.id === track.id ? 'accent-text' : 'text-white'}`}>
                                  {track.title}
                                </div>
                                <div className={`text-sm truncate ${isTrackUnavailable(track) ? 'text-gray-500' : 'text-gray-400'}`}>{getTrackArtistName(track)}</div>
                              </div>

                              <div className="flex items-center gap-8">
                                <div className="text-sm text-gray-400 w-40 text-right">
                                  {formatCount(track.playback_count)}
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (isTrackUnavailable(track)) return;
                                    toggleLike(track);
                                  }}
                                  disabled={pendingLikeTrackIds.has(track.id) || isTrackUnavailable(track)}
                                  className={`cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-40 ${
                                    isTrackUnavailable(track)
                                      ? 'text-gray-600'
                                      : likedTracks.some((t) => t.id === track.id) ? 'opacity-100 accent-text' : 'text-gray-400 hover:text-white'
                                  }`}
                                >
                                  <Heart size={16} className={likedTracks.some((t) => t.id === track.id) ? 'fill-current' : ''} />
                                </button>
                                <div className="text-sm text-gray-400 w-12 text-right">
                                  {formatDuration(track.duration)}
                                </div>
                              </div>
                            </div>
                          ))}
                          {artistTopTracks.length > 5 ? (
                            <div className="px-4 py-2">
                              <button
                                onClick={() => setShowAllArtistTopTracks((prev) => !prev)}
                                className="text-sm text-gray-300 hover:text-white font-semibold"
                              >
                                {showAllArtistTopTracks ? 'Свернуть' : 'Ещё'}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="text-gray-400 text-sm">No tracks available.</div>
                      )}
                    </section>

                    {artistReleaseCollections.length > 0 ? (
                      <section className="flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                          <h2 className="text-2xl font-bold">Музыка</h2>
                          {selectedMusicCollections.length > 4 ? (
                            <button
                              onClick={() => setShowAllArtistMusic((prev) => !prev)}
                              className="text-sm text-gray-300 hover:text-white font-semibold"
                            >
                              {showAllArtistMusic ? 'Свернуть' : 'Показать все'}
                            </button>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setArtistMusicFilter('popular');
                              setShowAllArtistMusic(false);
                            }}
                            className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${artistMusicFilter === 'popular' ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20'}`}
                          >
                            Популярные релизы
                          </button>
                          <button
                            onClick={() => {
                              setArtistMusicFilter('albums_ep');
                              setShowAllArtistMusic(false);
                            }}
                            className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${artistMusicFilter === 'albums_ep' ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20'}`}
                          >
                            Альбомы и EP
                          </button>
                          <button
                            onClick={() => {
                              setArtistMusicFilter('singles_ep');
                              setShowAllArtistMusic(false);
                            }}
                            className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${artistMusicFilter === 'singles_ep' ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20'}`}
                          >
                            Синглы и EP
                          </button>
                        </div>
                        {visibleMusicCollections.length > 0 ? (
                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                            {visibleMusicCollections.map((item) => (
                              <div
                                key={`artist-music-${item.id}`}
                                className="bg-zinc-900/20 p-2 rounded-lg hover:bg-zinc-800/50 transition-colors cursor-pointer"
                                onClick={() => openCollection(item)}
                              >
                                <div className="mb-3 aspect-square">
                                  {renderCollectionArtwork(item, 'w-full h-full rounded-md shadow-2xl')}
                                </div>
                                <div className="font-bold truncate mb-1">{item.title}</div>
                                <div className="text-sm text-gray-400 truncate">
                                  {(getReleaseYear(item.release_date) || '----')} • {(item.track_count || 0) <= 4 ? 'Сингл/EP' : 'Альбом'}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-gray-400 text-sm">Нет релизов в этом разделе.</div>
                        )}
                      </section>
                    ) : null}

                    {artistPlaylistCollections.length > 0 ? (
                      <section>
                        <h2 className="text-2xl font-bold mb-4">Плейлисты</h2>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                          {artistPlaylistCollections.map((item) => (
                            <div
                              key={`artist-playlist-${item.id}`}
                              className="bg-zinc-900/40 p-4 rounded-lg hover:bg-zinc-800/60 transition-colors cursor-pointer"
                              onClick={() => openCollection(item)}
                            >
                              <div className="mb-4 aspect-square">
                                {renderCollectionArtwork(item, 'w-full h-full rounded-md shadow-2xl')}
                              </div>
                              <div className="font-bold truncate mb-1">{item.title}</div>
                              <div className="text-sm text-gray-400 truncate">Плейлист • {item.author}</div>
                            </div>
                          ))}
                        </div>
                      </section>
                    ) : null}
                  </>
                ) : (
                  <div className="text-gray-400">Artist not found.</div>
                )}
              </motion.div>
            ) : (
              <motion.div 
                key="home"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex flex-col gap-8"
              >
                {isLoading ? (
                  <div className="flex-1 flex items-center justify-center h-64">
                    <div className="w-12 h-12 border-4 accent-spinner rounded-full animate-spin"></div>
                  </div>
                ) : (
                  <>
                    <section>
                      <h2 className="text-2xl font-bold mb-6">Trending on SoundCloud</h2>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                        {trendingTracks.length > 0 ? trendingTracks.slice(0, 10).map((track) => (
                          <div 
                            key={track.id} 
                            className={`bg-zinc-900/40 p-4 rounded-lg transition-colors group ${
                              isTrackUnavailable(track) ? 'opacity-45 cursor-default' : 'hover:bg-zinc-800/60 cursor-pointer'
                            }`}
                            onClick={isTrackUnavailable(track) ? undefined : () => playSearchRelease(track, trendingTracks)}
                          >
                            <div className="relative mb-4 aspect-square">
                              {track.artwork_url ? (
                                <img
                                  src={track.artwork_url.replace('large', 't500x500')}
                                  alt=""
                                  className="w-full h-full object-cover rounded-md shadow-2xl"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <div className="w-full h-full rounded-md shadow-2xl bg-zinc-700/80" />
                              )}
                              <button className={`absolute bottom-2 right-2 w-12 h-12 accent-bg rounded-full flex items-center justify-center shadow-xl transition-all duration-300 ${isTrackUnavailable(track) ? 'opacity-0 pointer-events-none' : 'opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 hover:scale-105'}`}>
                                <Play size={24} className="text-black fill-current ml-1" />
                              </button>
                            </div>
                            <div className={`font-bold truncate mb-1 ${isTrackUnavailable(track) ? 'text-gray-500' : ''}`}>{track.title}</div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isTrackUnavailable(track)) return;
                                handleArtistClick(track);
                              }}
                              className={`text-sm truncate text-left ${isTrackUnavailable(track) ? 'text-gray-500 cursor-default' : 'text-gray-400 hover:underline'}`}
                            >
                              {getTrackArtistName(track)}
                            </button>
                          </div>
                        )) : (
                          <div className="col-span-full text-center text-gray-400 py-12">
                            No trending tracks found. Check your connection or Client ID.
                          </div>
                        )}
                      </div>
                    </section>

                    <section>
                      <h2 className="text-2xl font-bold mb-6">Recently Played</h2>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {recentlyPlayed.length > 0 ? recentlyPlayed.map((entry) => (
                          <div 
                            key={entry.id} 
                            className="flex items-center gap-4 bg-zinc-800/40 rounded-md overflow-hidden hover:bg-zinc-700/60 transition-colors cursor-pointer group"
                            onClick={() => handlePlayRecent(entry)}
                          >
                            {entry.artwork_url ? (
                              <img
                                src={entry.artwork_url}
                                alt=""
                                className="w-20 h-20 object-cover"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="w-20 h-20 bg-zinc-700/80" />
                            )}
                            <div className="flex-1 pr-4">
                              <div className="font-bold truncate">{entry.title}</div>
                              <div className="text-xs text-gray-400 truncate">
                                {entry.kind === 'album' ? 'Альбом' : entry.kind === 'playlist' ? 'Плейлист' : 'Релиз'} • {entry.author}
                              </div>
                            </div>
                            <button className="mr-4 w-10 h-10 accent-bg rounded-full flex items-center justify-center shadow-xl opacity-0 group-hover:opacity-100 transition-opacity">
                              <Play size={20} className="text-black fill-current ml-0.5" />
                            </button>
                          </div>
                        )) : (
                          <div className="text-gray-400 text-sm">Ничего не воспроизводилось пока.</div>
                        )}
                      </div>
                    </section>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {isSettingsOpen ? (
        <div
          className="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4"
          onClick={() => setIsSettingsOpen(false)}
        >
          <div
            className="w-full max-w-md bg-zinc-900 border border-white/10 rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-lg font-bold">Настройки</h3>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="text-sm text-gray-400 hover:text-white"
              >
                Закрыть
              </button>
            </div>
            <div className="p-5">
              <div className="flex flex-col gap-5">
                <label className="flex items-center justify-between gap-4 cursor-pointer">
                  <div>
                    <div className="text-sm font-semibold">Автоплей при запуске</div>
                    <div className="text-xs text-gray-400 mt-1">Если выключено, состояние плеера восстановится без автозапуска</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAutoplayOnLaunch((prev) => !prev)}
                    className={`w-12 h-7 rounded-full transition-colors ${autoplayOnLaunch ? 'accent-bg' : 'bg-zinc-700'}`}
                  >
                    <span
                      className={`block w-5 h-5 bg-white rounded-full transition-transform ${autoplayOnLaunch ? 'translate-x-6' : 'translate-x-1'}`}
                    />
                  </button>
                </label>

                <div className="border-t border-white/10 pt-4 flex flex-col gap-3">
                  <div>
                    <div className="text-sm font-semibold">Локальный кэш</div>
                    <div className="text-xs text-gray-400 mt-1">
                      Сбрасывает кэш недоступных треков, временные stream URL и recent played. Вход в аккаунт не затрагивается.
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={resetLocalCaches}
                      className="px-4 py-2 text-sm rounded-md bg-white/5 hover:bg-white/10 transition-colors"
                    >
                      Сбросить кэш
                    </button>
                    {cacheResetNotice ? (
                      <div className="text-xs text-gray-400">{cacheResetNotice}</div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {confirmUnlikeTrack ? (
        <div
          className="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4"
          onClick={() => setConfirmUnlikeTrack(null)}
        >
          <div
            className="w-full max-w-md bg-zinc-900 border border-white/10 rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-white/10">
              <h3 className="text-lg font-bold">Удалить из любимых</h3>
            </div>
            <div className="px-5 py-4 text-sm text-gray-300">
              Удалить трек <span className="text-white font-semibold">{confirmUnlikeTrack.title}</span> из Liked Songs?
            </div>
            <div className="px-5 py-4 border-t border-white/10 flex items-center justify-end gap-3">
              <button
                onClick={() => setConfirmUnlikeTrack(null)}
                className="px-4 py-2 text-sm rounded-md bg-white/5 hover:bg-white/10 transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={async () => {
                  const track = confirmUnlikeTrack;
                  setConfirmUnlikeTrack(null);
                  if (!track) return;
                  await toggleLike(track, { skipUnlikeConfirm: true });
                }}
                className="px-4 py-2 text-sm rounded-md accent-bg text-black font-semibold accent-bg-hover transition-colors"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmRemoveFromCollection ? (
        <div
          className="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4"
          onClick={() => setConfirmRemoveFromCollection(null)}
        >
          <div
            className="w-full max-w-md bg-zinc-900 border border-white/10 rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-white/10">
              <h3 className="text-lg font-bold">Удалить из плейлиста</h3>
            </div>
            <div className="px-5 py-4 text-sm text-gray-300">
              Удалить трек <span className="text-white font-semibold">{confirmRemoveFromCollection.track.title}</span> из плейлиста <span className="text-white font-semibold">{confirmRemoveFromCollection.collectionTitle}</span>?
            </div>
            <div className="px-5 py-4 border-t border-white/10 flex items-center justify-end gap-3">
              <button
                onClick={() => setConfirmRemoveFromCollection(null)}
                className="px-4 py-2 text-sm rounded-md bg-white/5 hover:bg-white/10 transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={async () => {
                  const payload = confirmRemoveFromCollection;
                  setConfirmRemoveFromCollection(null);
                  if (!payload) return;
                  await removeTrackFromCollection(payload.collectionId, payload.track);
                }}
                className="px-4 py-2 text-sm rounded-md accent-bg text-black font-semibold accent-bg-hover transition-colors"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {trackContextMenu ? (
        <div
          ref={trackMenuRef}
          className="fixed z-50 w-72 max-w-[calc(100vw-1rem)] bg-zinc-900 border border-white/10 rounded-lg shadow-2xl"
          style={{
            top: Math.min(trackContextMenu.y, window.innerHeight - 340),
            left: Math.min(trackContextMenu.x, window.innerWidth - 300)
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              void handleCopyTrackTitleArtist(trackContextMenu.track);
              setTrackContextMenu(null);
              setOpenTrackSubmenu(null);
            }}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/10 transition-colors"
          >
            Скопировать название и артиста
          </button>

          <div className="relative">
            <button
              onMouseEnter={() => setOpenTrackSubmenu('playlist')}
              onClick={() => setOpenTrackSubmenu((prev) => (prev === 'playlist' ? null : 'playlist'))}
              className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/10 transition-colors flex items-center justify-between"
            >
              <span>Добавить в плейлист</span>
              <span className="text-gray-400">{submenuOnLeft ? '<' : '>'}</span>
            </button>
            {openTrackSubmenu === 'playlist' ? (
              <div
                className={`absolute top-0 z-[60] ${submenuOnLeft ? 'right-full -mr-0.5' : 'left-full -ml-0.5'} w-72 max-w-[calc(100vw-1rem)] bg-zinc-900 border border-white/10 rounded-lg shadow-2xl overflow-hidden`}
                onMouseEnter={() => setOpenTrackSubmenu('playlist')}
              >
                <button
                  onClick={() => {
                    setTrackContextMenu(null);
                    setOpenTrackSubmenu(null);
                    void handleCreatePlaylist();
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/10 transition-colors"
                >
                  Создать плейлист
                </button>
                <div className="h-px bg-white/10" />
                {editablePlaylists.length > 0 ? (
                  editablePlaylists.map((item) => (
                    <button
                      key={`ctx-playlist-${item.id}`}
                      onClick={() => {
                        void addTrackToPlaylist(item.id, trackContextMenu.track);
                        setTrackContextMenu(null);
                        setOpenTrackSubmenu(null);
                      }}
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/10 transition-colors truncate"
                    >
                      {item.title}
                    </button>
                  ))
                ) : (
                  <div className="px-4 py-2.5 text-xs text-gray-400">Нет доступных плейлистов</div>
                )}
              </div>
            ) : null}
          </div>

          {trackContextMenu.sourceCollectionId && trackContextMenu.sourceCollectionTitle && trackContextMenu.sourceCollectionTitle !== 'Liked Songs' ? (
            <button
              onClick={() => {
                setConfirmRemoveFromCollection({
                  collectionId: trackContextMenu.sourceCollectionId as number,
                  collectionTitle: trackContextMenu.sourceCollectionTitle as string,
                  track: trackContextMenu.track
                });
                setTrackContextMenu(null);
                setOpenTrackSubmenu(null);
              }}
              className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/10 transition-colors"
            >
              Удалить из этого плейлиста
            </button>
          ) : null}

          {likedTracks.some((track) => track.id === trackContextMenu.track.id) ? (
            <button
              onClick={() => {
                setConfirmUnlikeTrack(trackContextMenu.track);
                setTrackContextMenu(null);
                setOpenTrackSubmenu(null);
              }}
              className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/10 transition-colors"
            >
              Удалить из любимых треков
            </button>
          ) : (
            <button
              onClick={() => {
                void toggleLike(trackContextMenu.track, { skipUnlikeConfirm: true });
                setTrackContextMenu(null);
                setOpenTrackSubmenu(null);
              }}
              className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/10 transition-colors"
            >
              Добавить в любимые
            </button>
          )}

          <button
            onClick={() => {
              addToQueueNext(trackContextMenu.track);
              setTrackContextMenu(null);
              setOpenTrackSubmenu(null);
            }}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/10 transition-colors"
          >
            Добавить в очередь
          </button>

          <button
            onClick={() => {
              const artistId = getTrackArtistId(trackContextMenu.track);
              if (artistId) {
                void openArtistProfile(artistId);
              }
              setTrackContextMenu(null);
              setOpenTrackSubmenu(null);
            }}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/10 transition-colors"
          >
            К исполнителю
          </button>

          <div className="relative">
            <button
              onMouseEnter={() => setOpenTrackSubmenu('share')}
              onClick={() => setOpenTrackSubmenu((prev) => (prev === 'share' ? null : 'share'))}
              className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/10 transition-colors flex items-center justify-between"
            >
              <span>Поделиться</span>
              <span className="text-gray-400">{submenuOnLeft ? '<' : '>'}</span>
            </button>
            {openTrackSubmenu === 'share' ? (
              <div
                className={`absolute bottom-0 z-[60] ${submenuOnLeft ? 'right-full -mr-0.5' : 'left-full -ml-0.5'} w-56 bg-zinc-900 border border-white/10 rounded-lg shadow-2xl overflow-hidden`}
                onMouseEnter={() => setOpenTrackSubmenu('share')}
              >
                <button
                  onClick={() => {
                    void handleCopyTrackLink(trackContextMenu.track);
                    setTrackContextMenu(null);
                    setOpenTrackSubmenu(null);
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/10 transition-colors"
                >
                  Скопировать ссылку на трек
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Player Bar */}
      <div className="h-24 bg-black border-t border-white/5 fixed bottom-0 left-0 right-0 flex items-center px-4 z-20">
        {/* Track Info */}
        <div
          className="w-1/3 flex items-center gap-4"
          onContextMenu={(e) => {
            if (!currentTrack) return;
            e.preventDefault();
            e.stopPropagation();
            setTrackContextMenu({ x: e.clientX, y: e.clientY, track: currentTrack });
            setOpenTrackSubmenu(null);
          }}
        >
          {currentTrack && (
            <>
              {currentTrack.artwork_url ? (
                <img
                  src={currentTrack.artwork_url}
                  alt=""
                  className="w-14 h-14 rounded shadow-lg object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-14 h-14 rounded shadow-lg bg-zinc-700/80" />
              )}
              <div className="flex flex-col min-w-0">
                <div className="font-semibold text-sm truncate hover:underline cursor-pointer">{currentTrack.title}</div>
                <button
                  type="button"
                  onClick={() => handleArtistClick(currentTrack)}
                  className="text-xs text-gray-400 truncate hover:underline cursor-pointer text-left"
                >
                  {getTrackArtistName(currentTrack)}
                </button>
              </div>
              <button 
                onClick={() => toggleLike(currentTrack)}
                disabled={pendingLikeTrackIds.has(currentTrack.id)}
                className={`ml-2 transition-colors cursor-pointer ${likedTracks.some(t => t.id === currentTrack.id) ? 'accent-text' : 'text-gray-400 hover:text-white'}`}
              >
                <Heart size={18} className={likedTracks.some(t => t.id === currentTrack.id) ? 'fill-current' : ''} />
              </button>
            </>
          )}
        </div>

        {/* Controls */}
        <div className="w-1/3 flex flex-col items-center gap-2">
          <div className="flex items-center gap-6">
            <Shuffle 
              size={20} 
              className={`cursor-pointer transition-colors ${isShuffle ? 'accent-text' : 'text-gray-400 hover:text-white'}`} 
              onClick={() => setIsShuffle(!isShuffle)}
            />
            <SkipBack 
              size={24} 
              className={`fill-current ${isCurrentTrackUnavailable ? 'text-gray-600 cursor-default' : 'text-gray-400 hover:text-white cursor-pointer'}`}
              onClick={isCurrentTrackUnavailable ? undefined : handlePlayPrevious}
            />
            <button 
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-transform ${isCurrentTrackUnavailable ? 'bg-zinc-700 cursor-default' : 'bg-white hover:scale-105'}`}
              onClick={isCurrentTrackUnavailable ? undefined : togglePlay}
            >
              {isPlaying && !isCurrentTrackUnavailable ? <Pause size={20} className="text-black fill-current" /> : <Play size={20} className={`${isCurrentTrackUnavailable ? 'text-gray-500' : 'text-black'} fill-current ml-0.5`} />}
            </button>
            <SkipForward 
              size={24} 
              className={`fill-current ${isCurrentTrackUnavailable ? 'text-gray-600 cursor-default' : 'text-gray-400 hover:text-white cursor-pointer'}`}
              onClick={isCurrentTrackUnavailable ? undefined : handlePlayNext}
            />
            <div className="relative">
              <Repeat 
                size={20} 
                className={`cursor-pointer transition-colors ${repeatMode !== 'none' ? 'accent-text' : 'text-gray-400 hover:text-white'}`} 
                onClick={() => setRepeatMode(prev => prev === 'none' ? 'all' : prev === 'all' ? 'one' : 'none')}
              />
              {repeatMode === 'one' && (
                <span className="absolute -top-1.5 -right-1.5 accent-bg text-black text-[9px] font-black w-3.5 h-3.5 rounded-full flex items-center justify-center border border-black">
                  1
                </span>
              )}
            </div>
          </div>
          <div className="w-full max-w-md flex items-center gap-2">
            <span className="text-xs text-gray-400 w-10 text-right">
              {formatDuration(displayedTime * 1000)}
            </span>
            <input
              type="range"
              min={0}
              max={timelineDuration || 0}
              step={0.1}
              value={Math.min(displayedTime, timelineDuration || 0)}
              onChange={(e) => handleSeekChange(Number(e.target.value))}
              onMouseUp={commitSeek}
              onTouchEnd={commitSeek}
              onKeyUp={(e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown') {
                  commitSeek();
                }
              }}
              onBlur={commitSeek}
              onMouseEnter={() => setIsTimelineHovered(true)}
              onMouseLeave={() => setIsTimelineHovered(false)}
              disabled={!currentTrack || timelineDuration <= 0}
              className="player-range player-range--timeline flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: `linear-gradient(to right, ${isTimelineHovered ? 'var(--color-spotify-green)' : '#ffffff'} 0%, ${isTimelineHovered ? 'var(--color-spotify-green)' : '#ffffff'} ${displayedProgress}%, #4b5563 ${displayedProgress}%, #4b5563 100%)`
              }}
            />
            <span className="text-xs text-gray-400 w-10">
              {currentTrack ? formatDuration(timelineDuration * 1000) : '0:00'}
            </span>
          </div>
        </div>

        {/* Volume & Extra */}
        <div className="w-1/3 flex items-center justify-end gap-4">
          <button
            onClick={() => setIsQueueOpen((prev) => !prev)}
            className={`transition-colors ${isQueueOpen ? 'text-white' : 'text-gray-400 hover:text-white'}`}
          >
            <ListMusic size={20} />
          </button>
          <button onClick={toggleMute} className="text-gray-400 hover:text-white transition-colors">
            {volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </button>
          <input 
            type="range" 
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(Math.max(0, Math.min(1, Number(e.target.value))))}
            onMouseEnter={() => setIsVolumeHovered(true)}
            onMouseLeave={() => setIsVolumeHovered(false)}
            className="player-range player-range--volume w-24"
            style={{
              background: `linear-gradient(to right, ${isVolumeHovered ? 'var(--color-spotify-green)' : '#ffffff'} 0%, ${isVolumeHovered ? 'var(--color-spotify-green)' : '#ffffff'} ${volume * 100}%, #4b5563 ${volume * 100}%, #4b5563 100%)`
            }}
          />
          <span className="w-10 text-sm text-gray-300 text-left tabular-nums">
            {Math.round(volume * 100)}%
          </span>
        </div>
      </div>

      {isQueueOpen && (
        <div className="fixed bottom-28 right-4 w-96 max-w-[90vw] max-h-[60vh] bg-zinc-900 border border-white/10 rounded-xl shadow-2xl z-30 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <div className="text-sm font-semibold">Очередь</div>
            <button
              onClick={() => setIsQueueOpen(false)}
              className="text-xs text-gray-400 hover:text-white"
            >
              Закрыть
            </button>
          </div>
          <div className="overflow-y-auto max-h-[calc(60vh-48px)]">
            {visibleQueue.length > 0 ? (
              visibleQueue.map((track, index) => (
                <button
                  key={`queue-${track.id}-${queueStartIndex + index}`}
                  onClick={() => handleQueueSelect(track)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setTrackContextMenu({ x: e.clientX, y: e.clientY, track });
                    setOpenTrackSubmenu(null);
                  }}
                  className={`w-full px-4 py-2 text-left flex items-center gap-3 hover:bg-white/5 ${currentTrack?.id === track.id ? 'bg-white/10' : ''}`}
                >
                  {track.artwork_url ? (
                    <img
                      src={track.artwork_url.replace('large', 't500x500')}
                      alt=""
                      className="w-10 h-10 rounded object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded bg-zinc-700/80" />
                  )}
                  <div className="min-w-0">
                    <div className={`text-sm truncate ${currentTrack?.id === track.id ? 'accent-text' : 'text-white'}`}>{track.title}</div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleArtistClick(track);
                      }}
                      className="text-xs text-gray-400 truncate hover:underline text-left"
                    >
                      {getTrackArtistName(track)}
                    </button>
                  </div>
                </button>
              ))
            ) : (
              <div className="px-4 py-6 text-sm text-gray-400">Очередь пуста.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;

