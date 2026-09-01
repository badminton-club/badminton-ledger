// The navbar tabs that a club admin can show/hide per club. Settings and Account
// are always available, and the calendar (home) is the default landing page, so
// none of those are toggleable. Every other tab here (including Attendance) is
// admin-only *except* Attendance, which every club member sees when enabled —
// see AppNavBar.tsx for how each tab's visibility is actually gated.
export interface ToggleableTab {
  key: string;
  label: string;
  path: string;
}

export const TOGGLEABLE_TABS: ToggleableTab[] = [
  { key: 'attendance', label: 'Attendance', path: '/attendance' },
  { key: 'birdies', label: 'Birdies', path: '/birdies' },
  { key: 'credits', label: 'Credits', path: '/credits' },
  { key: 'players', label: 'Players', path: '/players' },
  { key: 'payout',  label: 'Payout',  path: '/payout' },
  { key: 'etransfers', label: 'e-Transfers', path: '/etransfers' },
];
