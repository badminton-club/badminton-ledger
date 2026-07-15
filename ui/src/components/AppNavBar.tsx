import React from "react";
import { Navbar, Nav, NavDropdown, Container, Badge } from "react-bootstrap";
import { Link } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../hooks";
import {
    selectUserClubs,
    selectCurrentClub,
    selectCurrentClubId,
    selectClubRole,
    setCurrentClub,
} from "../features/club/clubSlice";

export default function AppNavbar() {
    const dispatch = useAppDispatch();
    const clubs = useAppSelector(selectUserClubs);
    const currentClub = useAppSelector(selectCurrentClub);
    const currentClubId = useAppSelector(selectCurrentClubId);
    const role = useAppSelector(selectClubRole);
    const isAdmin = role === "admin";

    return (
        <Navbar bg="primary" variant="dark" expand="lg" sticky="top" style={{ marginBottom: 20, paddingBottom: 10 }}>
            <Container>
                <Navbar.Brand as={Link} to="/">
                    Badminton Ledger
                </Navbar.Brand>
                <Navbar.Toggle aria-controls="main-nav" />
                <Navbar.Collapse id="main-nav">
                    <Nav className="me-auto">
                        {clubs.length > 0 && (
                            <NavDropdown
                                title={currentClub ? currentClub.name : "Select club"}
                                id="club-switcher"
                            >
                                {clubs.map((c) => (
                                    <NavDropdown.Item
                                        key={c.id}
                                        active={c.id === currentClubId}
                                        onClick={() => dispatch(setCurrentClub(c.id))}
                                    >
                                        {c.name}
                                        {c.role && (
                                            <Badge bg={c.role === "admin" ? "success" : "secondary"} className="ms-2">
                                                {c.role}
                                            </Badge>
                                        )}
                                    </NavDropdown.Item>
                                ))}
                            </NavDropdown>
                        )}
                    </Nav>
                    <Nav className="ms-auto">
                        {isAdmin && (
                            <>
                                <Nav.Link as={Link} to="/birdies">
                                    Birdies
                                </Nav.Link>
                                <Nav.Link as={Link} to="/credits">
                                    Credits
                                </Nav.Link>
                                <Nav.Link as={Link} to="/players">
                                    Players
                                </Nav.Link>
                                <Nav.Link as={Link} to="/payout">
                                    Payout
                                </Nav.Link>
                                <Nav.Link as={Link} to="/settings">
                                    Settings
                                </Nav.Link>
                            </>
                        )}
                        <Nav.Link as={Link} to="/auth">
                            Account
                        </Nav.Link>
                    </Nav>
                </Navbar.Collapse>
            </Container>
        </Navbar>
    );
}
