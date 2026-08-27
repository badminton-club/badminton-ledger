import {
  getMonthYear,
  getDayOfMonth,
  getStartOfMonthTimestamp,
  getEndOfMonthTimestamp,
  getTotalDaysInMonth,
  getFirstDayOfMonthWeekday,
  getNextMonth,
  getPrevMonth,
} from '../dateUtils';

describe('dateUtils', () => {
  it('getMonthYear formats as "Month YYYY"', () => {
    expect(getMonthYear(new Date(2026, 7, 15))).toBe('August 2026');
  });

  it('getDayOfMonth returns the day-of-month number', () => {
    expect(getDayOfMonth(new Date(2026, 7, 27))).toBe(27);
  });

  it('getStartOfMonthTimestamp returns midnight on the 1st', () => {
    const start = getStartOfMonthTimestamp(new Date(2026, 7, 27, 15, 30));
    expect(start.getDate()).toBe(1);
    expect(start.getMonth()).toBe(7);
    expect(start.getHours()).toBe(0);
  });

  it('getEndOfMonthTimestamp returns the last day of the month at 23:59:59.999', () => {
    const end = getEndOfMonthTimestamp(new Date(2026, 1, 5)); // February 2026 (not a leap year)
    expect(end.getDate()).toBe(28);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  it('getTotalDaysInMonth accounts for leap years', () => {
    expect(getTotalDaysInMonth(new Date(2024, 1, 1))).toBe(29); // 2024 is a leap year
    expect(getTotalDaysInMonth(new Date(2026, 1, 1))).toBe(28); // 2026 is not
    expect(getTotalDaysInMonth(new Date(2026, 3, 1))).toBe(30); // April
  });

  it('getFirstDayOfMonthWeekday returns the weekday index (0=Sunday) of the 1st', () => {
    // August 1, 2026 is a Saturday.
    expect(getFirstDayOfMonthWeekday(new Date(2026, 7, 15))).toBe(6);
  });

  it('getNextMonth/getPrevMonth shift by exactly one calendar month', () => {
    const aug = new Date(2026, 7, 15);
    expect(getNextMonth(aug).getMonth()).toBe(8);
    expect(getPrevMonth(aug).getMonth()).toBe(6);
  });

  it('getNextMonth rolls over the year boundary', () => {
    const dec = new Date(2026, 11, 15);
    const next = getNextMonth(dec);
    expect(next.getMonth()).toBe(0);
    expect(next.getFullYear()).toBe(2027);
  });

  it('getPrevMonth rolls back the year boundary', () => {
    const jan = new Date(2026, 0, 15);
    const prev = getPrevMonth(jan);
    expect(prev.getMonth()).toBe(11);
    expect(prev.getFullYear()).toBe(2025);
  });
});
