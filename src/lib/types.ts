/** Shapes of the API responses the app uses (see eventro-be/src). Money is in minor units of `currency`. */

export type Role = 'FAN' | 'ORGANIZER' | 'ADMIN';
export type User = { id: string; email: string; name: string; roles: Role[] };
/** POST /auth/login, /auth/signup, /auth/reset (and /auth/password, which has no refreshToken). */
export type Session = {
  token: string;
  user: User;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
  accessTokenExpiresAt?: string | null;
  sessionId?: string;
};

export type Category =
  | 'CONCERTS'
  | 'SPORTS'
  | 'COMEDY'
  | 'THEATER'
  | 'FESTIVALS'
  | 'FAMILY'
  | 'NIGHTLIFE'
  | 'CONFERENCE'
  | 'WORKSHOP'
  | 'FAITH'
  | 'OTHER';

/** GET /events items. */
export type EventCard = {
  slug: string;
  title: string;
  subtitle: string;
  category: Category;
  /** venue wall-clock time stored as UTC */
  startsAt: string;
  imageUrl: string | null;
  venue: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  currency: string;
  /** lowest all-in price */
  fromCents: number;
  distanceKm?: number | null;
};

export type EventPage = { total: number; page: number; pageSize: number; items: EventCard[] };

export type TicketType = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  maxPerOrder: number;
  sortOrder: number;
  perks: string[];
  badge: string | null;
  available: number;
};

export type MediaItem = {
  id: string;
  kind: 'image' | 'video';
  alt?: string;
  url?: string;
  thumbUrl?: string;
  posterUrl?: string;
};

export type Venue = {
  slug: string;
  name: string;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  postalCode: string | null;
  timezone: string | null;
  lat: number | null;
  lng: number | null;
};

/** GET /events/:slug */
export type EventDetail = {
  id: string;
  slug: string;
  fromCents: number;
  title: string;
  subtitle: string;
  description: string | null;
  category: Category;
  imageUrl: string | null;
  startsAt: string;
  doorsAt: string | null;
  endsAt: string | null;
  timezone: string | null;
  online: boolean;
  currency: string;
  salesPaused: boolean;
  status?: 'CANCELLED' | string;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  preview?: boolean;
  presentedBy: string;
  venue: Venue | null;
  ticketTypes: TicketType[];
  media: MediaItem[];
  seatMap: { sections: { id: string; label: string; level?: string; ticketTypeId: string; seating: 'reserved' | 'ga' }[] } | null;
};

export type SeatPick = { section: string; row: string | null; seat: number | null };

/** POST /holds */
export type HoldCreated = { id: string; quantity: number; expiresAt: string; sectionId: string | null; ticketTypeId: string; seats: SeatPick[] | null };

/** GET /holds/:id */
export type Hold = {
  id: string;
  status: 'ACTIVE' | 'EXPIRED' | 'RELEASED' | 'CONVERTED' | string;
  quantity: number;
  expiresAt: string;
  section: { id: string; label: string; level: string | null; seating: 'reserved' | 'ga' } | null;
  seats: SeatPick[];
  ticketType: { id: string; name: string; description: string | null; priceCents: number };
  event: {
    slug: string;
    title: string;
    subtitle: string;
    category: Category;
    currency: string;
    timezone: string | null;
    imageUrl: string | null;
    startsAt: string;
    doorsAt: string | null;
    venue: { name: string; city: string | null; address: string | null } | null;
  };
  order: { id: string; status: string } | null;
};

export type Quote = {
  promo: { code: string; percent: number } | null;
  unitCents: number;
  quantity: number;
  subtotalCents: number;
  discountCents: number;
  protectionCents: number;
  totalCents: number;
};

/** POST /orders */
export type OrderCreated = {
  orderId: string;
  status: string;
  provider: 'mock' | 'stripe' | 'paystack';
  currency: string;
  clientSecret: string | null;
  redirectUrl: string | null;
  holdExpiresAt: string;
  totalCents: number;
};

/** POST /orders/:id/pay and /verify */
export type Order = {
  id: string;
  status: 'PENDING' | 'PAID' | 'CANCELLED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
  provider: string;
  email: string;
  buyerName: string;
  quantity: number;
  currency: string;
  unitCents: number;
  subtotalCents: number;
  discountCents: number;
  protectionCents: number;
  totalCents: number;
  promoCode: string | null;
  event: { slug: string; title: string; startsAt: string; venue: { name: string; city: string | null } | null };
  ticketType: { name: string };
  tickets: { id: string; section: string | null; row: string | null; seat: number | null; status: string; holderName: string }[];
  paymentStatus?: string;
};

export type TicketStatus = 'ACTIVE' | 'TRANSFER_PENDING' | 'LISTED' | 'CHECKED_IN' | 'VOID';

/** GET /me/tickets items. */
export type Ticket = {
  id: string;
  orderId: string;
  holderName: string;
  holderEmail: string;
  section: string | null;
  sectionName: string | null;
  row: string | null;
  seat: number | null;
  status: TicketStatus;
  transferTo: string | null;
  transferExpiresAt: string | null;
  listCents: number | null;
  checkedInAt: string | null;
  /** the account holding it; null while it's only held under the email */
  ownerId?: string | null;
  /** ACTIVE tickets only: base64url seed for making door codes offline (see door-code.ts) */
  qrSeed?: string;
  qrVersion?: number;
  ticketType: { name: string; priceCents: number };
  order: {
    id: string;
    createdAt: string;
    quantity: number;
    totalCents: number;
    refundedCents?: number;
    status: string;
    currency: string;
    gift: { id: string; recipientName: string; recipientEmail: string; sendAt: string; sentAt: string | null; claimedAt: string | null } | null;
  };
  event: {
    slug: string;
    title: string;
    subtitle: string;
    status: string;
    cancelledAt: string | null;
    cancelReason: string | null;
    startsAt: string;
    doorsAt: string | null;
    imageUrl: string | null;
    online: boolean;
    streamUrl: string | null;
    timezone: string | null;
    venue: { name: string; address: string | null; city: string | null } | null;
    /* the organizer's rules for resale and transfers */
    resaleEnabled?: boolean;
    resaleCapPercent?: number | null;
    resaleRoyaltyPermille?: number;
    transfersEnabled?: boolean;
    transferCutoffMinutes?: number;
  };
};

export type IncomingTransfer = {
  id: string;
  holderName: string;
  transferExpiresAt: string | null;
  event: { title: string; startsAt: string };
  ticketType: { name: string };
};

export type MyTickets = { tickets: Ticket[]; incomingTransfers: IncomingTransfer[]; resaleFeePermille: number };

/** GET /tickets/:id/qr */
export type QrToken = { token: string; expiresInMs: number };

export type Health = { ok: boolean; payments: 'mock' | 'live'; stripe: boolean; paystack: boolean };
export type GeoMe = { country: string | null; countryName: string | null; city: string | null; source: string };

/** GET /me/sessions */
export type DeviceSession = {
  id: string;
  deviceName: string | null;
  platform: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
};

/** GET/PATCH /me/notify-prefs */
export type NotifyPrefs = { orders: boolean; tickets: boolean; priceDrops: boolean; reminders: boolean; marketing: boolean };

/** POST /tickets/:id/listing */
export type Listed = { listingId: string; feeCents: number; royaltyCents: number; payoutCents: number; capCents: number | null; listCents: number };

export type ListingStatus = 'ACTIVE' | 'HELD' | 'SOLD' | 'CANCELLED';
export type PayoutStatus = 'NONE' | 'PENDING' | 'AVAILABLE' | 'HELD' | 'PAID';

/** One row of GET /me/resale */
export type MyListing = {
  id: string;
  ticketId: string;
  priceCents: number;
  faceCents: number;
  currency: string;
  status: ListingStatus;
  heldUntil: string | null;
  cancelReason: string | null;
  createdAt: string;
  soldAt: string | null;
  sellerFeeCents: number | null;
  royaltyCents: number | null;
  payoutCents: number | null;
  payoutStatus: PayoutStatus;
  payoutAvailableAt: string | null;
  paidOutAt: string | null;
  payoutNote: string | null;
  event: { slug: string; title: string; startsAt: string };
  ticket: { id: string; section: string | null; row: string | null; seat: number | null; ticketType: { name: string } };
};
export type MyResale = { listings: MyListing[]; totals: { owedCents: number; paidCents: number } };

/** GET /events/:slug/resale */
export type EventResale = { enabled: boolean; listings: { id: string; priceCents: number; faceCents: number; currency: string; ticketType: { id: string; name: string } }[] };

/** GET /gifts/:token (details only once delivered) */
export type Gift = {
  from: string;
  to: string;
  status: 'scheduled' | 'ready' | 'claimed';
  sendAt: string;
  message?: string;
  event?: { slug: string; title: string; subtitle: string; startsAt: string; imageUrl: string | null; online: boolean; timezone: string | null; venue: { name: string; city: string | null } | null };
  ticketType?: { name: string; perks: string[] };
  quantity?: number;
  seats?: { section: string | null; sectionName: string | null; row: string | null; seat: number | null }[];
  totalCents?: number;
  currency?: string;
};

/* ---------- organizer ---------- */

export type MemberRole = 'ADMIN' | 'EDITOR' | 'FINANCE' | 'DOOR' | string;

/** GET /organizer/orgs */
export type MyOrg = { role: MemberRole; org: { id: string; name: string } };

/** GET /organizer/orgs/:orgId/events (the fields the door needs) */
export type OrgEvent = {
  id: string;
  slug: string;
  title: string;
  status: string;
  startsAt: string;
  timezone: string | null;
  imageUrl: string | null;
  online: boolean;
  venue: { name: string; city: string | null } | null;
  sold: number;
  capacity: number;
};

/** POST /organizer/events/:id/check-in */
export type DoorTicket = { id: string; holderName: string; ticketType: string; section: string | null; row: string | null; seat: number | null };
export type CheckInAnswer = {
  result: 'ok' | 'duplicate' | 'invalid' | 'wrong-event' | 'expired-code';
  message: string;
  ticket?: DoorTicket;
  checkedInAt?: string | null;
};

/** GET /organizer/events/:id/door-pack */
export type DoorPackTicket = {
  id: string;
  seed: string;
  version: number;
  status: TicketStatus;
  checkedInAt: string | null;
  checkedInDevice: string | null;
  holderName: string;
  ticketType: string;
  section: string | null;
  sectionName: string | null;
  row: string | null;
  seat: number | null;
};
export type DoorPack = {
  eventId: string;
  title: string;
  startsAt: string;
  doorsAt: string | null;
  timezone: string | null;
  generatedAt: string;
  windowMs: number;
  algorithm: string;
  tickets: DoorPackTicket[];
};

/** POST /organizer/events/:id/check-ins/sync */
export type SyncResult = {
  index: number;
  ticketId: string;
  scannedAt: string;
  result: 'checked_in' | 'already' | 'invalid';
  reason?: string;
  replay?: boolean;
  checkedInAt?: string | null;
  checkedInBy?: { id: string; name: string | null } | null;
  checkedInDevice?: string | null;
  ticket?: DoorTicket;
};
export type SyncAnswer = { eventId: string; deviceId: string; summary: { checked_in: number; already: number; invalid: number }; results: SyncResult[] };

/** GET /organizer/events/:id/attendees */
export type Attendee = { id: string; holderName: string; holderEmail: string; section: string | null; row: string | null; seat: number | null; status: TicketStatus; checkedInAt: string | null; ticketType: { name: string } };
