# Soundtify

Soundtify это крутой плеер для ваших треков из SC в привычном интерфейсе.

Фишечки:
- Поиск треков
- Проигрывание лайкнутых треков
- Плейлисты
- Discord Rich Presence (отображение проигрываемого трека как в Spotify)
- Профили пользователей/артистов

Домены для zapret list'a для корректной работы в РФ:
- sndcdn.com
- soundcloud.com
- soundtify-h794.onrender.com

дальше хуйня для дебилов написанная нейронкой и ваще я наговнокодил, claude педик
(пж репу мою не удаляйте я честно ниче не нарушаю)

## Stack

- Frontend: React + Vite + TypeScript
- Backend: Express + TypeScript
- Desktop shell: Electron
- Native Windows integration: C# / .NET (`electron/smtc-bridge`)

## Project layout

- [`src/App.tsx`](./src/App.tsx): main application UI and playback logic
- [`src/main.tsx`](./src/main.tsx): React entry point
- [`src/index.css`](./src/index.css): application styles
- [`src/services/SoundCloudClient.ts`](./src/services/SoundCloudClient.ts): SoundCloud API client
- [`server.ts`](./server.ts): backend API, OAuth callback, cookie auth, static file serving
- [`electron/main.cjs`](./electron/main.cjs): Electron main process
- [`electron/preload.cjs`](./electron/preload.cjs): safe renderer bridge
- [`electron/smtc-bridge/Program.cs`](./electron/smtc-bridge/Program.cs): native Windows SMTC + Discord RPC bridge
- [`scripts/build-smtc-bridge.cjs`](./scripts/build-smtc-bridge.cjs): bridge build script
- [`build/icon.ico`](./build/icon.ico): Windows app icon

## Requirements

- Node.js 20+
- npm
- .NET SDK 8+ for the Windows SMTC bridge
- Windows for native desktop packaging and SMTC testing

## Environment variables

Copy `.env.example` to `.env` and fill in the values:

```env
SC_CLIENT_ID=
SC_OAUTH_CLIENT_ID=
SC_OAUTH_CLIENT_SECRET=
SC_APP_VERSION=
SC_APP_LOCALE=en
SC_DATADOME_CLIENT_ID=
DISCORD_CLIENT_ID=1483796229774114826
SC_OAUTH_REDIRECT_URI=http://localhost:3000/auth/callback
PORT=3000
COOKIE_SECURE=false
CORS_ORIGINS=http://localhost:3000
VITE_API_BASE_URL=http://localhost:3000
```

Notes:
- `SC_OAUTH_CLIENT_ID` and `SC_OAUTH_CLIENT_SECRET` are required.
- `SC_CLIENT_ID` is recommended. If it is not set, the app will try to auto-discover a public client id.
- `DISCORD_CLIENT_ID` is optional. If not set, the default Soundtify Discord application id is used.
- `COOKIE_SECURE=true` is required when running behind HTTPS in production.

## Local development

Install dependencies:

```bash
npm install
```

Run the backend + frontend locally:

```bash
npm run dev
```

Run the Electron app in development:

```bash
npm run dev:electron
```

## Production web build

Build the frontend:

```bash
npm run build
```

Start the production server:

```bash
npm run start
```

The backend serves the built frontend from `dist/`.

## Windows desktop build

Build the native SMTC bridge:

```bash
npm run build:smtc
```

Build unpacked Electron output:

```bash
npm run build:electron
```

Build Windows installer:

```bash
npm run dist:win:nsis
```

Build Windows portable version:

```bash
npm run dist:win:portable
```

Artifacts are written to `dist_electron/`.

## Deploying the backend

This project can be deployed to services like Render.

Typical production setup:
- Build command: `npm ci && npm run build`
- Start command: `npm run start`

Set these environment variables in production:
- `PORT`
- `COOKIE_SECURE=true`
- `CORS_ORIGINS`
- `SC_OAUTH_CLIENT_ID`
- `SC_OAUTH_CLIENT_SECRET`
- `SC_CLIENT_ID`
- `SC_OAUTH_REDIRECT_URI`
- `VITE_API_BASE_URL`
- optionally `DISCORD_CLIENT_ID`

## GitHub Actions releases

The repository includes a Windows release workflow:

- [`.github/workflows/release.yml`](./.github/workflows/release.yml)

What it does:
- installs Node.js and .NET on `windows-latest`
- builds the native SMTC bridge
- builds the NSIS installer
- builds the portable version
- uploads artifacts to the workflow run
- attaches `.exe` files to GitHub Releases when you push a tag like `v1.0.1`

Recommended GitHub configuration:

- Repository variables:
  - `VITE_API_BASE_URL`
  - `DISCORD_CLIENT_ID`
  - `SC_APP_VERSION`
  - `SC_APP_LOCALE`
  - `SC_OAUTH_REDIRECT_URI`
  - `CORS_ORIGINS`
- Repository secrets:
  - `SC_CLIENT_ID`
  - `SC_OAUTH_CLIENT_ID`
  - `SC_OAUTH_CLIENT_SECRET`
  - `SC_DATADOME_CLIENT_ID`

Recommended release flow:

```bash
git tag v1.0.1
git push origin v1.0.1
```

Or run the workflow manually with `workflow_dispatch`.

## Open-source notes

Before publishing the repository:
- do not commit `.env`
- do not commit build artifacts from `dist`, `dist_electron`, or `electron/smtc-bridge/bin`
- do not commit `electron/smtc-bridge/obj`
- do not commit HAR files or local debug logs

## Known limitations

- This is an unofficial SC client.
- SC endpoints, client ids, and anti-bot protections may change over time.
- Some tracks may be region-locked or unavailable due to SC restrictions.
- Windows SMTC and Discord RPC behavior is only tested through the Windows desktop build.

## License

This project is licensed under the MIT License.
