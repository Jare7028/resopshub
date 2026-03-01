export const LOGIN_QUICK_READ_COOKIE = "resopshub_login_quick_read";
export const LOGIN_QUICK_READ_SNOOZE_KEY = "resopshub.loginQuickRead.snoozedUntil";

export function buildEndOfLocalDayTimestamp(now: Date = new Date()) {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end.getTime();
}
