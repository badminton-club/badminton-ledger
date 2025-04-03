import './App.css';
import { Container, Row, Col, Button } from 'react-bootstrap';
import SessionCalendar from './components/Calander/SessionCalendar';


const session = {
  date: "March 18, 2025",
  players: 12,
  birdiesUsed: 4,
  unpaidPlayers: ["John Doe", "Mark Lee"]
};

function App() {
  return (
    <div className="App">
      <Container >
        <Row className='mb-3'>
          <Col md={4} className="birdie-button-column">
            <div className="birdie-button-wrapper">
              <button className="birdie-button" >
                <img src="birdie.png" alt="Birdie" className="birdie-image" />
              </button>
            </div>

            <div className="birdie-button-wrapper">
              <button className="birdie-button">
                <img src="court.png" alt="Court" className="birdie-image" />
              </button>
            </div>
          </Col>
          <Col md={8}>
            <div className="session-card"> {/* Using the updated CSS class */}
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
      </Container>
    </div>
  );
}

export default App;
