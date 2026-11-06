// Links between the pages. Kept apart from firebase.js so the landing page doesn't load the SDK.

// `?emulator` is read from the URL of each page (see firebase.js), so every link we build has to carry it
// along, or the next page would quietly talk to the real database.
export function pageUrl(page, params = {}) {
  const url = new URL(page, location.href);
  url.search = '';
  for (const [key, value] of Object.entries(params)) if (value != null) url.searchParams.set(key, value);
  const keepEmulator = new URLSearchParams(location.search).has('emulator');
  const query = url.searchParams.toString();
  return `${url.origin}${url.pathname}${query || keepEmulator ? '?' : ''}${query}${keepEmulator ? `${query ? '&' : ''}emulator` : ''}`;
}

export const joinLink = (code) => pageUrl('student.html', { code });
export const adminLink = (code) => pageUrl('admin.html', { code });

export const goTo = (page, params) => location.assign(pageUrl(page, params));
