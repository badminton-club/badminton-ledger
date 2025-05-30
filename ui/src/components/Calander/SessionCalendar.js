import React, { useState } from "react";
import { Button, ButtonGroup, Spinner } from "react-bootstrap";
import { getMonthYear, getNextMonth, getPrevMonth } from "../../utils/dateUtils";
import CalendarGrid from "./CalendarGrid";
import DatePicker from "react-datepicker";
import "bootstrap/dist/css/bootstrap.min.css";
import SessionModal from "./SessionModal";
import { getDay, getMonth, getYear } from "date-fns";
import AddPlayerModal from "../AddUserModal";
import { collection, serverTimestamp, addDoc } from "firebase/firestore";
import { db, addSessionAndUpdateInventory } from "../../services/firebaseService";
import { useSelector } from "react-redux";
import { selectAllPlayers } from "../../features/players/playersSlice";

function SessionCalendar() {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [isLoading, setIsLoading] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [modalData, setModalData] = useState({});
    // const [testSession, setTestSession] = useState(exampleSession);

    const [showAddUserModal, setShowAddUserModal] = useState(false);
    const [initialPlayerName, setInitialPlayerName] = useState("");
    const existingPlayers = useSelector(selectAllPlayers);

    const handlePrevMonth = () => {
        setCurrentDate(getPrevMonth(currentDate));
    };

    const handleNextMonth = () => {
        setCurrentDate(getNextMonth(currentDate));
    };

    const handleMonthSelect = (date) => {
        setCurrentDate(date);
    };

    const handleDayClick = async (value) => {
        console.log(`Day ${value} clicked`);
        // const session = testSession.find(session => session.id === value);

        // console.log("session ==> ", session);
        // setModalData(session);
        setShowModal(true);
    };

    const handleRequestOpenAddPlayerModal = (initialName) => {
        console.log("Parent: SessionModal requested to add user:", initialName);
        setInitialPlayerName(initialName);
        setShowAddUserModal(true);
    };

    const handleAddNewPlayer = async (newUserDataFromModal) => {
        if (!db) {
            console.error("Firestore not initialized");
            throw new Error("Database not available. Cannot add user.");
        }
        console.log("Adding new user:", newUserDataFromModal);

        try {
            const playersCollectionRef = collection(db, "players");
            const dataToSave = {
                firstName: newUserDataFromModal.firstName,
                lastName: newUserDataFromModal.lastName || null,
                firstNameLower: newUserDataFromModal.firstName.toLowerCase(),
                lastNameLower: newUserDataFromModal.lastName ? newUserDataFromModal.lastName.toLowerCase() : null,
                email: newUserDataFromModal.email || null,
                balance: newUserDataFromModal.balance || 0,
                description: newUserDataFromModal.description || "",
                attendedSessionIds: [],
                createdAt: serverTimestamp(),
            };

            await addDoc(playersCollectionRef, dataToSave);
            setShowAddUserModal(false);
        } catch (error) {
            console.error("Error adding user to Firestore:", error);
            throw new Error(error.message || "Could not save new user to the database.");
        }
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

    const handleSessionSave = async (sessionData) => {
        await addSessionAndUpdateInventory(sessionData);
        setShowModal(false);
    };

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
                    <Button variant="outline-secondary" size="sm" onClick={handlePrevMonth} aria-label="Previous month">
                        &lt;
                    </Button>
                    <Button variant="outline-secondary" size="sm" onClick={handleNextMonth} aria-label="Next month">
                        &gt;
                    </Button>
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

                {!isLoading && <CalendarGrid currentDate={currentDate} sessionsMap={[]} onDayClick={handleDayClick} />}
            </div>

            <SessionModal
                show={showModal}
                onHide={() => setShowModal(false)}
                session={modalData}
                onUpdatePaymentStatus={(id, name, status) => {
                    // const tempSession = { ...testSession };
                    // const userIndex = tempSession[id].players.findIndex(user => user.name === name);
                    // tempSession[id].players[userIndex].paid = status;
                    // setTestSession(tempSession);
                }}
                onUpdateHighlightStatus={(id, name, status) => {
                    // const tempSession = { ...testSession };
                    // const userIndex = tempSession[id].players.findIndex(user => user.name === name);
                    // tempSession[id].players[userIndex].highlighted = status;
                    // setTestSession(tempSession);
                }}
                onSaveSession={(newSession) => {
                    const tempSession = { ...newSession };
                    tempSession.date = currentDate;
                    handleSessionSave(tempSession);
                }}
                onOpenAddUserModal={handleRequestOpenAddPlayerModal}
            />
            <AddPlayerModal
                show={showAddUserModal}
                onHide={() => setShowAddUserModal(false)}
                initialFirstName={initialPlayerName}
                onAddPlayer={handleAddNewPlayer}
                existingPlayers={existingPlayers}
            />
        </div>
    );
}

export default SessionCalendar;
