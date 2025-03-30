// src/components/BadmintonCalendarCard.jsx
import React, { useState } from 'react';
import { Button, ButtonGroup, Spinner, Alert } from 'react-bootstrap';
import { getMonthYear, getNextMonth, getPrevMonth } from '../../utils/dateUtils';
import CalendarGrid from './CalendarGrid';
import DatePicker from 'react-datepicker';
import 'bootstrap/dist/css/bootstrap.min.css'; 


function SessionCalendar() {
    const [currentMonth, setCurrentMonth] = useState(new Date()); 
    const [isLoading, setIsLoading] = useState(false);


    const handlePrevMonth = () => {
        setCurrentMonth(getPrevMonth(currentMonth));
    };

    const handleNextMonth = () => {
        setCurrentMonth(getNextMonth(currentMonth));
    };

    const handleMonthSelect = (date) => {
        setCurrentMonth(date);
    };

    const handleDayClick = async (day) => {

    };

    function CustomHeaderButton({ value, onClick, ref }) {
        return (
            <Button
                variant="outline-secondary"
                onClick={onClick}
                ref={ref}
                className="fw-bold"
                aria-label="Change month and year"
                size="sm"
            >
                {value}
            </Button>
        );
    }

    return (
        <div className="session-calendar-container border rounded p-3 shadow-sm bg-light">
            <div className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-3">
                <div>
                    <DatePicker
                        selected={currentMonth}
                        onChange={handleMonthSelect}
                        customInput={<CustomHeaderButton value={getMonthYear(currentMonth)} />}
                        showMonthYearPicker 
                        dateFormat="MMMM yyyy" 
                        popperPlacement="bottom-start" 
                    />
                </div>
                <ButtonGroup>
                    <Button variant="outline-secondary" size="sm" onClick={handlePrevMonth} aria-label="Previous month">&lt;</Button>
                    <Button variant="outline-secondary" size="sm" onClick={handleNextMonth} aria-label="Next month">&gt;</Button>
                </ButtonGroup>
            </div>

            <div className="calendar-body-section">
                {isLoading && (
                    <div className="text-center my-3">
                        <Spinner animation="border" role="status">
                            <span className="visually-hidden">Loading...</span>
                        </Spinner>
                    </div>
                )}

                {!isLoading && (
                    <CalendarGrid
                        currentMonth={currentMonth}
                        sessionsMap={{}}
                        onDayClick={handleDayClick}
                    />
                )}
            </div>
        </div>
    );
}

export default SessionCalendar;