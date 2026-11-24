/** Keeps the screen on while mounted (showing a ticket at the door). keep-awake.web.tsx does nothing. */
import { useKeepAwake } from 'expo-keep-awake';

export function KeepAwake() {
  useKeepAwake('ticket-qr', { suppressDeactivateWarnings: true });
  return null;
}
