import { format, startOfMonth, endOfMonth, getDaysInMonth, getDay, addMonths, subMonths, getDate } from 'date-fns';

export const getMonthYear              = (date: Date): string => format(date, 'MMMM yyyy');
export const getDayOfMonth             = (date: Date): number => getDate(date);
export const getStartOfMonthTimestamp  = (date: Date): Date   => startOfMonth(date);
export const getEndOfMonthTimestamp    = (date: Date): Date   => endOfMonth(date);
export const getTotalDaysInMonth       = (date: Date): number => getDaysInMonth(date);
export const getFirstDayOfMonthWeekday = (date: Date): number => getDay(startOfMonth(date));
export const getNextMonth              = (date: Date): Date   => addMonths(date, 1);
export const getPrevMonth              = (date: Date): Date   => subMonths(date, 1);
