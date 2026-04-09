import express from 'express';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { SoundCloudClient } from './src/services/SoundCloudClient';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
app.set('trust proxy', 1);
const secureCookie = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';

app.use(express.json());
app.use(cookieParser());

const extractAuthToken = (req: express.Request) => {
  const authHeader = req.headers.authorization;
  return authHeader?.split(' ')[1] || req.cookies.sc_token;
};

const persistAuthCookie = (res: express.Response, token?: string) => {
  if (!token) return;
  res.cookie('sc_token', token, {
    httpOnly: true,
    secure: secureCookie,
    sameSite: secureCookie ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
};

const disableStreamCaching = (res: express.Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
};

const isAllowedPostMessageOrigin = (origin?: string | null) => {
  if (!origin) return false;
  if (origin === 'null') return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const encodeOAuthState = (payload: Record<string, string>) =>
  Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

const decodeOAuthState = (value?: string) => {
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, string>;
  } catch {
    return null;
  }
};

const corsAllowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowAny = corsAllowedOrigins.length === 0;
  const isAllowed = origin === 'null' || (origin ? corsAllowedOrigins.includes(origin) : false);

  if (origin && (allowAny || isAllowed)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Datadome-ClientId, X-SC-User-Id');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// дебаг
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  const authToken = extractAuthToken(req);
  if (authToken) {
    persistAuthCookie(res, authToken);
  }
  next();
});

let sc: SoundCloudClient;
let scInitialized = false;

const hasUserVisuals = (user: any) =>
  Array.isArray(user?.visuals?.visuals) &&
  user.visuals.visuals.some((item: any) => typeof item?.visual_url === 'string');

const enrichUserWithResolve = async (user: any) => {
  try {
    if (!user?.permalink_url) return user;
    if (hasUserVisuals(user)) return user;
    const resolved = await sc.resolveUrl(String(user.permalink_url));
    if (!resolved || typeof resolved !== 'object') return user;
    return {
      ...user,
      visuals: resolved.visuals || user.visuals,
      banner_url: resolved.banner_url || user.banner_url,
      header_image_url: resolved.header_image_url || user.header_image_url
    };
  } catch {
    return user;
  }
};

async function initSC() {
  try {
    const oauthClientId = process.env.SC_OAUTH_CLIENT_ID?.trim();
    const oauthClientSecret = process.env.SC_OAUTH_CLIENT_SECRET?.trim();
    const envClientId = process.env.SC_CLIENT_ID?.trim();
    if (!oauthClientId || !oauthClientSecret) {
      throw new Error('Missing required SoundCloud OAuth environment variables: SC_OAUTH_CLIENT_ID and/or SC_OAUTH_CLIENT_SECRET');
    }

    const discoveredClientId = await SoundCloudClient.discoverClientId();
    const publicClientId = discoveredClientId || envClientId;
    if (!publicClientId) {
      throw new Error('Unable to resolve SoundCloud client id. Set SC_CLIENT_ID or allow auto-discovery to succeed.');
    }

    process.env.SC_OAUTH_CLIENT_ID = oauthClientId;
    process.env.SC_OAUTH_CLIENT_SECRET = oauthClientSecret;
    process.env.SC_CLIENT_ID = publicClientId;

    console.log(
      'Using SoundCloud Public Client ID:',
      publicClientId,
      discoveredClientId ? '(auto-discovered)' : '(from env)'
    );
    console.log('Using SoundCloud OAuth credentials from environment');
    
    sc = new SoundCloudClient(publicClientId, oauthClientId, process.env.SC_DATADOME_CLIENT_ID);
    await sc.discoverDatadomeClientId();
    const discoveredDatadomeClientId = sc.getDatadomeClientId();
    if (discoveredDatadomeClientId) {
      process.env.SC_DATADOME_CLIENT_ID = discoveredDatadomeClientId;
      console.log('Using DataDome Client ID: auto-discovered');
    } else {
      console.log('Using DataDome Client ID: from env/manual');
    }
    scInitialized = true;
  } catch (e) {
    console.error('Failed to initialize SoundCloud Client:', e);
  }
}

initSC();

// middleware
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api/') && !scInitialized) {
    let attempts = 0;
    while (!scInitialized && attempts < 10) {
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }
    if (!scInitialized) return res.status(503).json({ error: 'SoundCloud client initializing' });
  }
  next();
});

// api rout'ы
app.get('/api/search', async (req, res) => {
  console.log('Search request:', req.query);
  try {
    const { q, limit, offset } = req.query;
    const data = await sc.searchTracks(q as string, Number(limit) || 30, Number(offset) || 0);
    res.json(data);
  } catch (error: any) {
    console.error('Search API Error:', error.message);
    res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
  }
});

app.get('/api/tracks/:id', async (req, res) => {
  console.log('Track request:', req.params.id);
  try {
    const token = extractAuthToken(req);
    const data = await sc.getTrack(req.params.id, token);
    res.json(data);
  } catch (error: any) {
    console.error('Track API Error:', error.message);
    res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
  }
});

app.get('/api/users/:id', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1] || req.cookies.sc_token;
    const data = await sc.getUserProfile(userId, token);
    const enriched = await enrichUserWithResolve(data);
    res.json(enriched);
  } catch (error: any) {
    console.error('User API Error:', error.message);
    res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
  }
});

app.get('/api/users/:id/tracks', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1] || req.cookies.sc_token;
    const limit = Number(req.query.limit) || 50;
    const data = await sc.getUserPublicTracks(userId, limit, token);
    res.json(data);
  } catch (error: any) {
    console.error('User Tracks API Error:', error.message);
    res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
  }
});

app.get('/api/users/:id/playlists', async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1] || req.cookies.sc_token;
    const limit = Number(req.query.limit) || 50;
    const data = await sc.getUserPublicPlaylists(userId, limit, token);
    res.json(data);
  } catch (error: any) {
    console.error('User Playlists API Error:', error.message);
    res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
  }
});

app.get('/api/stream/:id', async (req, res) => {
  console.log('Stream request:', req.params.id);
  try {
    disableStreamCaching(res);
    const token = extractAuthToken(req);
    const url = await sc.getStreamUrl(req.params.id, token);
    if (url) {
      res.json({ url });
    } else {
      res.status(404).json({ error: 'Stream not found' });
    }
  } catch (error: any) {
    console.error('Stream API Error:', error.message);
    res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
  }
});

app.get('/api/stream/transcoding', async (req, res) => {
  console.log('Transcoding stream request');
  try {
    disableStreamCaching(res);
    const transcodingUrl = String(req.query.url || '').trim();
    if (!transcodingUrl) {
      return res.status(400).json({ error: 'Missing transcoding url' });
    }
    const token = extractAuthToken(req);
    const url = await sc.getStreamUrlFromTranscoding(transcodingUrl, token);
    if (url) {
      res.json({ url });
    } else {
      res.status(404).json({ error: 'Stream not found' });
    }
  } catch (error: any) {
    console.error('Transcoding Stream API Error:', error.message);
    res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
  }
});

app.get('/api/trending', async (req, res) => {
  console.log('Trending request');
  try {
    const data = await sc.getTrending();
    res.json(data);
  } catch (error: any) {
    console.error('Trending API Error:', error.message);
    res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
  }
});

app.get('/api/resolve', async (req, res) => {
  try {
    const rawUrl = String(req.query.url || '').trim();
    if (!rawUrl) {
      return res.status(400).json({ error: 'Missing url query param' });
    }
    const data = await sc.resolveUrl(rawUrl);
    res.json(data);
  } catch (error: any) {
    console.error('Resolve API Error:', error.message);
    res.status(error.response?.status || 500).json(error.response?.data || { error: error.message });
  }
});

// auth rout'ы
app.get('/api/auth/url', (req, res) => {
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const redirectUri = `${proto}://${host}/auth/callback`;
  const openerOrigin = String(req.query.openerOrigin || '').trim();
  const state = isAllowedPostMessageOrigin(openerOrigin)
    ? encodeOAuthState({ openerOrigin })
    : undefined;
  
  console.log('Generating Auth URL with redirect_uri:', redirectUri);
  const url = sc.getAuthUrl(redirectUri, state);
  res.json({ url, redirectUri });
});

app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const redirectUri = `${proto}://${host}/auth/callback`;
  const decodedState = decodeOAuthState(typeof state === 'string' ? state : undefined);
  const openerOrigin = decodedState?.openerOrigin;
  const postMessageTarget = isAllowedPostMessageOrigin(openerOrigin) ? openerOrigin : '*';
  
  try {
    console.log('Exchanging code for tokens with redirect_uri:', redirectUri);
    const tokens = await sc.exchangeCode(code as string, redirectUri);
    if (!tokens.access_token) {
      throw new Error('No access_token found in SoundCloud response');
    }

    persistAuthCookie(res, tokens.access_token);
    
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ 
                type: 'OAUTH_AUTH_SUCCESS'
              }, ${JSON.stringify(postMessageTarget)});
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (error: any) {
    console.error('Auth Callback Error:', error.message);
    res.status(500).send('Authentication failed');
  }
});

app.get('/api/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1] || req.cookies.sc_token;

  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  
  try {
    const user = await sc.getMe(token);
    const enriched = await enrichUserWithResolve(user);
    res.json(enriched);
  } catch (error: any) {
    console.error('API /me error:', error.message, error.response?.data);
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

const resolveUserId = async (req: express.Request, token: string) => {
  const providedUserId = Number(req.body?.userId ?? req.query.userId ?? req.headers['x-sc-user-id']);
  if (Number.isFinite(providedUserId) && providedUserId > 0) {
    return providedUserId;
  }

  const me = await sc.getMe(token);
  return Number(me.id);
};

app.put('/api/me/favorites/:id', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1] || req.cookies.sc_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const trackId = Number(req.params.id);
    if (!Number.isFinite(trackId)) {
      return res.status(400).json({ error: 'Invalid track id' });
    }

    const userId = await resolveUserId(req, token);
    const datadomeClientId = (req.headers['x-datadome-clientid'] as string | undefined) || process.env.SC_DATADOME_CLIENT_ID;
    await sc.toggleFavorite(token, userId, trackId, true, datadomeClientId);
    res.json({ success: true });
  } catch (error: any) {
    console.error('PUT /api/me/favorites/:id error:', error.response?.status, error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

app.delete('/api/me/favorites/:id', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1] || req.cookies.sc_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const trackId = Number(req.params.id);
    if (!Number.isFinite(trackId)) {
      return res.status(400).json({ error: 'Invalid track id' });
    }

    const userId = await resolveUserId(req, token);
    const datadomeClientId = (req.headers['x-datadome-clientid'] as string | undefined) || process.env.SC_DATADOME_CLIENT_ID;
    await sc.toggleFavorite(token, userId, trackId, false, datadomeClientId);
    res.json({ success: true });
  } catch (error: any) {
    console.error('DELETE /api/me/favorites/:id error:', error.response?.status, error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

app.get('/api/me/favorites', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1] || req.cookies.sc_token;
  
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  
  try {
    const data = await sc.getUserFavorites(token);
    console.log(`Fetched ${data.length} favorites for user`);
    res.json(data);
  } catch (error: any) {
    console.error('API /me/favorites error:', error.message, error.response?.data);
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

const toLibraryItem = (item: any, source: 'created' | 'liked') => {
  if (item?.track) return null;

  const candidate = item?.playlist || item?.album || item;
  if (!candidate?.id || !candidate?.title) return null;

  const setType = candidate.set_type;
  const urn = String(candidate.urn || '');
  const explicitKind = String(candidate.kind || item?.kind || '').toLowerCase();
  const isAlbum = setType === 'album' || urn.includes(':albums:') || explicitKind === 'album';
  const isPlaylist = setType === 'playlist' || urn.includes(':playlists:') || explicitKind === 'playlist';
  if (!isAlbum && !isPlaylist) return null;

  const kind = isAlbum ? 'album' : 'playlist';
  const author = candidate.user?.username || candidate.publisher_metadata?.artist || 'Unknown';
  const sourceTracks = Array.isArray(candidate.tracks) ? candidate.tracks : (Array.isArray(item?.tracks) ? item.tracks : []);
  const previewArtworks = sourceTracks
    .slice(0, 8)
    .map((track: any) => track?.track?.artwork_url || track?.artwork_url || null);

  return {
    id: candidate.id,
    title: candidate.title,
    artwork_url: candidate.artwork_url,
    preview_artworks: previewArtworks,
    permalink_url: candidate.permalink_url,
    track_count: candidate.track_count || candidate.tracks?.length || 0,
    author,
    kind,
    source
  };
};

app.get('/api/me/library', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1] || req.cookies.sc_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const me = await sc.getMe(token);
    const [createdPlaylists, likes] = await Promise.all([
      sc.getUserPlaylists(token),
      sc.getUserLikes(token, Number(me.id))
    ]);

    const createdItems = createdPlaylists
      .map((item) => toLibraryItem(item, 'created'))
      .filter(Boolean);
    const likedItems = likes
      .map((item) => toLibraryItem(item, 'liked'))
      .filter(Boolean);

    const deduped = new Map<number, any>();
    [...createdItems, ...likedItems].forEach((entry: any) => {
      if (!deduped.has(entry.id)) {
        deduped.set(entry.id, entry);
      }
    });

    const items = Array.from(deduped.values());
    const missingArtItems = items.filter((item: any) => {
      const hasArtwork = Boolean(item.artwork_url);
      const previewCount = Array.isArray(item.preview_artworks)
        ? item.preview_artworks.filter((value: string | null) => Boolean(value)).length
        : 0;
      return !hasArtwork && previewCount === 0;
    });

    for (const item of missingArtItems) {
      try {
        const fullCollection = await sc.getCollectionById(token, item.id);
        const tracks = Array.isArray(fullCollection?.tracks) ? fullCollection.tracks : [];
        const fromTracks = tracks
          .slice(0, 8)
          .map((track: any) => track?.artwork_url || null);
        item.preview_artworks = fromTracks;
        if (!item.artwork_url) {
          item.artwork_url = fullCollection?.artwork_url || fromTracks.find((value: string | null) => Boolean(value)) || null;
        }
      } catch {}
    }

    res.json({
      user: me,
      items
    });
  } catch (error: any) {
    console.error('GET /api/me/library error:', error.response?.status, error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

app.post('/api/me/playlists', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1] || req.cookies.sc_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const title = String(req.body?.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Title is required' });

  try {
    const playlist = await sc.createPlaylist(token, title);
    res.json(playlist);
  } catch (error: any) {
    console.error('POST /api/me/playlists error:', error.response?.status, error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

app.post('/api/me/playlists/:id/tracks', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1] || req.cookies.sc_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const playlistId = Number(req.params.id);
  const trackId = Number(req.body?.trackId);
  if (!Number.isFinite(playlistId) || !Number.isFinite(trackId)) {
    return res.status(400).json({ error: 'Invalid playlist id or track id' });
  }

  try {
    const updated = await sc.addTrackToPlaylist(token, playlistId, trackId);
    res.json(updated);
  } catch (error: any) {
    console.error('POST /api/me/playlists/:id/tracks error:', error.response?.status, error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

app.delete('/api/me/playlists/:id/tracks/:trackId', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1] || req.cookies.sc_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const playlistId = Number(req.params.id);
  const trackId = Number(req.params.trackId);
  if (!Number.isFinite(playlistId) || !Number.isFinite(trackId)) {
    return res.status(400).json({ error: 'Invalid playlist id or track id' });
  }

  try {
    const updated = await sc.removeTrackFromPlaylist(token, playlistId, trackId);
    res.json(updated);
  } catch (error: any) {
    console.error('DELETE /api/me/playlists/:id/tracks/:trackId error:', error.response?.status, error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

app.get('/api/me/collections/:id', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1] || req.cookies.sc_token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const collectionId = Number(req.params.id);
  if (!Number.isFinite(collectionId)) {
    return res.status(400).json({ error: 'Invalid collection id' });
  }

  try {
    const collection = await sc.getCollectionById(token, collectionId);
    res.json(collection);
  } catch (error: any) {
    console.error('GET /api/me/collections/:id error:', error.response?.status, error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('sc_token', {
    httpOnly: true,
    secure: secureCookie,
    sameSite: secureCookie ? 'none' : 'lax'
  });
  res.json({ success: true });
});

// Vite middleware
if (process.env.NODE_ENV !== 'production') {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
