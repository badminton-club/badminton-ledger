// src/components/AppNavbar.jsx
import React, { useEffect, useState } from 'react';
import { Navbar, Nav, Container, NavDropdown } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { checkIfAdmin, onAuthStateChangedListener } from '../services/firebaseService';

function AppNavbar() {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let unsub = null;
    try {
      console.log("in");
      unsub = onAuthStateChangedListener(async (user) => {
        try {
          const admin = await checkIfAdmin(user?.uid ?? null);
          console.log("admin: ", admin);
          setIsAdmin(Boolean(admin));
        } catch (err) {
          console.error('Error checking admin status in navbar:', err);
          setIsAdmin(false);
        }
      });
    } catch (e) {
      // If auth not ready, do a best-effort check
      (async () => {
        try {
          const admin = await checkIfAdmin();
          setIsAdmin(Boolean(admin));
        } catch (err) {
          setIsAdmin(false);
        }
      })();
    }
    return () => { if (typeof unsub === 'function') unsub(); };
  }, []);

  return (
    <Navbar bg="primary" variant="dark" expand="lg" sticky="top" style={{ marginBottom: '20px', paddingBottom: '10px' }}>
      <Container>
        <Navbar.Brand as={Link} to="/">
          Badminton Ledger
        </Navbar.Brand>

        <Navbar.Toggle aria-controls="basic-navbar-nav" />
        <Navbar.Collapse id="basic-navbar-nav">
          <Nav className="ms-auto">
            {isAdmin && (
              <>
                <Nav.Link as={Link} to="/birdies">Birdies</Nav.Link>
                <Nav.Link as={Link} to="/credits">Credits</Nav.Link>
                <Nav.Link as={Link} to="/players">Players</Nav.Link>
              </>
            )}
            <Nav.Link as={Link} to="/auth">Auth</Nav.Link>
            {/* <NavDropdown title="Sessions" id="sessions-nav-dropdown">
              <NavDropdown.Item as={Link} to="/sessions/calendar">
                Calendar
              </NavDropdown.Item>
              <NavDropdown.Item as={Link} to="/sessions/add">
                Add New
              </NavDropdown.Item>
              <NavDropdown.Divider />
              <NavDropdown.Item as={Link} to="/sessions/history">
                History
              </NavDropdown.Item>
            </NavDropdown> */}
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
}

export default AppNavbar;
