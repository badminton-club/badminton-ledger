import {
    format,
    startOfMonth,
    endOfMonth,
    getDaysInMonth,
    getDay,
    addMonths,
    subMonths,
    getDate, 
} from 'date-fns';

export const getMonthYear = (date) => format(date, 'MMMM yyyy');
export const getDayOfMonth = (date) => getDate(date); 
export const getStartOfMonthTimestamp = (date) => startOfMonth(date);
export const getEndOfMonthTimestamp = (date) => endOfMonth(date);
export const getTotalDaysInMonth = (date) => getDaysInMonth(date);
export const getFirstDayOfMonthWeekday = (date) => getDay(startOfMonth(date));
export const getNextMonth = (date) => addMonths(date, 1);
export const getPrevMonth = (date) => subMonths(date, 1);