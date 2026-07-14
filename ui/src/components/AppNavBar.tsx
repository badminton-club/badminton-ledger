import React from "react";
import { Navbar, Nav, Container } from "react-bootstrap";
import { Link } from "react-router-dom";

export default function AppNavbar() {
    return (
        <Navbar bg="primary" variant="dark" expand="lg" sticky="top" style={{ marginBottom: 20, paddingBottom: 10 }}>
            <Container>
                <Navbar.Brand as={Link} to="/">
                    Badminton Ledger
                </Navbar.Brand>
                <Navbar.Toggle aria-controls="main-nav" />
                <Navbar.Collapse id="main-nav">
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
                        <Nav.Link as={Link} to="/settings">
                            Settings
                        </Nav.Link>
                    </Nav>
                </Navbar.Collapse>
            </Container>
        </Navbar>
    );
}
