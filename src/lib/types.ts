/** Shapes of the API responses the app uses (see eventro-be/src). Money is in minor units of `currency`. */
import type { VenueListing } from './bookings';
import type { Dated, DateMode, EventDate } from './dates';
import type { BookedSession, ScheduleItem } from './schedule';
import type { TierLook } from './tiers';

/** What every ticket type sent to fans carries for its design: perks, badge, the organizer's pick and the resolved look. */
export type TierFields = { perks?: string[]; badge?: string | null; style?: TierLook | null; look?: TierLook };

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
  | 'FOOD'
  | 'OTHER';

/** GET /events items. */
/** GET /me/watching items: an event card plus when watching started, the lowest price then, and whether it's lower now. */
export type WatchedEvent = EventCard & { watchingSince: string; startedFromCents: number | null; dropped: boolean };

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
  /** when the event first went on sale on Omoshow (what sort=new ranks by); null for older events */
  publishedAt?: string | null;
  /** paid tickets sold in the last 14 days (what sort=popular ranks by) */
  soldRecent?: number;
  /** fan-resale listings on sale now (0 when resale is off or closed); older APIs leave it out */
  resaleCount?: number;
  /** with ?currency=: fromCents converted to that currency (approximate, for display) */
  fromCentsIn?: { currency: string; cents: number };
  /** multiple dates (lib/dates.ts); older APIs leave them out (SINGLE) */
  dateMode?: DateMode;
  /** DATES/DAYS: the first upcoming active date */
  nextDate?: { id: string; startsAt: string } | null;
  /** DATES/DAYS: active dates still to come (0 for SINGLE) */
  dateCount?: number;
};

export type EventPage = { total: number; page: number; pageSize: number; items: EventCard[] };

/**
 * Pay what you want on a ticket type (GET /events/:slug, GET /holds/:id). Amounts are BASE amounts, what the fan
 * chooses; `feePermille` is the fee the fan pays on top (0 when the organizer absorbs it). `maxCents` is the effective
 * maximum (the API's ceiling when the organizer set none: `maxSet` false).
 */
export type Pwyw = { minCents: number; suggestedCents: number | null; maxCents: number; maxSet: boolean; quickPicks: number[]; feePermille: number };

/** An event's charity donations (GET /events/:slug, GET /holds/:id `event.donations`); null when it doesn't take them. */
export type Donations = { cause: string; description: string | null; suggestedCents: number[]; minCents: number | null; maxCents: number };

export type FeeMode = 'BUYER' | 'ORGANIZER';

export type TicketType = {
  id: string;
  name: string;
  description: string | null;
  /** all-in; for pay what you want, the all-in price of the minimum ("from") */
  priceCents: number;
  /** older APIs leave it out: FIXED */
  pricing?: 'FIXED' | 'PWYW';
  pwyw?: Pwyw | null;
  maxPerOrder: number;
  sortOrder: number;
  perks: string[];
  badge: string | null;
  /** the organizer's pick; null = Auto */
  style?: TierLook | null;
  /** the look fans see (lib/tiers.ts lookOf falls back to the name when it's missing) */
  look?: TierLook;
  available: number;
  /** DATES: the date this tier copy is for (copies of one tier share `tierKey`) */
  eventDateId?: string | null;
  tierKey?: string | null;
  /** DAYS: the days this type admits on */
  validDateIds?: string[];
};

export type MediaItem = {
  id: string;
  kind: 'image' | 'video';
  alt?: string;
  url?: string;
  thumbUrl?: string;
  posterUrl?: string;
  /** videos: mediaEX's player page */
  embedUrl?: string;
  playbackUrl?: string;
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
  /** The organizer's page (GET /organizers/:slug); slug is null only on old organizers before pages existed */
  organizer?: { slug: string | null; name: string; verified: boolean; logoUrl?: string | null };
  venue: Venue | null;
  ticketTypes: TicketType[];
  media: MediaItem[];
  seatMap: { sections: MapSection[] } | null;
  /** who pays Omoshow's fee, and how much it is (older APIs leave them out) */
  feeMode?: FeeMode;
  feePermille?: number;
  donations?: Donations | null;
  /** multiple dates (lib/dates.ts); older APIs leave them out (SINGLE, no dates) */
  dateMode?: DateMode;
  dates?: EventDate[];
  nextDate?: { id: string; startsAt: string } | null;
  /** DATES: the date the seat map's `available` numbers are for */
  seatMapDateId?: string | null;
  /** the schedule (lib/schedule.ts): every live item, by time; [] (or left out by older APIs) without one */
  schedule?: ScheduleItem[];
  /** the schedule's distinct stages, in schedule order (for the stage filter) */
  stages?: string[];
};

/** A seat map section (GET /events/:slug). Reserved sections are `rows` × `seatsPerRow`; rows are A, B, … Z, AA … */
export type MapSection = {
  id: string;
  label: string;
  level?: string;
  ticketTypeId: string;
  seating: 'reserved' | 'ga';
  rows?: number;
  seatsPerRow?: number;
  capacity?: number;
  /** places left */
  available?: number;
};

/** GET /events/:slug/availability?qty= : places left per section and the seats a hold would get now */
export type Availability = { qty: number; sections: { id: string; available: number; fits: boolean; row: string | null; seats: number[] }[] };

/** GET /events/:slug/sections/:id/seats : seats sold or held, as "ROW:SEAT" */
export type SectionSeats = { section: string; seating: 'reserved' | 'ga'; capacity: number; inUse: number; taken: string[] };

export type SeatPick = { section: string; row: string | null; seat: number | null };

/** POST /holds */
export type HoldCreated = { id: string; quantity: number; expiresAt: string; sectionId: string | null; ticketTypeId: string; seats: SeatPick[] | null; amountCents?: number | null };

/** GET /holds/:id (`date` for DATES, `validDates` for DAYS) */
export type Hold = Dated & {
  id: string;
  status: 'ACTIVE' | 'EXPIRED' | 'RELEASED' | 'CONVERTED' | string;
  quantity: number;
  expiresAt: string;
  section: { id: string; label: string; level: string | null; seating: 'reserved' | 'ga' } | null;
  seats: SeatPick[];
  /** pay what you want: the base amount chosen per ticket (null for fixed prices) */
  amountCents?: number | null;
  /** all-in per ticket for this hold */
  unitCents?: number;
  /** the donation stored on the hold (PATCH /holds/:id, for the website's checkout); 0 = none chosen */
  donationCents?: number;
  ticketType: { id: string; name: string; description: string | null; priceCents: number; pricing?: 'FIXED' | 'PWYW'; pwyw?: Pwyw | null } & TierFields;
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
    feeMode?: FeeMode;
    feePermille?: number;
    donations?: Donations | null;
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
  /** donation included */
  totalCents: number;
  /** the donation added to the total (no Omoshow fee, no protection on it) */
  donationCents?: number;
  /** totalCents − donationCents */
  ticketTotalCents?: number;
  /** Omoshow's fee included in the tickets (0 when the organizer absorbs it) */
  feeCents?: number;
  /** pay what you want: the base amount per ticket, or null */
  amountCents?: number | null;
};

/** POST /orders (the quote's lines too). `free`: a $0 order (free tickets, $0 pay what you want, no donation), already PAID. */
export type OrderCreated = Partial<Omit<Quote, 'totalCents'>> & {
  orderId: string;
  status: string;
  provider: 'mock' | 'stripe' | 'paystack' | 'free';
  currency: string;
  clientSecret: string | null;
  redirectUrl: string | null;
  holdExpiresAt: string;
  totalCents: number;
};

/** What order views add for donations and comps (GET /orders/:id, POST /orders/:id/pay and /verify, GET /me/orders). */
export type OrderExtras = {
  /** COMP: a complimentary ticket the organizer issued ($0); older APIs leave it out */
  kind?: 'SALE' | 'COMP';
  donationCents?: number;
  donationCause?: string | null;
  donationRefundedCents?: number;
  compGroup?: string | null;
};

/** POST /orders/:id/pay and /verify */
export type Order = OrderExtras & Dated & {
  id: string;
  status: 'PENDING' | 'PAID' | 'CANCELLED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
  provider: string;
  email: string;
  buyerName: string;
  quantity: number;
  currency: string;
  /** all-in per ticket (pay what you want: the amount each ticket was bought for) */
  unitCents: number;
  subtotalCents: number;
  discountCents: number;
  protectionCents: number;
  /** donation included */
  totalCents: number;
  promoCode: string | null;
  event: { slug: string; title: string; startsAt: string; venue: { name: string; city: string | null } | null };
  ticketType: { name: string } & TierFields;
  tickets: { id: string; section: string | null; row: string | null; seat: number | null; status: string; holderName: string }[];
  paymentStatus?: string;
  createdAt?: string;
  paidAt?: string | null;
  refundedCents?: number;
  gift?: { id: string; recipientName: string; recipientEmail: string; message: string | null; sendAt: string; sentAt: string | null; claimedAt: string | null } | null;
  /** GET /orders/:id only (the buyer), newest first */
  refundRequests?: RefundRequest[];
};

export type RefundRequestStatus = 'OPEN' | 'APPROVED' | 'PARTIAL' | 'DENIED';
export type RefundRequest = { id: string; status: RefundRequestStatus; reason?: string; amountCents: number | null; createdAt: string; decidedAt: string | null };

/** GET /me/orders rows, newest first */
export type MyOrder = OrderExtras & Dated & {
  id: string;
  status: Order['status'];
  quantity: number;
  unitCents: number;
  subtotalCents: number;
  protectionCents: number;
  discountCents: number;
  totalCents: number;
  refundedCents: number;
  promoCode: string | null;
  currency: string;
  provider: string;
  createdAt: string;
  paidAt: string | null;
  resale: boolean;
  event: { slug: string; title: string; startsAt: string; timezone: string | null; imageUrl: string | null; status: string; venue: { name: string; city: string | null } | null };
  ticketType: { name: string } & TierFields;
  gift: { recipientName: string; sendAt: string; sentAt: string | null; claimedAt: string | null } | null;
  refundRequest: RefundRequest | null;
};

/** GET /me/saved */
export type SavedEvents = { ids: string[]; slugs: string[]; items: EventCard[] };

/** GET /venues/:slug */
export type VenuePage = {
  id: string;
  slug: string;
  name: string;
  address: string;
  city: string;
  region: string | null;
  country: string | null;
  postalCode: string | null;
  timezone: string | null;
  lat: number | null;
  lng: number | null;
  capacity: number | null;
  about: string | null;
  imageUrl: string | null;
  /** cover first, then the venue's other photos and its hire listing's */
  photos?: { url: string; alt?: string }[];
  website: string | null;
  phone: string | null;
  verified: boolean;
  /** it has an approved manager already */
  managed?: boolean;
  eventsHosted: number;
  /** fans following it */
  followers?: number;
  layout: { sections: number; places: number } | null;
  events: { slug: string; title: string; subtitle: string; startsAt: string; imageUrl: string | null; category: Category; currency: string; fromCents: number; nextDate?: { id: string; startsAt: string } | null }[];
  /** Terms for hiring the venue on Omoshow; null when it isn't taking bookings (see lib/bookings.ts) */
  listing?: VenueListing | null;
};

export type TicketStatus = 'ACTIVE' | 'TRANSFER_PENDING' | 'LISTED' | 'CHECKED_IN' | 'VOID';

/** GET /me/tickets items (`date` for DATES, `validDates` for DAYS). */
export type Ticket = Dated & {
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
  ticketType: { name: string; priceCents: number } & TierFields;
  order: {
    id: string;
    createdAt: string;
    quantity: number;
    totalCents: number;
    refundedCents?: number;
    status: string;
    currency: string;
    gift: { id: string; recipientName: string; recipientEmail: string; sendAt: string; sentAt: string | null; claimedAt: string | null } | null;
    /** COMP: a complimentary ticket from the organizer (older APIs leave it out) */
    kind?: 'SALE' | 'COMP';
    compGroup?: string | null;
  };
  event: {
    slug: string;
    title: string;
    subtitle: string;
    /** the event's currency (what it's priced, listed and paid out in) */
    currency?: string;
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
    dateMode?: DateMode;
    /** every date of the event (cancelled ones too) */
    dates?: EventDate[];
  };
  /**
   * The Omoshow Guarantee (the scan guarantee): always set by the API, covered or not. Missing (or null) only in
   * saved copies from older app versions, where nothing is known about it. VOID tickets come back only when they
   * have a claim or their event was cancelled, so a refunded ticket still shows its decision.
   */
  guarantee?: TicketGuarantee | null;
  /** the sessions this ticket has booked (lib/schedule.ts), by time; older APIs and saved copies leave it out */
  sessions?: BookedSession[];
  /** the event (or this ticket's date or day) moved since it was bought; `refundable`: this account can still take a full refund */
  dateChange?: DateChange | null;
};

/** GET /me/tickets `dateChange` */
export type DateChange = { id: string; fromStartsAt: string; toStartsAt: string; reason: string | null; refundUntil: string; refundable: boolean; refundCents: number };

/* ---------- the Omoshow Guarantee (the scan guarantee) ---------- */

export type GuaranteeReason = 'DID_NOT_SCAN' | 'TURNED_AWAY' | 'OTHER';

/** Who pays an approved claim: Omoshow (fan resale tickets) or the organizer (every other paid ticket). Not for fans. */
export type GuaranteePayer = 'OMOSHOW' | 'ORGANIZER';

/** A guarantee claim (POST/GET /tickets/:id/guarantee-claims, and on each covered ticket in GET /me/tickets). */
export type GuaranteeClaim = {
  id: string;
  ticketId: string;
  status: 'PENDING' | 'APPROVED' | 'DECLINED';
  reason: GuaranteeReason;
  details: string | null;
  /** decided on arrival from the door's records (declined: the ticket was scanned in) */
  auto: boolean;
  decisionNote: string | null;
  /** this ticket's share of the order, fees included */
  amountCents: number;
  currency: string;
  /** missing on claims saved by older app versions */
  payer?: GuaranteePayer;
  refundStatus: 'NONE' | 'PENDING' | 'REFUNDED' | 'FAILED';
  createdAt: string;
  decidedAt: string | null;
  refundedAt: string | null;
  /** a status line written by the server, ready to show */
  message: string;
  /** DAYS: the day the claim is about */
  eventDateId?: string | null;
};

/**
 * A ticket's Omoshow Guarantee (GET /me/tickets, and GET /tickets/:id/guarantee-claims): covered when it's from a
 * paid order (pay what you want above $0 included); free tickets ($0 pay what you want too: FREE), comps (COMP) and
 * refunded orders aren't. The claim window is real instants.
 */
export type TicketGuarantee = {
  covered: boolean;
  /** who pays an approved claim (fans don't see this) */
  payer: GuaranteePayer | null;
  /** why it isn't covered */
  notCovered: 'FREE' | 'COMP' | 'REFUNDED' | null;
  /** what a claim on this ticket refunds now: its all-in share of the order (0 if not covered), or the claim's amount */
  refundCents: number;
  opensAt: string;
  closesAt: string;
  /** covered and inside the window when the API answered */
  open: boolean;
  claim: GuaranteeClaim | null;
  /** DAYS passes: each day's claim window and share (the top level spans the first to the last day) */
  days?: { eventDateId: string; opensAt: string; closesAt: string; open: boolean; refundCents: number }[];
};

/** GET /tickets/:id/guarantee-claims (holder only). */
export type GuaranteeAnswer = TicketGuarantee;

export type IncomingTransfer = Dated & {
  id: string;
  holderName: string;
  transferExpiresAt: string | null;
  event: { title: string; startsAt: string };
  ticketType: { name: string } & TierFields;
  /** Set when these tickets are a gift: accepting one claims the whole gift. A comp is one too (`from`: the organizer). */
  gift?: { id: string; from: string; message: string | null; comp?: boolean; group?: string | null } | null;
};

export type MyTickets = { tickets: Ticket[]; incomingTransfers: IncomingTransfer[]; resaleFeePermille: number };

/** GET /tickets/:id/qr */
export type QrToken = { token: string; expiresInMs: number };

export type Health = { ok: boolean; payments: 'mock' | 'live'; stripe: boolean; paystack: boolean };
export type GeoMe = { country: string | null; countryName: string | null; city: string | null; currency?: string | null; source: string };

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
export type NotifyPrefs = {
  orders: boolean;
  tickets: boolean;
  priceDrops: boolean;
  reminders: boolean;
  marketing: boolean;
  /** organizers: new sales (older APIs leave it out: on) */
  sales?: boolean;
  /** new events from organizers and venues the fan follows (older APIs leave it out: on) */
  following?: boolean;
};

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
  ticket: Dated & { id: string; section: string | null; sectionName?: string | null; row: string | null; seat: number | null; ticketType: { name: string } };
};
export type MyResale = { listings: MyListing[]; totals: { owedCents: number; paidCents: number } };

/** One listing of GET /events/:slug/resale (active only, cheapest first). */
export type ResaleListing = Dated & {
  id: string;
  priceCents: number;
  faceCents: number;
  currency: string;
  ticketType: { id: string; name: string } & TierFields;
  section?: string | null;
  /** the seat map's name for the section ("Lower Level 104") */
  sectionName?: string | null;
  row?: string | null;
  seat?: number | null;
  listedAt?: string;
};
/** GET /events/:slug/resale */
export type EventResale = { enabled: boolean; listings: ResaleListing[] };

/** POST /resale/:id/hold: the listing is held for this buyer for 10 minutes; the key creates the order. */
export type ResaleHoldCreated = { listingId: string; holdKey: string; heldUntil: string; priceCents: number; currency: string };

/** GET /gifts/:token (details only once delivered). A comp is a gift from the organizer (`from` is their name). */
export type Gift = Dated & {
  from: string;
  to: string;
  /** cancelled: a comp the organizer revoked */
  status: 'scheduled' | 'ready' | 'claimed' | 'cancelled';
  comp?: boolean;
  /** a comp's group ("Press", "Artist"…) */
  group?: string | null;
  sendAt: string;
  message?: string;
  event?: { slug: string; title: string; subtitle: string; startsAt: string; imageUrl: string | null; online: boolean; timezone: string | null; venue: { name: string; city: string | null } | null };
  ticketType?: { name: string; perks: string[] } & TierFields;
  quantity?: number;
  seats?: { section: string | null; sectionName: string | null; row: string | null; seat: number | null }[];
  totalCents?: number;
  currency?: string;
};

/* ---------- organizer ---------- */

export type MemberRole = 'ADMIN' | 'MANAGER' | 'DOOR' | string;

/** GET /organizer/orgs */
export type MyOrg = { role: MemberRole; org: { id: string; name: string; logoUrl?: string | null; coverUrl?: string | null } };

/** GET /organizer/orgs/:orgId/door-events: 2 days back to 60 days ahead, soonest first */
export type DoorEvent = {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  doorsAt: string | null;
  timezone: string | null;
  venue: { name: string; city: string | null } | null;
  online: boolean;
  status: string;
  /** non-void tickets (the door pack has the same ones) */
  ticketsIssued: number;
  checkedIn: number;
  /** DATES/DAYS only (SINGLE rows leave them out): each date with its entries, and the door's default date */
  dateMode?: DateMode;
  dates?: (EventDate & { checkedIn?: number })[];
  currentDateId?: string | null;
};

/** POST /organizer/events/:id/check-in */
export type DoorTicket = Dated & { id: string; holderName: string; ticketType: string; section: string | null; row: string | null; seat: number | null; comp?: boolean; compGroup?: string | null };
export type CheckInAnswer = {
  /** wrong-date: DATES, the ticket is for another date; DAYS, it isn't valid on the door's date */
  result: 'ok' | 'duplicate' | 'invalid' | 'wrong-event' | 'expired-code' | 'wrong-date';
  /** DATES/DAYS: the date the door checked against */
  date?: EventDate | null;
  message: string;
  ticket?: DoorTicket;
  /* duplicate: the first scan */
  checkedInAt?: string | null;
  checkedInBy?: { id: string; name: string | null } | null;
  checkedInDevice?: string | null;
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
  comp?: boolean;
  compGroup?: string | null;
  /** DATES/DAYS: the ticket's date (DATES), the days it admits on (DAYS) and its entries so far */
  eventDateId?: string | null;
  validDateIds?: string[];
  checkIns?: { eventDateId: string | null; at: string; deviceId: string | null }[];
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
  /** the guest list (no tickets), for checking guests in offline; older APIs leave it out */
  guestList?: GuestEntry[];
  dateMode?: DateMode;
  dates?: EventDate[];
  /** the door's default date (DATES/DAYS) */
  currentDateId?: string | null;
};

/* ---------- guest list ---------- */

/** One guest-list entry (no ticket): `arrived` of `partySize` (1 + plus-ones) are in. */
export type GuestEntry = {
  id: string;
  name: string;
  email: string | null;
  plusOnes: number;
  group: string | null;
  note: string | null;
  arrived: number;
  partySize: number;
  firstArrivedAt: string | null;
  updatedAt: string;
};

/** GET /organizer/events/:id/guest-list */
export type GuestList = { summary: { entries: number; expected: number; arrived: number }; items: GuestEntry[] };

/** POST …/guest-list/:entryId/check-in */
export type GuestCheckIn = { result: 'ok' | 'full'; message: string; entry: GuestEntry };

/** POST …/guest-list/sync */
export type GuestSyncAnswer = {
  results: { index: number; opId: string; entryId: string; result: 'checked_in' | 'full' | 'invalid'; replay?: true; reason?: 'unknown' | 'wrong-event'; entry?: GuestEntry }[];
  summary: { checked_in: number; full: number; invalid: number };
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
  /** DATES/DAYS: the date the scan counted for */
  eventDateId?: string | null;
};
export type SyncAnswer = { eventId: string; deviceId: string; summary: { checked_in: number; already: number; invalid: number }; results: SyncResult[] };

/** GET /organizer/events/:id/attendees */
export type Attendee = {
  id: string;
  holderName: string;
  holderEmail: string;
  section: string | null;
  row: string | null;
  seat: number | null;
  status: TicketStatus;
  checkedInAt: string | null;
  ticketType: { name: string };
  /** older APIs leave them out (PAID) */
  type?: 'PAID' | 'COMP';
  compGroup?: string | null;
  /** DATES/DAYS: the ticket's date (DATES) and the dates it was checked in on */
  eventDateId?: string | null;
  checkedInDates?: string[];
};
