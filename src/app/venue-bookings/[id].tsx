/** A booking at a venue this person manages: confirm, decline, cancel and messages; see components/booking-detail.tsx. */
import { useLocalSearchParams } from 'expo-router';
import { BookingDetailScreen } from '@/components/booking-detail';

export default function VenueBooking() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <BookingDetailScreen side="VENUE" id={id} />;
}
