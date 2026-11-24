import { Redirect } from 'expo-router';

/**
 * The tab bar's raised "Create" button opens the organizer flow itself (see _layout.tsx), so this tab never shows.
 * If the route is opened directly (a link, the web address bar), send it on to the create flow.
 */
export default function CreateTab() {
  return <Redirect href="/organizer/create" />;
}
