import './App.css';
import { Container, Row, Col, Button } from 'react-bootstrap';
import SessionCalendar from './components/Calander/SessionCalendar';
import AddBirdieBatchModal from './components/AddBirdieBatchModal';
import { useState } from 'react';
import { collection, addDoc, serverTimestamp, Timestamp} from 'firebase/firestore';
import { db } from './fireBaseService'; // Ensure this is the correct path to your Firebase service
import AddCourtCreditModal from './components/AddCourtCreditsModal';



const session = {
  date: "March 18, 2025",
  players: 12,
  birdiesUsed: 4,
  unpaidPlayers: ["John Doe", "Mark Lee"]
};


const handleAddCourtCredit = async (batchData) => {
  if (!db) {
    console.error("Firestore database instance (db) is not available.");
    throw new Error("Database not initialized.");
  }

  console.log("Attempting to add new birdie batch:", batchData);

  try {
    const inventoryCollectionRef = collection(db, "courtCredits");
    const docRef = await addDoc(inventoryCollectionRef, {
      ...batchData,
      purchasedDate: Timestamp.fromDate(batchData.purchasedDate),
      createdAt: serverTimestamp()
    });

    console.log("Successfully added birdie batch with ID:", docRef.id);

  } catch (error) {
    console.error("Error writing new birdie batch to Firestore:", error);
    throw new Error("Database error: Could not save the new birdie batch.");
  }
}

const handleAddBirdieBatch = async (batchData) => {
  if (!db) {
    console.error("Firestore database instance (db) is not available.");
    throw new Error("Database not initialized.");
  }

  console.log("Attempting to add new birdie batch:", batchData);

  try {
    const inventoryCollectionRef = collection(db, "birdieInventory");
    const docRef = await addDoc(inventoryCollectionRef, {
      ...batchData,
      purchasedDate: Timestamp.fromDate(batchData.purchasedDate),
      createdAt: serverTimestamp()
    });

    console.log("Successfully added birdie batch with ID:", docRef.id);

  } catch (error) {
    console.error("Error writing new birdie batch to Firestore:", error);
    throw new Error("Database error: Could not save the new birdie batch.");
  }


}
function App() {

  const [showAddBirdieBatchModal, setShowAddBirdieBatchModal] = useState(false);
  const [showAddCourtCreditModal, setShowAddCourtCreditModal] = useState(false);

  return (
    <div className="App">
      <Container >
        <Row className='mb-3'>
          <Col md={4} className="birdie-button-column">
            <div className="birdie-button-wrapper">
              <button className="birdie-button" onClick={() => setShowAddBirdieBatchModal(true)}>
                <img src="birdie.png" alt="Birdie" className="birdie-image" />
              </button>
            </div>

            <div className="birdie-button-wrapper">
              <button className="birdie-button" onClick={() => setShowAddCourtCreditModal(true)}>
                <img src="court.png" alt="Court" className="birdie-image" />
              </button>
            </div>
          </Col>
          <Col md={8}>
            <div className="session-card"> 
              <h2 className="session-title">
                Previous Session
              </h2>
              <p className="session-date">{session.date}</p>

              <div className="session-details">
                <p className="session-info">
                  Players: {session.players}
                </p>
                <p className="session-info">
                  Birdies Used: {session.birdiesUsed}
                </p>
              </div>

              <div className="mt-3">
                <h3 className="unpaid-title">
                  Unpaid Players:
                </h3>
                {session.unpaidPlayers.length > 0 ? (
                  <ul className="list-disc list-inside">
                    {session.unpaidPlayers.map((player, index) => (
                      <li key={index} className="unpaid-player">
                        {player}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="no-unpaid">
                    All players have paid.
                  </p>
                )}
              </div>

              <Button variant="primary" className="mark-payments-button">
                Mark Payments
              </Button>
            </div>
          </Col>
        </Row>
        <Row>
          <SessionCalendar />
        </Row>
        <AddBirdieBatchModal show={showAddBirdieBatchModal} onHide={() => setShowAddBirdieBatchModal(false)} onAddBatch={handleAddBirdieBatch} />
        <AddCourtCreditModal show={showAddCourtCreditModal} onHide={() => setShowAddCourtCreditModal(false)} onAddBatch={handleAddCourtCredit} />

      </Container>
    </div>
  );
}

export default App;
