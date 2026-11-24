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

## Phase 2: sign-in, notifications, offline tickets, door scanning

- **Sign-in** is a device session: a 1-hour access token and a rotating refresh token in secure storage. The API
  client refreshes before the token runs out and after a 401, one refresh at a time (`src/lib/api.ts`). Account →
  Signed-in devices lists and signs out sessions.
- **Push notifications** (`src/lib/push.ts`) need a development build on Android (Expo Go removed remote push in
  SDK 53) and an EAS project id: run `npx eas-cli@latest init` once, which writes `extra.eas.projectId` to the app
  config. Without it the app explains why notifications can't be turned on. Permission is asked after a first purchase
  and from Account → Notifications, never at launch. Tapping a notification opens its `data.path`.
- **Door codes work offline**: tickets carry a QR seed and the phone makes the rotating code itself
  (`src/lib/door-code.ts`, HMAC-SHA256 in `src/lib/hmac.ts`). Saved tickets and door packs are AES-GCM encrypted
  with a key in the keychain (`src/lib/vault.ts`) and wiped on sign-out.
- **Transfers, resale and gifts** from the ticket screen; Sales & payouts; gift links open `/gift/<token>`.
- **Organizer tools** (team members only): a door scanner with camera QR scanning, offline mode with a downloaded
  guest list and sync, manual lookup. The web preview has no camera: type or paste codes instead.
- **Paystack** opens in an auth session (`WebBrowser.openAuthSessionAsync(url, 'eventro://')`). Orders are created
  with `returnTo: 'app'`, so after paying, the website's return page confirms the payment and hands back to
  `eventro://tickets`, which closes the browser; the app still verifies (and polls) the order itself.
- **Discover's "Trending" rail** uses `GET /events?sort=popular` (tickets sold in the last 14 days) and only says
  "Trending" when something has sold lately. **Search's price filter** is in the visitor's currency
  (`currency=` with `maxPrice`); the API converts each event's price, and results show "≈" the converted price.
- **Door scanner**: the event picker uses `GET /organizer/orgs/:id/door-events`; "N of M checked in" counts non-void
  tickets online and offline; a repeat scan says "Already scanned at 7:42 PM by Sam (other device)".
- **Links**: `eventro://tickets/<id>`, `eventro://events/<slug>`, `eventro://gift/<token>`,
  `eventro://reset-password?token=…` (and the same paths on the web build).

## Phase 3: fan parity

- **Saved events** (`src/lib/saved.ts`): hearts on event cards and the event screen. Signed out they're kept on the
  phone (with a copy of each card, so Account → Saved events works offline); signed in they live on the server
  (`GET/PUT/DELETE /me/saved`), the same list as the website. At sign-in the phone's hearts are merged once
  (`POST /me/saved/sync`) and forgotten here.
- **Exact seats** (`src/app/seats/[slug].tsx`): for events with a seat map, "Choose seats" lists sections with places
  left and the best seats together (`GET /events/:slug/availability`), then a row-by-row grid of finger-sized seats
  (sold and held ones from `/sections/:id/seats`). The hold reserves exactly the seats picked (`POST /holds` with
  `sectionId` and `seats`). "Skip the map" still holds the best seats together.
- **Gifts at checkout** (`src/components/gift-option.tsx`): "This is a gift" sends `gift: { name, email, message?,
  sendAt?, hidePrice? }` with the order. The delivery time is picked from day and time chips (no native date picker).
- **Price-drop alerts** (`POST /events/:slug/price-watch`), a **swipeable gallery** of the event's photos and videos
  (videos open mediaEX's player in the in-app browser: no video library is installed), and **share** with the
  website link (`EXPO_PUBLIC_WEB_URL`).
- **Venue, category and city pages** (`venue/[slug]`, `category/[category]`, `city/[city]`), from the event screen and
  Discover; the lists reuse Search's query, date chips and sort. Venues have "Open in Maps" (Apple Maps on iOS, the
  maps app on Android, Google Maps on the web). There is no in-app map: that needs a native maps library.
- **Orders & receipts** (Account): `GET /me/orders`, a receipt per order and "Request a refund"
  (`POST /orders/:id/refund-requests`), with the request's state.
- **Confirmations** use an in-app sheet (`src/components/confirm.tsx`) instead of `Alert`/`window.confirm`. Embedded
  browsers can block `window.confirm` (it returns false at once without showing anything), which is why Sign out
  did nothing in the web preview.

Camera scanning and push need a phone; camera works in Expo Go, remote push needs a development build
(`npx expo run:android|ios` or `eas build --profile development`).

## Checks

```bash
npx tsc --noEmit
npx expo lint
```

## Layout

- `src/app/` screens (Expo Router): tabs for Discover, Search, Tickets and Account; `event/[slug]`, `seats/[slug]`,
  `checkout/[holdId]`, `saved`, `orders`, `order/[id]`, `venue/[slug]`, `category/[category]`, `city/[city]`,
  `ticket/[id]`, `transfer/[id]`, `sell/[id]`, `resale`, `gift/[token]`, `devices`, `notifications`, `organizer`,
  `door/[eventId]`, `place` and the sign-in screens; `tickets/[id]` and `events/[slug]` redirect website paths.
- `src/lib/` API client, session, place, data hooks (React Query), formatting.
- `src/components/` the small design system, event cards, QR code.
- `src/theme.ts` colours, spacing, radii and fonts in one place.

Add packages with `npx expo install <package>` so versions match the SDK.
