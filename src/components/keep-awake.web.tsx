/** Browsers without the Wake Lock API would throw, and the web build is only for checking the app: no-op. */
export function KeepAwake() {
  return null;
}
