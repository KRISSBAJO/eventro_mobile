# Eventro mobile

The Eventro fan app: discover events near you, buy tickets and show them at the door. Expo SDK 58, Expo Router,
TypeScript. It talks to the Eventro API ([eventro-be](https://github.com/KRISSBAJO/eventro_be)).

## Run it

```bash
npm install
cp .env.example .env.local      # then set EXPO_PUBLIC_API_URL (see below)
npx expo start
```

Scan the QR code with Expo Go on your phone. The phone and the computer must be on the same Wi-Fi.

**The API on a phone:** `127.0.0.1` on the phone is the phone itself, so:

- set `EXPO_PUBLIC_API_URL=http://<your computer's LAN IP>:4000/api/v1` in `.env.local` (`ipconfig` on Windows shows it),
- start the API so it listens on the network: `HOST=0.0.0.0 npm run dev` in eventro-be (it listens on 127.0.0.1 by default),
- allow port 4000 through the computer's firewall.

The web build (`npx expo start --web --port 8090`) is for quick checks in a browser; the API allows that origin in
development.

## Checks

```bash
npx tsc --noEmit
npx expo lint
```

## Layout

- `src/app/` screens (Expo Router): tabs for Discover, Search, Tickets and Account; `event/[slug]`, `checkout/[holdId]`,
  `ticket/[id]`, `place` and the sign-in screens.
- `src/lib/` API client, session, place, data hooks (React Query), formatting.
- `src/components/` the small design system, event cards, QR code.
- `src/theme.ts` colours, spacing, radii and fonts in one place.

Add packages with `npx expo install <package>` so versions match the SDK.
