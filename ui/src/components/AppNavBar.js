// src/components/AppNavbar.jsx
import React from 'react';
import { Navbar, Nav, Container, NavDropdown } from 'react-bootstrap';
import { Link } from 'react-router';

function AppNavbar() {
  return (
    <Navbar bg="primary" variant="dark" expand="lg" sticky="top" style={{ marginBottom: '20px', paddingBottom: '10px' }}>
      <Container>
        <Navbar.Brand as={Link} to="/">
          Badminton Ledger
        </Navbar.Brand>

        <Navbar.Toggle aria-controls="basic-navbar-nav" />
        <Navbar.Collapse id="basic-navbar-nav">
          <Nav className="ms-auto">
            <Nav.Link as={Link} to="/birdies">
              Birdies
            </Nav.Link>
            <Nav.Link as={Link} to="/credits">
              Credits
            </Nav.Link>
            <Nav.Link as={Link} to="/players">
              Players
            </Nav.Link>
            <Nav.Link as={Link} to="/auth">
              Auth
            </Nav.Link>
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
