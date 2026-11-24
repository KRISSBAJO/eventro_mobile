/** eventro://tickets/<id> and /tickets/<id> (the website's path, used in notifications) → the ticket screen. */
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function TicketLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={{ pathname: '/ticket/[id]', params: { id } }} />;
}
