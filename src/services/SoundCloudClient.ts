import axios, { AxiosInstance } from 'axios';

export interface Track {
  id: number;
  title: string;
  user: {
    username: string;
    avatar_url: string;
  };
  duration: number;
  artwork_url: string;
  permalink_url: string;
  media: {
    transcodings: Array<{
      url: string;
      format: {
        protocol: string;
        mime_type: string;
      };
    }>;
  };
}

export class SoundCloudClient {
  private client_id: string;
  private oauth_client_id: string;
  private session: AxiosInstance;
  private datadomeClientId?: string;
  private apiBase = "https://api-v2.soundcloud.com";

  constructor(clientId: string, oauthClientId?: string, datadomeClientId?: string) {
    this.client_id = clientId;
    this.oauth_client_id = oauthClientId || clientId;
    this.datadomeClientId = datadomeClientId;
    this.session = axios.create({
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
      }
    });
  }

  getClientId() {
    return this.client_id;
  }

  getDatadomeClientId() {
    return this.datadomeClientId;
  }

  private setDatadomeClientId(value?: string) {
    if (value) {
      this.datadomeClientId = value;
    }
  }

  private async get(path: string, params: any = {}) {
    const response = await this.session.get(`${this.apiBase}${path}`, {
      params: { ...params, client_id: this.client_id }
    });
    return response.data;
  }

  private getClientIdCandidates() {
    return Array.from(
      new Set(
        [this.client_id, this.oauth_client_id, process.env.SC_CLIENT_ID, process.env.SC_OAUTH_CLIENT_ID]
          .map((value) => String(value || '').trim())
          .filter((value) => /^[a-zA-Z0-9]{32}$/.test(value))
      )
    );
  }

  private promoteClientId(clientId?: string) {
    if (!clientId || clientId === this.client_id) {
      return;
    }
    this.client_id = clientId;
    process.env.SC_CLIENT_ID = clientId;
  }

  private getAuthHeaders(accessToken: string, datadomeClientId?: string, clientId = this.client_id) {
    const headers: Record<string, string> = {
      Accept: 'application/json, text/javascript, */*; q=0.1',
      'X-Client-Id': clientId
    };

    const effectiveDatadomeClientId = datadomeClientId || this.datadomeClientId;
    if (effectiveDatadomeClientId) {
      headers['X-Datadome-ClientId'] = effectiveDatadomeClientId;
    }

    return headers;
  }

  private getAuthCandidates(accessToken: string, datadomeClientId?: string, clientId = this.client_id) {
    const baseHeaders = this.getAuthHeaders(accessToken, datadomeClientId, clientId);
    return [
      { ...baseHeaders, Authorization: `OAuth ${accessToken}` },
      { ...baseHeaders, Authorization: `Bearer ${accessToken}` },
      { ...baseHeaders, Authorization: accessToken }
    ];
  }

  private getOptionalAuthCandidates(accessToken?: string, clientId = this.client_id, datadomeClientId?: string) {
    if (!accessToken) return [{}];
    return [...this.getAuthCandidates(accessToken, datadomeClientId, clientId), {}];
  }

  private async getWithFallback(
    attempts: Array<{ url: string; params?: Record<string, any>; clientId?: string }>,
    accessToken?: string,
    datadomeClientId?: string
  ) {
    let lastError: any;

    for (const attempt of attempts) {
      const authCandidates = this.getOptionalAuthCandidates(accessToken, attempt.clientId || this.client_id, datadomeClientId);
      for (const headers of authCandidates) {
        try {
          const response = await this.session.get(attempt.url, {
            params: attempt.params,
            headers
          });
          this.promoteClientId(attempt.clientId);
          return response.data;
        } catch (error) {
          lastError = error;
        }
      }
    }

    throw lastError;
  }

  async searchTracks(query: string, limit = 30, offset = 0) {
    return this.get('/search/tracks', { q: query, limit, offset, linked_partitioning: 1 });
  }

  async getTrack(id: string, accessToken?: string) {
    const clientIdCandidates = this.getClientIdCandidates();
    const appVersion = process.env.SC_APP_VERSION || '1771839977';
    const appLocale = process.env.SC_APP_LOCALE || 'en';
    const attempts = [
      ...clientIdCandidates.map((clientId) => ({
        url: `${this.apiBase}/tracks/${id}`,
        params: {
          client_id: clientId,
          app_version: appVersion,
          app_locale: appLocale
        },
        clientId
      })),
      ...clientIdCandidates.map((clientId) => ({
        url: `https://api.soundcloud.com/tracks/${id}`,
        params: { client_id: clientId },
        clientId
      })),
      ...(accessToken
        ? [
            {
              url: `${this.apiBase}/tracks/${id}`,
              params: {
                app_version: appVersion,
                app_locale: appLocale
              }
            },
            {
              url: `https://api.soundcloud.com/tracks/${id}`
            }
          ]
        : [])
    ];

    return this.getWithFallback(attempts, accessToken);
  }

  async resolveUrl(url: string) {
    return this.get('/resolve', {
      url,
      app_version: process.env.SC_APP_VERSION || '1771839977',
      app_locale: process.env.SC_APP_LOCALE || 'en'
    });
  }

  private normalizeCollectionResponse(data: any) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.collection)) return data.collection;
    return [];
  }

  async getUserProfile(userId: number, accessToken?: string) {
    const authCandidates = this.getOptionalAuthCandidates(accessToken);
    const appVersion = process.env.SC_APP_VERSION || '1771839977';
    const appLocale = process.env.SC_APP_LOCALE || 'en';
    const attempts = [
      {
        url: `${this.apiBase}/users/${userId}`,
        params: { client_id: this.client_id, app_version: appVersion, app_locale: appLocale }
      },
      {
        url: `https://api.soundcloud.com/users/${userId}`,
        params: { client_id: this.client_id }
      },
      {
        url: `https://api.soundcloud.com/users/${userId}`
      }
    ];

    let lastError: any;
    for (const headers of authCandidates) {
      for (const attempt of attempts) {
        try {
          const response = await axios.get(attempt.url, {
            params: attempt.params,
            headers
          });
          return response.data;
        } catch (error) {
          lastError = error;
        }
      }
    }

    throw lastError || new Error(`Failed to fetch user ${userId}`);
  }

  async getUserPublicTracks(userId: number, limit = 50, accessToken?: string) {
    const authCandidates = this.getOptionalAuthCandidates(accessToken);
    const appVersion = process.env.SC_APP_VERSION || '1771839977';
    const appLocale = process.env.SC_APP_LOCALE || 'en';
    const attempts = [
      {
        url: `${this.apiBase}/users/${userId}/tracks`,
        params: { limit, linked_partitioning: 1, client_id: this.client_id, app_version: appVersion, app_locale: appLocale }
      },
      {
        url: `https://api.soundcloud.com/users/${userId}/tracks`,
        params: { limit, linked_partitioning: 1, client_id: this.client_id }
      },
      {
        url: `https://api.soundcloud.com/users/${userId}/tracks`,
        params: { limit, linked_partitioning: 1 }
      }
    ];

    for (const headers of authCandidates) {
      for (const attempt of attempts) {
        try {
          const response = await axios.get(attempt.url, {
            params: attempt.params,
            headers
          });
          const tracks = this.normalizeCollectionResponse(response.data);
          if (tracks.length > 0) {
            return tracks;
          }
        } catch {
          // Try next endpoint/header combination.
        }
      }
    }

    return [];
  }

  async getUserPublicPlaylists(userId: number, limit = 50, accessToken?: string) {
    const authCandidates = this.getOptionalAuthCandidates(accessToken);
    const appVersion = process.env.SC_APP_VERSION || '1771839977';
    const appLocale = process.env.SC_APP_LOCALE || 'en';
    const attempts = [
      {
        url: `${this.apiBase}/users/${userId}/playlists`,
        params: { limit, linked_partitioning: 1, client_id: this.client_id, app_version: appVersion, app_locale: appLocale }
      },
      {
        url: `https://api.soundcloud.com/users/${userId}/playlists`,
        params: { limit, linked_partitioning: 1, client_id: this.client_id }
      },
      {
        url: `https://api.soundcloud.com/users/${userId}/playlists`,
        params: { limit, linked_partitioning: 1 }
      }
    ];

    for (const headers of authCandidates) {
      for (const attempt of attempts) {
        try {
          const response = await axios.get(attempt.url, {
            params: attempt.params,
            headers
          });
          const collections = this.normalizeCollectionResponse(response.data);
          if (collections.length > 0) {
            return collections;
          }
        } catch {
          // Try next endpoint/header combination.
        }
      }
    }

    return [];
  }

  async getStreamUrl(trackId: string, accessToken?: string) {
    try {
      const track = await this.getTrack(trackId, accessToken);
      const transcodings = track.media?.transcodings || [];
      // Prefer progressive, then hls
      const progressive = transcodings.find((t: any) => t.format.protocol === 'progressive');
      const hls = transcodings.find((t: any) => t.format.protocol === 'hls');
      
      const target = progressive || hls;
      if (target) {
        return this.getStreamUrlFromTranscoding(target.url, accessToken);
      }
    } catch (e) {
      console.error('Error getting stream URL:', e);
    }
    return null;
  }

  async getStreamUrlFromTranscoding(transcodingUrl: string, accessToken?: string) {
    try {
      const attempts = [
        ...this.getClientIdCandidates().map((clientId) => ({
          url: transcodingUrl,
          params: { client_id: clientId },
          clientId
        })),
        ...(accessToken
          ? [
              {
                url: transcodingUrl
              }
            ]
          : [])
      ];
      const streamData = await this.getWithFallback(attempts, accessToken);
      return streamData?.url || null;
    } catch (e) {
      console.error('Error getting stream URL from transcoding:', e);
    }
    return null;
  }

  // Simple client_id discovery
  static async discoverClientId() {
    try {
      const response = await axios.get('https://soundcloud.com', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const scriptUrls = response.data.match(/https:\/\/a-v2\.sndcdn\.com\/assets\/[a-zA-Z0-9-]+\.js/g);
      if (scriptUrls) {
        for (const url of scriptUrls.reverse()) {
          const scriptResponse = await axios.get(url);
          const match =
            scriptResponse.data.match(/client_id:"([a-zA-Z0-9]{32})"/) ||
            scriptResponse.data.match(/client_id["']?\s*:\s*["']([a-zA-Z0-9]{32})["']/) ||
            scriptResponse.data.match(/client_id=([a-zA-Z0-9]{32})/);
          if (match) return match[1];
        }
      }
    } catch (e) {
      console.error('Discovery error:', e);
    }
    return undefined;
  }

  async discoverDatadomeClientId() {
    try {
      const response = await axios.get('https://soundcloud.com', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const setCookieHeader = response.headers['set-cookie'];
      const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : (setCookieHeader ? [setCookieHeader] : []);
      const datadomeCookie = cookies.find((cookie: string) => cookie.toLowerCase().startsWith('datadome='));
      if (datadomeCookie) {
        const value = datadomeCookie.split(';')[0]?.split('=')[1];
        this.setDatadomeClientId(value);
        return value;
      }
    } catch (error) {
      console.warn('Failed to auto-discover datadome client id:', (error as any)?.message || error);
    }
    return this.datadomeClientId;
  }

  async getTrending(limit = 20) {
    try {
      // Try charts first (v2 API)
      const data = await this.get('/charts', { 
        kind: 'top', 
        genre: 'soundcloud:genres:all-music', 
        limit 
      });
      if (data && data.collection && data.collection.length > 0) {
        return data;
      }
      throw new Error('No tracks in charts collection');
    } catch (e: any) {
      console.warn('Charts API failed or returned empty, falling back to search:', e.message);
      try {
        // Fallback: search for popular tracks
        const searchData = await this.searchTracks('trending', limit);
        if (searchData && searchData.collection) {
          return searchData;
        }
      } catch (searchError: any) {
        console.error('Trending fallback search also failed:', searchError.message);
      }
      throw e; // Re-throw original error if fallback also fails
    }
  }

  // OAuth Methods
  getAuthUrl(redirectUri: string, state?: string) {
    const params = new URLSearchParams({
      client_id: this.oauth_client_id,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'non-expiring'
    });
    if (state) {
      params.set('state', state);
    }
    return `https://secure.soundcloud.com/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string) {
    const params = new URLSearchParams({
      client_id: process.env.SC_OAUTH_CLIENT_ID || '',
      client_secret: process.env.SC_OAUTH_CLIENT_SECRET || '',
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code
    });
    const response = await axios.post('https://api.soundcloud.com/oauth2/token', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    return response.data;
  }

  async getUserFavorites(accessToken: string, limit = 500) {
    let allTracks: any[] = [];
    let nextHref = `https://api.soundcloud.com/me/favorites?limit=${limit}&linked_partitioning=1`;
    
    // Fetch up to 10 pages (approx 5000 tracks)
    let pages = 0;
    while (nextHref && pages < 10) {
      console.log(`Fetching favorites page ${pages + 1}...`);
      const response = await axios.get(nextHref, {
        headers: { 'Authorization': `OAuth ${accessToken}` }
      });
      
      const data = response.data;
      if (Array.isArray(data)) {
        allTracks = [...allTracks, ...data];
        console.log(`Page ${pages + 1} returned ${data.length} tracks (array)`);
        break;
      } else if (data.collection) {
        allTracks = [...allTracks, ...data.collection];
        console.log(`Page ${pages + 1} returned ${data.collection.length} tracks (collection). Total: ${allTracks.length}`);
        nextHref = data.next_href;
      } else {
        break;
      }
      pages++;
    }
    return allTracks;
  }

  private async collectPaginated(nextHref: string, accessToken: string, pageLimit = 10) {
    const allItems: any[] = [];
    let page = 0;
    while (nextHref && page < pageLimit) {
      const response = await axios.get(nextHref, {
        headers: { Authorization: `OAuth ${accessToken}` }
      });
      const data = response.data;
      if (Array.isArray(data)) {
        allItems.push(...data);
        break;
      }
      if (data?.collection && Array.isArray(data.collection)) {
        allItems.push(...data.collection);
        nextHref = data.next_href;
      } else {
        break;
      }
      page++;
    }
    return allItems;
  }

  async getUserPlaylists(accessToken: string, limit = 200) {
    const startUrl = `https://api.soundcloud.com/me/playlists?limit=${limit}&linked_partitioning=1`;
    return this.collectPaginated(startUrl, accessToken);
  }

  async getUserLikes(accessToken: string, userId: number, limit = 200) {
    const authCandidates = this.getAuthCandidates(accessToken, this.datadomeClientId);
    const clientIdCandidates = Array.from(
      new Set([this.client_id, this.oauth_client_id, process.env.SC_CLIENT_ID, process.env.SC_OAUTH_CLIENT_ID].filter(Boolean))
    ) as string[];

    const attempts = [
      ...clientIdCandidates.map((clientId) => ({
        url: `${this.apiBase}/users/${userId}/likes`,
        params: { client_id: clientId, limit, linked_partitioning: 1, app_version: process.env.SC_APP_VERSION || '1771839977', app_locale: process.env.SC_APP_LOCALE || 'en' }
      })),
      ...clientIdCandidates.map((clientId) => ({
        url: `${this.apiBase}/me/likes`,
        params: { client_id: clientId, limit, linked_partitioning: 1, app_version: process.env.SC_APP_VERSION || '1771839977', app_locale: process.env.SC_APP_LOCALE || 'en' }
      })),
      {
        url: `https://api.soundcloud.com/me/likes`,
        params: { limit, linked_partitioning: 1 }
      }
    ];

    for (const headers of authCandidates) {
      for (const attempt of attempts) {
        try {
          const response = await axios.get(attempt.url, {
            params: attempt.params,
            headers
          });
          const data = response.data;
          if (Array.isArray(data)) {
            return data;
          }
          if (data?.collection && Array.isArray(data.collection)) {
            return data.collection;
          }
        } catch {
          // try next
        }
      }
    }

    return [];
  }

  async createPlaylist(accessToken: string, title: string) {
    const payload = {
      playlist: {
        title,
        sharing: 'private',
        tracks: []
      }
    };

    const authCandidates = this.getAuthCandidates(accessToken, this.datadomeClientId);
    const attempts = [
      {
        method: 'post' as const,
        url: `https://api.soundcloud.com/playlists`,
        data: payload
      },
      {
        method: 'post' as const,
        url: `${this.apiBase}/playlists`,
        params: { client_id: this.client_id, app_version: process.env.SC_APP_VERSION || '1771839977', app_locale: process.env.SC_APP_LOCALE || 'en' },
        data: payload
      }
    ];

    let lastError: any;
    for (const headers of authCandidates) {
      for (const attempt of attempts) {
        try {
          const response = await axios({
            method: attempt.method,
            url: attempt.url,
            params: attempt.params,
            data: attempt.data,
            headers
          });
          return response.data;
        } catch (error) {
          lastError = error;
        }
      }
    }

    throw lastError || new Error('Failed to create playlist');
  }

  async addTrackToPlaylist(accessToken: string, playlistId: number, trackId: number) {
    const collection = await this.getCollectionById(accessToken, playlistId);
    const existingTracks = Array.isArray(collection?.tracks) ? collection.tracks : [];
    const normalizedTrackIds = existingTracks
      .map((item: any) => Number(item?.id ?? item?.track?.id))
      .filter((value: number) => Number.isFinite(value) && value > 0);

    if (normalizedTrackIds.includes(trackId)) {
      return collection;
    }

    const nextTrackIds = [...normalizedTrackIds, trackId];
    const payload = {
      playlist: {
        tracks: nextTrackIds.map((id) => ({ id }))
      }
    };

    const authCandidates = this.getAuthCandidates(accessToken, this.datadomeClientId);
    const attempts = [
      {
        method: 'put' as const,
        url: `https://api.soundcloud.com/playlists/${playlistId}`,
        data: payload
      },
      {
        method: 'put' as const,
        url: `${this.apiBase}/playlists/${playlistId}`,
        params: {
          client_id: this.client_id,
          app_version: process.env.SC_APP_VERSION || '1771839977',
          app_locale: process.env.SC_APP_LOCALE || 'en'
        },
        data: payload
      }
    ];

    let lastError: any;
    for (const headers of authCandidates) {
      for (const attempt of attempts) {
        try {
          const response = await axios({
            method: attempt.method,
            url: attempt.url,
            params: attempt.params,
            data: attempt.data,
            headers
          });
          return response.data;
        } catch (error) {
          lastError = error;
        }
      }
    }

    throw lastError || new Error(`Failed to add track ${trackId} to playlist ${playlistId}`);
  }

  async removeTrackFromPlaylist(accessToken: string, playlistId: number, trackId: number) {
    const collection = await this.getCollectionById(accessToken, playlistId);
    const existingTracks = Array.isArray(collection?.tracks) ? collection.tracks : [];
    const normalizedTrackIds = existingTracks
      .map((item: any) => Number(item?.id ?? item?.track?.id))
      .filter((value: number) => Number.isFinite(value) && value > 0);

    if (!normalizedTrackIds.includes(trackId)) {
      return collection;
    }

    const nextTrackIds = normalizedTrackIds.filter((id) => id !== trackId);
    const payload = {
      playlist: {
        tracks: nextTrackIds.map((id) => ({ id }))
      }
    };

    const authCandidates = this.getAuthCandidates(accessToken, this.datadomeClientId);
    const attempts = [
      {
        method: 'put' as const,
        url: `https://api.soundcloud.com/playlists/${playlistId}`,
        data: payload
      },
      {
        method: 'put' as const,
        url: `${this.apiBase}/playlists/${playlistId}`,
        params: {
          client_id: this.client_id,
          app_version: process.env.SC_APP_VERSION || '1771839977',
          app_locale: process.env.SC_APP_LOCALE || 'en'
        },
        data: payload
      }
    ];

    let lastError: any;
    for (const headers of authCandidates) {
      for (const attempt of attempts) {
        try {
          const response = await axios({
            method: attempt.method,
            url: attempt.url,
            params: attempt.params,
            data: attempt.data,
            headers
          });
          return response.data;
        } catch (error) {
          lastError = error;
        }
      }
    }

    throw lastError || new Error(`Failed to remove track ${trackId} from playlist ${playlistId}`);
  }

  async getCollectionById(accessToken: string, collectionId: number) {
    const authCandidates = this.getAuthCandidates(accessToken, this.datadomeClientId);
    const clientIdCandidates = Array.from(
      new Set([this.client_id, this.oauth_client_id, process.env.SC_CLIENT_ID, process.env.SC_OAUTH_CLIENT_ID].filter(Boolean))
    ) as string[];

    const attempts = [
      ...clientIdCandidates.map((clientId) => ({
        url: `${this.apiBase}/playlists/${collectionId}`,
        params: { client_id: clientId, app_version: process.env.SC_APP_VERSION || '1771839977', app_locale: process.env.SC_APP_LOCALE || 'en' }
      })),
      {
        url: `https://api.soundcloud.com/playlists/${collectionId}`
      }
    ];

    let lastError: any;
    for (const headers of authCandidates) {
      for (const attempt of attempts) {
        try {
          const response = await axios.get(attempt.url, {
            params: attempt.params,
            headers
          });
          return response.data;
        } catch (error) {
          lastError = error;
        }
      }
    }

    throw lastError || new Error(`Failed to fetch collection ${collectionId}`);
  }

  async toggleFavorite(
    accessToken: string,
    userId: number,
    trackId: number,
    isFavorite: boolean,
    datadomeClientId?: string
  ) {
    const action = isFavorite ? 'like' : 'unlike';
    const authCandidates = this.getAuthCandidates(accessToken, datadomeClientId);
    const appVersion = process.env.SC_APP_VERSION || '1771839977';
    const appLocale = process.env.SC_APP_LOCALE || 'en';
    const clientIdCandidates = Array.from(
      new Set([this.client_id, this.oauth_client_id, process.env.SC_CLIENT_ID, process.env.SC_OAUTH_CLIENT_ID].filter(Boolean))
    ) as string[];
    const oauthParams = { oauth_token: accessToken };
    const oauthParamsWithClient = { oauth_token: accessToken, client_id: this.client_id };

    const v2LikeAttempts = clientIdCandidates.flatMap((clientId) => [
      {
        method: 'put' as const,
        url: `${this.apiBase}/users/${userId}/track_likes/${trackId}`,
        params: { client_id: clientId, app_version: appVersion, app_locale: appLocale }
      },
      {
        method: 'put' as const,
        url: `${this.apiBase}/me/track_likes/${trackId}`,
        params: { client_id: clientId, app_version: appVersion, app_locale: appLocale }
      },
      {
        method: 'put' as const,
        url: `${this.apiBase}/users/${userId}/likes/${trackId}`,
        params: { client_id: clientId, app_version: appVersion, app_locale: appLocale }
      },
      {
        method: 'put' as const,
        url: `${this.apiBase}/me/likes/${trackId}`,
        params: { client_id: clientId, app_version: appVersion, app_locale: appLocale }
      },
      {
        method: 'put' as const,
        url: `${this.apiBase}/users/${userId}/track_likes/${trackId}`,
        params: { client_id: clientId }
      },
      {
        method: 'put' as const,
        url: `${this.apiBase}/me/track_likes/${trackId}`,
        params: { client_id: clientId }
      }
    ]);

    const v2UnlikeAttempts = clientIdCandidates.flatMap((clientId) => [
      {
        method: 'delete' as const,
        url: `${this.apiBase}/users/${userId}/track_likes/${trackId}`,
        params: { client_id: clientId, app_version: appVersion, app_locale: appLocale }
      },
      {
        method: 'delete' as const,
        url: `${this.apiBase}/me/track_likes/${trackId}`,
        params: { client_id: clientId, app_version: appVersion, app_locale: appLocale }
      },
      {
        method: 'delete' as const,
        url: `${this.apiBase}/users/${userId}/likes/${trackId}`,
        params: { client_id: clientId, app_version: appVersion, app_locale: appLocale }
      },
      {
        method: 'delete' as const,
        url: `${this.apiBase}/me/likes/${trackId}`,
        params: { client_id: clientId, app_version: appVersion, app_locale: appLocale }
      },
      {
        method: 'delete' as const,
        url: `${this.apiBase}/users/${userId}/track_likes/${trackId}`,
        params: { client_id: clientId }
      },
      {
        method: 'delete' as const,
        url: `${this.apiBase}/me/track_likes/${trackId}`,
        params: { client_id: clientId }
      }
    ]);

    const attempts = isFavorite
      ? [
          ...v2LikeAttempts,
          {
            method: 'post' as const,
            url: `https://api.soundcloud.com/likes/tracks/${trackId}`
          },
          {
            method: 'put' as const,
            url: `https://api.soundcloud.com/likes/tracks/${trackId}`
          },
          {
            method: 'post' as const,
            url: `https://api.soundcloud.com/likes/tracks/${trackId}`,
            params: oauthParamsWithClient,
            skipAuthHeader: true
          },
          {
            method: 'put' as const,
            url: `https://api.soundcloud.com/me/favorites/${trackId}`
          },
          {
            method: 'post' as const,
            url: `https://api.soundcloud.com/me/favorites/${trackId}`
          },
          {
            method: 'put' as const,
            url: `https://api.soundcloud.com/me/favorites/${trackId}`,
            params: oauthParamsWithClient,
            skipAuthHeader: true
          },
          {
            method: 'post' as const,
            url: `https://api.soundcloud.com/me/favorites/${trackId}`,
            params: oauthParamsWithClient,
            skipAuthHeader: true
          },
          {
            method: 'post' as const,
            url: `https://api.soundcloud.com/me/favorites`,
            data: { track_id: trackId }
          },
          {
            method: 'post' as const,
            url: `https://api.soundcloud.com/me/favorites`,
            params: oauthParams,
            data: { track_id: trackId },
            skipAuthHeader: true
          },
          {
            method: 'put' as const,
            url: `https://api.soundcloud.com/users/${userId}/favorites/${trackId}`,
            params: oauthParamsWithClient,
            skipAuthHeader: true
          }
        ]
      : [
          ...v2UnlikeAttempts,
          {
            method: 'delete' as const,
            url: `https://api.soundcloud.com/likes/tracks/${trackId}`
          },
          {
            method: 'delete' as const,
            url: `https://api.soundcloud.com/likes/tracks/${trackId}`,
            params: oauthParamsWithClient,
            skipAuthHeader: true
          },
          {
            method: 'delete' as const,
            url: `https://api.soundcloud.com/me/favorites/${trackId}`
          },
          {
            method: 'delete' as const,
            url: `https://api.soundcloud.com/me/favorites/${trackId}`,
            params: oauthParamsWithClient,
            skipAuthHeader: true
          },
          {
            method: 'delete' as const,
            url: `https://api.soundcloud.com/users/${userId}/favorites/${trackId}`,
            params: oauthParamsWithClient,
            skipAuthHeader: true
          }
        ];

    let lastError: any;
    const failureNotes: string[] = [];

    const requestCandidates = [
      ...authCandidates.map((headers) => ({ headers, withHeader: true })),
      { headers: {}, withHeader: false }
    ];

    for (const candidate of requestCandidates) {
      for (const attempt of attempts) {
        if (attempt.skipAuthHeader && candidate.withHeader) {
          continue;
        }

        try {
          const response = await axios({
            method: attempt.method,
            url: attempt.url,
            params: attempt.params,
            data: attempt.data,
            headers: candidate.headers
          });
          return response.data;
        } catch (error: any) {
          lastError = error;
          const status = error.response?.status ?? 'ERR';
          const detail = error.response?.data?.error || error.response?.data?.message || error.response?.data || error.message;
          failureNotes.push(`${attempt.method.toUpperCase()} ${attempt.url} -> ${status}: ${JSON.stringify(detail)}`);
        }
      }
    }

    if (lastError?.response) {
      throw new Error(`Failed to ${action} track ${trackId}. Attempts: ${failureNotes.slice(0, 6).join(' | ')}`);
    }

    throw lastError || new Error(`Failed to ${action} track ${trackId}`);
  }

  async getMe(accessToken: string) {
    const response = await axios.get('https://api.soundcloud.com/me', {
      headers: { 'Authorization': `OAuth ${accessToken}` }
    });
    return response.data;
  }
}
