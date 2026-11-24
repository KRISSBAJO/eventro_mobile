/** Everything on in one city (the event page's city link, Discover's cities). */
import { useLocalSearchParams } from 'expo-router';
import { EventListScreen } from '@/components/event-list-screen';
import { Txt } from '@/components/ui';
import { cityOnly, countryName, flag } from '@/lib/format';
import { colors } from '@/theme';

export default function CityScreen() {
  const { city = '', country } = useLocalSearchParams<{ city: string; country?: string }>();
  const code = country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : '';
  return (
    <EventListScreen
      key={`${city}|${code}`}
      title={cityOnly(city) || city}
      eyebrow="City"
      base={{ city, country: code }}
      intro={
        code ? (
          <Txt variant="small" color={colors.muted}>
            {flag(code)} {countryName(code)}
          </Txt>
        ) : undefined
      }
      emptyBody={`Nothing on sale in ${cityOnly(city) || city} right now. Check back soon.`}
    />
  );
}
