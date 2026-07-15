// The navbar tabs that a club admin can show/hide per club. Settings and Account
// are always available, and the calendar (home) is the default landing page, so
// none of those are toggleable.
export interface ToggleableTab {
  key: string;
  label: string;
  path: string;
}

export const TOGGLEABLE_TABS: ToggleableTab[] = [
  { key: 'birdies', label: 'Birdies', path: '/birdies' },
  { key: 'credits', label: 'Credits', path: '/credits' },
  { key: 'players', label: 'Players', path: '/players' },
  { key: 'payout',  label: 'Payout',  path: '/payout' },
];
