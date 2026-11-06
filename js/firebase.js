// Firebase straight from the CDN (there is no bundler), pinned in one place.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';
import { firebaseConfig } from './config.js';

export * from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// `?emulator` on localhost talks to the local Firebase emulators (`npm run emulators`) instead of the real project.
// The emulator's database lives under its own namespace, so it needs its own URL rather than the real databaseURL.
const emulator = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).has('emulator');
export const db = emulator ? getDatabase(app, `http://${location.hostname}:9000/?ns=demo-cuteworld-default-rtdb`) : getDatabase(app);
if (emulator) connectAuthEmulator(auth, `http://${location.hostname}:9099`, { disableWarnings: true });

// Anonymous sign-in. The uid survives refreshes, which is how a student resumes and a teacher keeps their room.
export async function signIn() {
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser.uid;
}
