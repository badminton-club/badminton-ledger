import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth } from './client';
import { serviceCall } from './utils';

export interface PlayerLinkResult {
  linked: number;
  conflicts: number;
}

export async function autoLinkPlayerByEmail(): Promise<PlayerLinkResult> {
  return serviceCall('autoLinkPlayerByEmail', async () => {
    const user = auth.currentUser;
    if (!user?.emailVerified) throw new Error('Sign in with a verified email before linking a player.');
    const assertAccount = () => {
      if (auth.currentUser?.uid !== user.uid) throw new Error('Your account changed. Try again.');
    };
    await user.getIdToken(true);
    assertAccount();
    const call = httpsCallable<Record<string, never>, unknown>(
      getFunctions(auth.app, 'us-central1'), 'linkPlayerByEmail'
    );
    const { data } = await call({});
    assertAccount();
    if (!data || typeof data !== 'object' || !('linked' in data) || !('conflicts' in data)
      || typeof data.linked !== 'number' || !Number.isSafeInteger(data.linked) || data.linked < 0
      || typeof data.conflicts !== 'number' || !Number.isSafeInteger(data.conflicts) || data.conflicts < 0) {
      throw new Error('The player linking service returned an invalid result.');
    }
    return { linked: data.linked, conflicts: data.conflicts };
  });
}
