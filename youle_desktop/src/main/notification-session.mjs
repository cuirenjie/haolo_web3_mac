// Native notifications can remain in macOS Notification Center after a login
// changes. Neither their click nor a delayed renderer load may open old context.
export function createNotificationSession(scope) {
  const active = new Set();
  let generation = 0;
  return {
    track(notification, open) {
      const owner = scope(), revision = generation;
      const current = () => revision === generation && owner === scope();
      active.add(notification);
      notification.on('close', () => active.delete(notification));
      notification.on('click', () => { if (current()) open(current); });
    },
    clear() {
      generation++;
      for (const notification of active) {
        try { notification.close(); } catch { /* A closed OS notification is harmless. */ }
      }
      active.clear();
    },
  };
}
