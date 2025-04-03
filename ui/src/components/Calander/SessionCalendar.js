import React, { useState } from 'react';
import { Button, ButtonGroup, Spinner } from 'react-bootstrap';
import { getMonthYear, getNextMonth, getPrevMonth } from '../../utils/dateUtils';
import CalendarGrid from './CalendarGrid';
import DatePicker from 'react-datepicker';
import 'bootstrap/dist/css/bootstrap.min.css';
import SessionModal from './SessionModal';

const exampleBirdies = [{
    id: 1,
    name: "HangYu 1",
    purchasedDate: "2025-01-07",
    costPerTube: 28,
    unopenedTubesRemaining: 13,
    birdsPerTube: 12,
    birdsInOpenTube: 10
},
{
    id: 2,
    name: "HangYu 1",
    purchasedDate: "2024-11-07",
    costPerTube: 27,
    unopenedTubesRemaining: 3,
    birdsPerTube: 12,
    birdsInOpenTube: 2
}]

const exampleCourtCredits = {
    id: 1,
    location: "BV",
    lastReloadDate: "2025-01-07",
    remainingCredits: 280,
}

const exampleSession = {
    "18032025": {
        id: 18032025,
        date: "March 18, 2025",
        players: 3,
        birdiesUsed: 4,
        unpaidPlayers: ["John Doe", "Mark Lee"],
        location: "west coast academy",
        attendees: [{ name: "John Doe", userId: 1, paid: true, highlighted: false }, { name: "Mark Lee", userId: 2, paid: false, highlighted: false }, { name: "Jane Doe", userId: 3, paid: true, highlighted: false }]
    },

    "03042025":
    {
        id: 18032025,
        date: "April 2, 2025",
        "players": [
            {
                "name": "Jordan",
                "percentage": 1,
                "cost": "12.41"
            },
            {
                "name": "Jackson",
                "percentage": 1,
                "cost": "12.41"
            },
            {
                "name": "David",
                "percentage": 1,
                "cost": "12.41"
            },
            {
                "name": "Ethan",
                "percentage": 1,
                "cost": "12.41"
            },
            {
                "name": "Stephanie",
                "percentage": 1,
                "cost": "12.41"
            },
            {
                "name": "Henry",
                "percentage": 1,
                "cost": "12.41"
            },
            {
                "name": "Joey",
                "percentage": 1,
                "cost": "12.41"
            },
            {
                "name": "Gary",
                "percentage": 1,
                "cost": "12.41"
            },
            {
                "name": "eddy",
                "percentage": 1,
                "cost": "12.41"
            },
            {
                "name": "Justin",
                "percentage": 1,
                "cost": "12.41"
            },
            {
                "name": "Jonny",
                "percentage": 1,
                "cost": "12.41"
            },
            {
                "name": "May",
                "percentage": 1,
                "cost": "12.41"
            },
            {
                "name": "Jonathan",
                "percentage": 1,
                "cost": "12.41"
            },
            {
                "name": "Kevin",
                "percentage": 1,
                "cost": "12.41"
            },
            {
                "name": "Krizel",
                "percentage": 1,
                "cost": "12.41"
            },
            {
                "name": "Neil",
                "percentage": 1,
                "cost": "12.41"
            },
            {
                "name": "Gordon",
                "percentage": 1,
                "cost": "12.41"
            },
            {
                "name": "Chris",
                "percentage": 1,
                "cost": "12.41"
            },
            {
                "name": "Victor",
                "percentage": 1,
                "cost": "12.41"
            },
            {
                "name": "Karen",
                "percentage": 1,
                "cost": "12.41"
            },
            {
                "name": "Ann",
                "percentage": 1,
                "cost": "12.41"
            },
            {
                "name": "Katherine",
                "percentage": 1,
                "cost": "12.41"
            }
        ],
        "courtCount": 4,
        "birdiesUsed": [
            {
                "id": 1,
                "quantity": 21
            }
        ],
        "courtCost": 56
    }
}
function SessionCalendar() {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [isLoading, setIsLoading] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [modalData, setModalData] = useState({});
    const [testSession, setTestSession] = useState(exampleSession);
    const handlePrevMonth = () => {
        setCurrentDate(getPrevMonth(currentDate));
    };

    const handleNextMonth = () => {
        setCurrentDate(getNextMonth(currentDate));
    };

    const handleMonthSelect = (date) => {
        setCurrentDate(date);
    };

    const handleDayClick = async (date) => {
        console.log(`Day ${date} clicked`);
        console.log(testSession[date]); 
        setModalData(testSession[date])
        setShowModal(true);
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
                        selected={currentDate}
                        onChange={handleMonthSelect}
                        customInput={<CustomHeaderButton value={getMonthYear(currentDate)} />}
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
                        currentDate={currentDate}
                        sessionsMap={testSession}
                        onDayClick={handleDayClick}
                    />
                )}
            </div>

            <SessionModal show={showModal} onHide={() => setShowModal(false)} onAddSession={() => { console.log('added') }} session={modalData}
                birdies={exampleBirdies}
                onUpdatePaymentStatus={(id, name, status) => {
                    const tempSession = { ...testSession };
                    const userIndex = tempSession[id].attendees.findIndex(user => user.name === name);
                    tempSession[id].attendees[userIndex].paid = status;
                    setTestSession(tempSession);
                }}
                onUpdateHighlightStatus={(id, name, status) => {
                    const tempSession = { ...testSession };
                    const userIndex = tempSession[id].attendees.findIndex(user => user.name === name);
                    tempSession[id].attendees[userIndex].highlighted = status;
                    console.log("exampleSession ==> ", tempSession);

                    setTestSession(tempSession);
                }}
            />
        </div>
    );
}


export default SessionCalendar;