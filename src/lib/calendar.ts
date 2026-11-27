/**
 * "Add to calendar" without a native calendar module. iPhone and the web open the event's calendar file from the API
 * (GET /events/:slug/calendar.ics), which the system offers to add; Android opens Google Calendar's "new event" page
 * with the details filled in. Event times are the venue's wall-clock time, sent with the event's time zone.
 */
import { Linking, Platform } from 'react-native';
import { API_URL, WEB_URL } from './api';

type CalendarEvent = {
  slug: string;
  title: string;
  /** wall-clock ISO, as the API gives it */
  startsAt: string;
  endsAt?: string | null;
  timezone?: string | null;
  where?: string | null;
  /** one date of an event with several */
  dateId?: string | null;
};

/** "2026-12-17T20:00:00.000Z" (wall clock) → "20261217T200000" */
const stamp = (iso: string) => iso.replace(/[-:]/g, '').slice(0, 15);

export async function addToCalendar(e: CalendarEvent) {
  if (Platform.OS === 'android') {
    const end = e.endsAt ?? new Date(Date.parse(`${e.startsAt.slice(0, 19)}Z`) + 3 * 3600_000).toISOString();
    const q = new URLSearchParams({
      action: 'TEMPLATE',
      text: e.title,
      dates: `${stamp(e.startsAt)}/${stamp(end)}`,
      details: `Your tickets are in the Omoshow app. ${WEB_URL}/events/${e.slug}`,
      ...(e.where ? { location: e.where } : {}),
      ...(e.timezone ? { ctz: e.timezone } : {}),
    });
    await Linking.openURL(`https://calendar.google.com/calendar/render?${q.toString()}`);
    return;
  }
  await Linking.openURL(`${API_URL}/events/${encodeURIComponent(e.slug)}/calendar.ics${e.dateId ? `?date=${encodeURIComponent(e.dateId)}` : ''}`);
}
