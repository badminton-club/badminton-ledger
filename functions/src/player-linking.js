function createPlayerLinker({ db, auth, fieldValue, error }) {
  return async (request) => {
    if (!request.auth) throw error('unauthenticated', 'Sign in before linking a player.');
    const { uid, token } = request.auth;
    if (token.email_verified !== true || typeof token.email !== 'string') {
      throw error('failed-precondition', 'Verify your email before linking a player.');
    }
    const account = await auth.getUser(uid);
    const email = token.email.trim().toLowerCase();
    const revoked = account.tokensValidAfterTime
      && !(typeof token.auth_time === 'number'
        && token.auth_time * 1000 >= Date.parse(account.tokensValidAfterTime));
    if (account.disabled || revoked || !account.emailVerified || account.email?.trim().toLowerCase() !== email) {
      throw error('permission-denied', 'Sign in again with your verified email.');
    }

    const mappings = await db.collectionGroup('etransferSenderMappings')
      .where('senderEmail', '==', email).get();
    let linked = 0;
    let conflicts = 0;
    for (const mapping of mappings.docs) {
      const parts = mapping.ref.path.split('/');
      if (parts.length !== 4 || parts[0] !== 'clubs' || parts[3] !== email) continue;
      const clubId = parts[1];
      const outcome = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(mapping.ref);
        if (!fresh.exists || fresh.data().senderEmail !== email) return 'unchanged';
        const playerId = fresh.data().playerId;
        if (typeof playerId !== 'string' || !playerId || playerId.includes('/')) return 'conflict';
        const memberRef = db.doc(`clubs/${clubId}/members/${uid}`);
        const profileRef = db.doc(`users/${uid}`);
        const [club, player, member, claims, profile] = await Promise.all([
          tx.get(db.doc(`clubs/${clubId}`)),
          tx.get(db.doc(`clubs/${clubId}/players/${playerId}`)),
          tx.get(memberRef),
          tx.get(db.collection(`clubs/${clubId}/members`).where('playerId', '==', playerId)),
          tx.get(profileRef),
        ]);
        if (!club.exists || !player.exists) return 'conflict';
        const existingPlayerId = member.data()?.playerId;
        if (existingPlayerId && existingPlayerId !== playerId) return 'conflict';
        if (claims.docs.some((claim) => claim.id !== uid)) return 'conflict';
        const savedClubs = profile.data()?.clubs;
        if (existingPlayerId === playerId && Array.isArray(savedClubs) && savedClubs.includes(clubId)) {
          return 'unchanged';
        }

        if (existingPlayerId !== playerId) {
          tx.set(memberRef, member.exists
            ? { playerId }
            : { role: 'member', playerId, addedAt: fieldValue.serverTimestamp() }, { merge: true });
        }
        tx.set(profileRef, { clubs: fieldValue.arrayUnion(clubId) }, { merge: true });
        return 'linked';
      });
      if (outcome === 'linked') linked += 1;
      if (outcome === 'conflict') conflicts += 1;
    }
    return { linked, conflicts };
  };
}

module.exports = { createPlayerLinker };
