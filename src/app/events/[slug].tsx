/** eventro://events/<slug> and /events/<slug> (the website's path, used in notifications) → the event screen. */
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function EventLink() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <Redirect href={{ pathname: '/event/[slug]', params: { slug } }} />;
}
