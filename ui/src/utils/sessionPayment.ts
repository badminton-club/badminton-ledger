import type { PaidVia, SessionPlayer } from '../types';

type SessionPayment = Pick<SessionPlayer, 'cost' | 'paid' | 'paidVia' | 'comped'>;

export function getSessionPlayerPaidVia(player: SessionPayment): PaidVia {
  return player.paidVia
    ?? (player.comped ? 'comp' : player.paid ? 'etransfer' : player.cost === 0 ? 'balance' : null);
}

export function isSessionPlayerUnpaid(player: SessionPayment): boolean {
  return getSessionPlayerPaidVia(player) === null;
}
