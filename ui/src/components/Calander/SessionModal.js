import React, { useState, useEffect, useCallback, useRef } from "react";
import { Modal } from "react-bootstrap";
import { findUserMatchesByName } from "../../services/firebaseService";
import { useDispatch, useSelector } from "react-redux";
import { selectAllPlayers } from "../../features/players/playersSlice";
import AddSessionList from "./SessionModal/components/AddSessionList";
import SessionDetails from "./SessionModal/components/SessionDetails";
import {
    setModalMode,
    setPlayersInput,
    setParsedNamesWithMatches,
    setMatchedPlayers,
    setFormError,
    setAddError,
    MODALMODE,
    selectModalMode,
} from "../../features/SessionModal/sessionModalSlice";
import ListNamesMatching from "./SessionModal/components/ListNamesMatching";
import NoSessionView from "./SessionModal/components/NoSessionView";
import { store } from "../../store";

const formatDisplayPlayerName = (user) => {
    if (!user) return "N/A";
    return `${user.firstName || ""} ${user.lastName || ""}`.trim();
};

function SessionModal({
    show,
    onHide,
    session,
    onUpdateHighlightStatus,
    onUpdatePaymentStatus,
    onSaveSession,
    onOpenAddUserModal,
}) {
    const dispatch = useDispatch();
    const modalMode = useSelector(selectModalMode);

    const parsedNamesWithMatches = useSelector(() => store.getState().sessionModal.parsedNamesWithMatches);

    const playersListFromStore = useSelector(selectAllPlayers);
    console.log("playersListFromStore ==> ", playersListFromStore);
    const prevPlayersListRef = useRef(playersListFromStore);


    const [isLoadingMatches, setIsLoadingMatches] = useState(false);

    useEffect(() => {
        if (!show) {
            dispatch(setModalMode(MODALMODE.VIEW));
            dispatch(setPlayersInput(""));
            dispatch(setParsedNamesWithMatches([]));
            dispatch(setMatchedPlayers([]));
            dispatch(setFormError(""));
            setIsLoadingMatches(false);
        } else if (session && modalMode !== MODALMODE.EDIT) {
            setModalMode(MODALMODE.VIEW);
        } else if (
            !session &&
            ![MODALMODE.ADDLIST, MODALMODE.NAMES_MATCHING, MODALMODE.ADDDETAILS].includes(modalMode)
        ) {
            dispatch(setModalMode(MODALMODE.VIEW));
        }
    }, [show, session]);

    useEffect(() => {
        const playerListContentChangedSignificant = () => {
            if (!prevPlayersListRef.current || !playersListFromStore) return false;
            if (prevPlayersListRef.current.length !== playersListFromStore.length) return true;
            const prevIds = new Set(prevPlayersListRef.current.map((p) => p.id));
            for (const player of playersListFromStore) {
                if (!prevIds.has(player.id)) return true;
            }
            return false;
        };
        if (
            show &&
            modalMode === MODALMODE.NAMES_MATCHING &&
            playerListContentChangedSignificant() &&
            !isLoadingMatches
        ) {
            setIsLoadingMatches(true);
            dispatch(setFormError(""));
            const rematchAndUpdate = async () => {
                const updatedItems = await Promise.all(
                    parsedNamesWithMatches.map(async (currentItem) => {
                        if (currentItem.status === "resolved" || currentItem.isEditingName) return currentItem;
                        try {
                            const matches = await findUserMatchesByName(currentItem.originalName);
                            if (matches.length === 1)
                                return {
                                    ...currentItem,
                                    status: "singleMatch",
                                    potentialMatches: matches,
                                    selectedPlayerId: matches[0].id,
                                    error: undefined,
                                };
                            if (matches.length > 1)
                                return {
                                    ...currentItem,
                                    status: "multipleMatches",
                                    potentialMatches: matches,
                                    selectedPlayerId: null,
                                    error: undefined,
                                };
                            return {
                                ...currentItem,
                                status: "unmatched",
                                potentialMatches: [],
                                selectedPlayerId: null,
                                error: undefined,
                            };
                        } catch (error) {
                            return { ...currentItem, status: "matchingFailed", error: "Re-matching failed" };
                        }
                    })
                );
                dispatch(setParsedNamesWithMatches(updatedItems));
                setIsLoadingMatches(false);
            };
            rematchAndUpdate().catch((err) => {
                dispatch(setFormError("Error refreshing matches."));
                setIsLoadingMatches(false);
            });
        }
        prevPlayersListRef.current = [...playersListFromStore];
    }, [playersListFromStore, modalMode, show, isLoadingMatches, parsedNamesWithMatches, dispatch]);

    const runNameMatching = useCallback(
        async (namesToParse, targetIndexForUpdate = null) => {
            console.log("namesToParse ==> ", namesToParse);
            // setIsLoadingMatches(true);
            dispatch(setFormError(""));

            const matchPromises = namesToParse.map(async (nameString) => {
                try {
                    const matches = await findUserMatchesByName(nameString);
                    if (matches.length === 1) {
                        return {
                            originalName: nameString,
                            editableName: nameString,
                            isEditingName: false,
                            status: "singleMatch",
                            potentialMatches: matches,
                            selectedPlayerId: matches[0].id,
                        };
                    } else if (matches.length > 1) {
                        return {
                            originalName: nameString,
                            editableName: nameString,
                            isEditingName: false,
                            status: "multipleMatches",
                            potentialMatches: matches,
                            selectedPlayerId: null,
                        };
                    } else {
                        return {
                            originalName: nameString,
                            editableName: nameString,
                            isEditingName: false,
                            status: "unmatched",
                            potentialMatches: [],
                            selectedPlayerId: null,
                        };
                    }
                } catch (error) {
                    console.error(`Error matching name "${nameString}":`, error);
                    return {
                        originalName: nameString,
                        editableName: nameString,
                        isEditingName: false,
                        status: "matchingFailed",
                        potentialMatches: [],
                        selectedPlayerId: null,
                        error: "Matching process failed for this name",
                    };
                }
            });

            try {
                const results = await Promise.all(matchPromises);

                if (targetIndexForUpdate !== null && results.length === 1) {
                    dispatch(
                        setParsedNamesWithMatches((prev) => {
                            const newArray = [...prev];
                            const newMatchData = results[0];
                            newArray[targetIndexForUpdate] = {
                                ...newArray[targetIndexForUpdate],
                                originalName: newMatchData.originalName,
                                editableName: newMatchData.originalName,
                                isEditingName: false,
                                status: newMatchData.status,
                                potentialMatches: newMatchData.potentialMatches,
                                selectedPlayerId: newMatchData.selectedPlayerId,
                                error: newMatchData.error,
                            };
                            return newArray;
                        })
                    );
                } else {
                    console.log("results ==> ", results);
                    dispatch(setParsedNamesWithMatches(results.map((item) => ({ ...item }))));
                }
            } catch (overallError) {
                dispatch(setFormError("An error occurred while trying to match names."));
            } finally {
                // setIsLoadingMatches(false);
            }
        },
        [dispatch]
    );

    const handleGoToNamesMatching = async (playersInput) => {
        dispatch(setFormError(""));
        const trimmedInput = playersInput.trim();
        if (!trimmedInput) {
            dispatch(setFormError("Player list cannot be empty."));
            return;
        }
        const parsedNames = trimmedInput
            .split(/[\n,]+/)
            .map((p) => p.trim())
            .filter((p) => p !== "");
        if (parsedNames.length === 0) {
            dispatch(setFormError("Please enter valid player names."));
            return;
        }

        const nameRegex = /^\s*\d+\s*\.\s*(.*)$/;
        const names = [];
        for (const line of parsedNames) {
            const matchResult = line.match(nameRegex);
            if (matchResult) {
                const name = matchResult[1].trim();
                if (name) {
                    names.push(name);
                }
            }
        }
        if (names.length === 0) {
            dispatch(setAddError("No valid player names found."));
            return;
        }

        setIsLoadingMatches(true);
        try {
            await runNameMatching(names);
            dispatch(setModalMode(MODALMODE.NAMES_MATCHING));
        } catch (overallError) {
            dispatch(setFormError("An error occurred while trying to match names."));
        } finally {
            setIsLoadingMatches(false);
        }
    };

    const handleSaveNameAndRematch = async (index) => {
        const itemToRematch = parsedNamesWithMatches[index];
        if (!itemToRematch.editableName.trim()) {
            dispatch(setFormError("Edited name cannot be empty."));
            // setParsedNamesWithMatches(prev => prev.map((item, i) => i === index ? {...item, isEditingName: true} : item));
            return;
        }
        await runNameMatching([itemToRematch.editableName], index); // Pass array with single name and target index
    };

    const handleGoToDetails = () => {
        dispatch(setFormError(""));
        const confirmedPlayersForStage2 = [];
        for (const item of parsedNamesWithMatches) {
            console.log("parsedNamesWithMatches ==> ", parsedNamesWithMatches);
            if (item.selectedPlayerId) {
                // Must have a selected user ID
                const matchedUser = item.potentialMatches.find((u) => u.id === item.selectedPlayerId);
                confirmedPlayersForStage2.push({
                    name: matchedUser ? formatDisplayPlayerName(matchedUser) : item.originalName,
                    id: item.selectedPlayerId,
                    paymentPercentage: 1,
                });
            } else {
                dispatch(
                    setFormError(
                        `Please select a player for "${item.originalName}". If the player is new, please add them to the system first via the Players page.`
                    )
                );
                return;
            }
        }
        dispatch(setMatchedPlayers(confirmedPlayersForStage2));
        dispatch(setModalMode(MODALMODE.ADDDETAILS));
    };

    const handlePaymentToggle = (player) => {
        console.log("player ==> ", player);
        if (!onUpdatePaymentStatus || !session || !session.id || !player || !player.name) {
            console.error("Missing data or handler for payment update", {
                handler: !!onUpdatePaymentStatus,
                session,
                player,
            });
            setAddError("Cannot update payment status - configuration error.");
            return;
        }
        const currentPaidStatus = !!player.paid;
        const newPaidStatus = !currentPaidStatus;
        onUpdatePaymentStatus(session.id, player.name, newPaidStatus);
    };

    const handleHighlightToggle = (player) => {
        if (!onUpdateHighlightStatus || !session || !session.id || !player || !player.name) {
            console.error("Missing data or handler for highlight update", {
                handler: !!onUpdateHighlightStatus,
                session,
                player,
            });
            setAddError("Cannot update highlight status - configuration error.");
            return;
        }
        const currentHighlightStatus = !!player.highlighted;
        const newHighlightStatus = !currentHighlightStatus;
        onUpdateHighlightStatus(session.id, player.name, newHighlightStatus);
    };

    const handleSessionSubmit = (
        courtNumInput,
        totalBirdieCost,
        totalSessionCost,
        totalCourtCost,
        birdieUsage,
        playerCosts,
        courtCreditUsage
    ) => {
        setAddError("");

        const courtCount = parseFloat(courtNumInput);
        const validBirdieSets = birdieUsage.filter((set) => set.id && set.quantity > 0);

        const newSessionData = {
            players: playerCosts,
            courtCount,
            birdieUsage: validBirdieSets.map((set) => ({
                id: set.id,
                quantity: set.quantity,
            })),
            courtCreditUsage: courtCreditUsage,
            totalSessionCost,
            totalBirdieCost,
            totalCourtCost,
        };
        onSaveSession(newSessionData);
        console.log("newSessionData ==> ", newSessionData);
    };

    const getModalHeader = () => {
        switch (modalMode) {
            case MODALMODE.ADDLIST:
                return "Add Session - Step 1: Players";
            case MODALMODE.NAMES_MATCHING:
                return "Add Session - Step 2: Confirm Attendees";
            case MODALMODE.ADDDETAILS:
                return "Add Session - Step 3: Details";
            case MODALMODE.EDIT:
                return "Edit Session";
            default:
                return "Session Details";
        }
    };

    console.log("modalMode ==> ", modalMode);
    const renderModalBody = () => {
        switch (modalMode) {
            case MODALMODE.ADDLIST:
                return <AddSessionList handleGoToNamesMatching={handleGoToNamesMatching} onHide={onHide} />;
            case MODALMODE.NAMES_MATCHING:
                return (
                    <ListNamesMatching
                        isLoadingMatches={isLoadingMatches}
                        handleSaveNameAndRematch={handleSaveNameAndRematch}
                        handleGoToDetails={handleGoToDetails}
                        formatDisplayPlayerName={formatDisplayPlayerName}
                        onOpenAddUserModal={onOpenAddUserModal}
                    />
                );
            case MODALMODE.ADDDETAILS:
            case MODALMODE.EDIT:
                return <SessionDetails onHide={onHide} handleSessionSubmit={handleSessionSubmit} />;
            default:
                console.log("default");
                return <NoSessionView />;
            // session && session.id ? <ExistingSessionDetails /> :
        }
    };

    return (
        <Modal show={show} onHide={onHide} centered size="lg" style={{ minHeight: "100%" }}>
            <Modal.Header closeButton>
                <Modal.Title>{getModalHeader()}</Modal.Title>
            </Modal.Header>
            <Modal.Body>{renderModalBody()}</Modal.Body>
        </Modal>
    );
}

export default SessionModal;
