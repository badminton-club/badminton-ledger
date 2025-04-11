import React from 'react';
import { Row, Col, Badge } from 'react-bootstrap';
import { getTotalDaysInMonth, getFirstDayOfMonthWeekday } from '../../utils/dateUtils';
import '../../Styles/CalendarGrid.css';
import { getMonth, getYear } from 'date-fns';


const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function CalendarGrid({ currentDate, sessionsMap = [], onDayClick }) {
    console.log("currentDate ==> ", currentDate);
    console.log("sessionsMap ==> ", sessionsMap);
    const totalDays = getTotalDaysInMonth(currentDate);
    const startingDay = getFirstDayOfMonthWeekday(currentDate);
    const year = getYear(currentDate)
    const month = getMonth(currentDate)
    const days = [];
    for (let i = 0; i < startingDay; i++) {
        days.push(<Col key={`empty-end-${i}`} xs={true} className="calendar-day empty p-2 border" />);
    }
    for (let day = 1; day <= totalDays; day++) {
        const formattedDay = new Date(year, month, day)
        const dayInfo = sessionsMap.find(session => +session.date === +formattedDay);
        const hasSession = !!dayInfo;
        if (hasSession) console.log("dayInfo ==> ", dayInfo);
        const status = dayInfo?.paidStatus;
        days.push(
            <Col
                key={day}
                className={`calendar-day p-2 border ${hasSession ? 'has-session' : ''}`}
                onClick={() => onDayClick(dayInfo?.id|| '')}  //change this to return date after firebase integration
                style={hasSession ? { cursor: 'pointer', position: 'relative' } : {}}
            >
                <span>{day}</span>
                {hasSession && (
                    <Badge
                        pill
                        bg={status === 'green' ? 'success' : 'danger'}
                        style={{ position: 'absolute', top: '5px', right: '5px' }}
                    >
                        S
                    </Badge>
                )}
            </Col>
        );
    }
    const weeks = [];
    let currentWeek = [];
    days.forEach((dayComponent, index) => {
        currentWeek.push(dayComponent);
        if (currentWeek.length === 7 || index === days.length - 1) {
            if (index === days.length - 1 && currentWeek.length < 7) {
                for (let i = currentWeek.length; i < 7; i++) {
                    currentWeek.push(<Col key={`empty-end-${i}`} xs={true} className="calendar-day empty p-2 border" />)
                }
            }
            weeks.push(<Row key={`week-${weeks.length}`} className="g-0">{currentWeek}</Row>);
            currentWeek = [];
        }
    });


    return (
        <div className="calendar-grid ">
            <Row>
                {weekdays.map(wd => <Col key={wd}>{wd}</Col>)}
            </Row>
            {weeks}
        </div>
    );
}

export default CalendarGrid;
