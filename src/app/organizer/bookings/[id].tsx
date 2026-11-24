/** One of the organization's venue bookings (status, cancel, messages); see components/booking-detail.tsx. */
import { useLocalSearchParams } from 'expo-router';
import { BookingDetailScreen } from '@/components/booking-detail';

export default function OrganizerBooking() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <BookingDetailScreen side="ORGANIZER" id={id} />;
}
