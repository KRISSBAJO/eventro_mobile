/**
 * Pieces the venue owner screens share: who you are at the venue (role, message, website), a venue as a row, and a
 * request waiting for Eventro (or declined, with Eventro's note).
 */
import { Image } from 'expo-image';
import { router, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { errorText } from '@/lib/api';
import type { ClaimRole, VenueRequest } from '@/lib/bookings';
import { cityOnly, countryName } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { CLAIM_ROLES, linkError } from '@/lib/my-venues';
import { colors, radius, space } from '@/theme';
import { ChoiceRow, ChoiceTile, Section } from './form-ui';
import { Icon, type IconName } from './icons';
import { OrgScreen } from './org-ui';
import { Badge, EmptyState, ErrorState, Field, Skeleton, TextArea, Txt } from './ui';

/* ---------- who you are ---------- */

export type ClaimInput = { role: ClaimRole; message: string; website: string };
export const EMPTY_CLAIM: ClaimInput = { role: 'manager', message: '', website: '' };

/** The API's checks for a claim (keys match the fields' errors). */
export function claimErrors(c: ClaimInput, withWebsite: boolean) {
  const e: Record<string, string> = {};
  const len = c.message.trim().length;
  if (len < 10) e.message = 'Tell us who you are at the venue and how we can check it (at least 10 characters).';
  else if (len > 600) e.message = 'Keep it to 600 characters.';
  if (withWebsite) {
    const w = linkError(c.website, 'The website', 200);
    if (w) e.website = w;
  }
  return e;
}

/** Your role at the venue, and how Eventro can check it. `website`: also ask for the venue's website. */
export function ClaimFields({ value: c, onChange, errors, venueName, website = true }: { value: ClaimInput; onChange: (patch: Partial<ClaimInput>) => void; errors: Record<string, string | undefined>; venueName: string; website?: boolean }) {
  return (
    <>
      <Section icon="user" title={`Your role at ${venueName || 'the venue'}`} sub="Owners and managers can do everything; staff keep the listing up to date.">
        <ChoiceRow>
          {CLAIM_ROLES.map((r) => (
            <ChoiceTile key={r.id} icon={r.icon} label={r.label} sub={r.sub} on={c.role === r.id} onPress={() => onChange({ role: r.id })} />
          ))}
        </ChoiceRow>
      </Section>
      <Section icon="shield" title="How we can check it" sub="Eventro checks every request by hand, usually within a day.">
        <TextArea
          label="Who you are"
          value={c.message}
          onChangeText={(message) => onChange({ message })}
          maxLength={600}
          minHeight={120}
          placeholder="e.g. I’m the events manager. You can reach me at bookings@venue.com, or call the box office and ask for me."
          error={errors.message}
          hint="An email at the venue’s own domain is the quickest way for us to confirm."
        />
        {website ? (
          <Field label="The venue’s website (optional)" placeholder="https://" value={c.website} onChangeText={(w) => onChange({ website: w })} keyboardType="url" autoCapitalize="none" autoCorrect={false} maxLength={200} error={errors.website} />
        ) : null}
      </Section>
    </>
  );
}

/* ---------- a venue manager's screen ---------- */

/**
 * What a venue manager's screen shows before its venue is there: signed out, loading, an error, or not one of
 * theirs. Null once it is.
 */
export function managerGate(
  title: string,
  signedIn: boolean,
  q: { isPending: boolean; error: unknown; refetch: () => unknown },
  found: boolean,
  fallback: Href = '/my-venues',
) {
  if (signedIn && !q.isPending && !q.error && found) return null;
  return (
    <OrgScreen title={title} eyebrow="My venues" fallback={fallback}>
      {!signedIn ? (
        <EmptyState icon="lock" title="Sign in first" action="Sign in" onAction={() => router.push('/sign-in')} />
      ) : q.isPending ? (
        <View style={{ gap: space.md }}>
          <Skeleton height={120} radius={radius.card} />
          <Skeleton height={200} radius={radius.card} />
        </View>
      ) : q.error ? (
        <ErrorState message={errorText(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <EmptyState icon="building" title="Not one of your venues" body="Only the venue’s approved managers can change it." action="My venues" onAction={() => router.replace('/my-venues')} />
      )}
    </OrgScreen>
  );
}

/* ---------- a venue as a row ---------- */

export function VenueRow({
  name,
  sub,
  imageUrl,
  badges,
  onPress,
  icon = 'building',
}: {
  name: string;
  sub: string;
  imageUrl?: string | null;
  badges?: ReactNode;
  onPress?: () => void;
  icon?: IconName;
}) {
  const body = (
    <>
      <View style={styles.thumb}>{imageUrl ? <Image source={{ uri: imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Icon name={icon} size={22} color={colors.accent} />}</View>
      <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
        <Txt variant="bodyStrong" numberOfLines={1}>
          {name}
        </Txt>
        <Txt variant="small" color={colors.muted} numberOfLines={2}>
          {sub}
        </Txt>
        {badges ? <View style={styles.badges}>{badges}</View> : null}
      </View>
      {onPress ? <Icon name="chevronRight" size={18} color={colors.dim} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${sub}`}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface2 }]}>
      {body}
    </Pressable>
  );
}

/** "Lekki, Lagos · Nigeria" */
export const placeLine = (v: { address?: string | null; city: string; country?: string | null }) =>
  [v.address, cityOnly(v.city)].filter(Boolean).join(', ') + (v.country ? ` · ${countryName(v.country)}` : '');

/* ---------- a request waiting for Eventro ---------- */

/**
 * A request to manage a venue: waiting (usually within a day) or declined with Eventro's note. A new venue an
 * owner added is hidden until approved, so it never links to its public page; `onOpen` is for claims of visible
 * venues, `onRetry` for declined ones.
 */
export function RequestCard({ r, onOpen, onRetry }: { r: VenueRequest; onOpen?: () => void; onRetry?: () => void }) {
  const waiting = r.status === 'PENDING';
  const linkable = !r.newVenue && !r.venue.hidden;
  return (
    <View style={[styles.request, waiting ? styles.requestWaiting : styles.requestDeclined]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
        <View style={[styles.dotWrap, { backgroundColor: waiting ? colors.warningSoft : colors.accentSoft }]}>
          <Icon name={waiting ? 'clock' : 'alert'} size={17} color={waiting ? colors.warning : colors.accent} />
        </View>
        <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <Txt variant="eyebrow" color={waiting ? colors.warning : colors.accentHi}>
            {waiting ? 'Waiting for approval' : r.status === 'REVOKED' ? 'Access removed' : 'Not approved'}
          </Txt>
          <Txt variant="bodyStrong" numberOfLines={1}>
            {r.venue.name}
          </Txt>
          <Txt variant="small" color={colors.muted} numberOfLines={1}>
            {placeLine(r.venue)}
          </Txt>
        </View>
        {r.newVenue ? <Badge label="New venue" /> : null}
      </View>
      <Txt variant="small" color={colors.muted}>
        {waiting
          ? r.newVenue
            ? `Eventro is checking it, usually within a day. ${r.venue.name} isn’t shown on Eventro until it’s approved; we’ll email you and send a notification then.`
            : 'Eventro is checking it, usually within a day. We’ll email you and send a notification when you can manage the venue.'
          : r.note
            ? `Eventro’s note: “${r.note}”`
            : 'Eventro couldn’t confirm you work there. You can ask again with something we can check.'}
      </Txt>
      {(waiting && linkable && onOpen) || (!waiting && onRetry) ? (
        <View style={{ flexDirection: 'row', gap: space.md }}>
          {waiting && linkable && onOpen ? <LinkText label="View venue page" onPress={onOpen} /> : null}
          {!waiting && onRetry ? <LinkText label="Ask again" onPress={onRetry} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function LinkText({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 2 }, pressed && { opacity: 0.6 }]}>
      <Txt variant="smallStrong" color={colors.accent}>
        {label}
      </Txt>
      <Icon name="chevronRight" size={14} color={colors.accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  thumb: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.surface2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  request: { gap: space.md, padding: space.lg, borderRadius: radius.card, borderWidth: 1, backgroundColor: colors.surface },
  requestWaiting: { borderColor: 'rgba(245,165,36,0.35)' },
  requestDeclined: { borderColor: colors.accentLine },
  dotWrap: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
});
