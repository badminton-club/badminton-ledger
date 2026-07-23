import React from "react";
import { Navbar, Nav, NavDropdown, Container, Badge } from "react-bootstrap";
import { Link } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../hooks";
import {
    selectUserClubs,
    selectCurrentClub,
    selectCurrentClubId,
    selectClubRole,
    selectDisabledTabs,
    setCurrentClub,
} from "../features/club/clubSlice";
import { TOGGLEABLE_TABS } from "../features/club/tabs";

export default function AppNavbar() {
    const dispatch = useAppDispatch();
    const clubs = useAppSelector(selectUserClubs);
    const currentClub = useAppSelector(selectCurrentClub);
    const currentClubId = useAppSelector(selectCurrentClubId);
    const role = useAppSelector(selectClubRole);
    const disabledTabs = useAppSelector(selectDisabledTabs);
    const isAdmin = role === "admin" || role === "superAdmin";

    return (
        <Navbar bg="primary" variant="dark" expand="lg" sticky="top" style={{ marginBottom: 20, paddingBottom: 10 }}>
            <Container>
                <Navbar.Brand as={Link} to="/" className="d-flex align-items-center gap-2">
                    <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true">
                        <path d="M19 15 L45 15 L38 45 L26 45 Z" fill="#ffffff" />
                        <g stroke="#0d6efd" strokeWidth="1.6" strokeLinecap="round" fill="none">
                            <path d="M32 15 L32 45" />
                            <path d="M25 15 L28.5 45" />
                            <path d="M39 15 L35.5 45" />
                            <path d="M26.5 39 L37.5 39" />
                        </g>
                        <path d="M26 45 L38 45 L37 52 a5 6 0 0 1 -10 0 Z" fill="#f4c99a" stroke="#dca971" strokeWidth="1.2" />
                    </svg>
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
                        {currentClubId && (
                            <Nav.Link as={Link} to="/attendance">
                                Attendance
                            </Nav.Link>
                        )}
                        {isAdmin && (
                            <>
                                {TOGGLEABLE_TABS.filter((t) => !disabledTabs.includes(t.key)).map((t) => (
                                    <Nav.Link key={t.key} as={Link} to={t.path}>
                                        {t.label}
                                    </Nav.Link>
                                ))}
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
