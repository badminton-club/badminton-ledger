import { createSlice } from "@reduxjs/toolkit";

export const MODALMODE = Object.freeze({
    VIEW: 0,
    ADDLIST: 1,
    NAMES_MATCHING: 2,
    ADDDETAILS: 3,
    EDIT: 4,
});

const initialState = {
    modalMode: MODALMODE.VIEW,
    playersInput: "",
    parsedNamesWithMatches: [],
    matchedPlayers: [],
    courtNumInput: "4",
    courtCostInput: "0",
    birdieUsage: [{ id: -1, quantity: 0 }],
    addError: "",
    formError: "",
    playerCosts: [],
    totalSessionCost: 0,
    totalBirdieCost: 0,
    totalCourtCost: 0,
    costPerPlayerEqual: true,
};

const sessionModalSlice = createSlice({
    name: "sessionModal",
    initialState,
    reducers: {
        setModalMode: (state, action) => {
            state.modalMode = action.payload;
        },
        setPlayersInput: (state, action) => {
            state.playersInput = action.payload;
        },
        setParsedNamesWithMatches: (state, action) => {
            state.parsedNamesWithMatches = action.payload;
        },
        setMatchedPlayers: (state, action) => {
            state.matchedPlayers = action.payload;
        },
        setCourtNumInput: (state, action) => {
            state.courtNumInput = action.payload;
        },
        setCourtCostInput: (state, action) => {
            state.courtCostInput = action.payload;
        },
        setBirdieUsage: (state, action) => {
            state.birdieUsage = action.payload;
        },
        setAddError: (state, action) => {
            state.addError = action.payload;
        },
        setFormError: (state, action) => {
            state.formError = action.payload;
        },
        setPlayerCosts: (state, action) => {
            state.playerCosts = action.payload;
        },
        setTotalSessionCost: (state, action) => {
            state.totalSessionCost = action.payload;
        },
        setTotalBirdieCost: (state, action) => {
            state.totalBirdieCost = action.payload;
        },
        setTotalCourtCost: (state, action) => {
            state.totalCourtCost = action.payload;
        },
        setCostPerPlayerEqual: (state, action) => {
            state.costPerPlayerEqual = action.payload;
        },
        resetSessionModal: () => initialState,
    },
});

export const {
    setModalMode,
    setPlayersInput,
    setParsedNamesWithMatches,
    setMatchedPlayers,
    setCourtNumInput,
    setCourtCostInput,
    setBirdieUsage,
    setAddError,
    setFormError,
    setPlayerCosts,
    setTotalSessionCost,
    setTotalBirdieCost,
    setTotalCourtCost,
    setCostPerPlayerEqual,
    resetSessionModal,
} = sessionModalSlice.actions;

export const selectSessionModalState = (state) => state.sessionModal;
export const selectModalMode = (state) => state.sessionModal.modalMode;
export default sessionModalSlice.reducer;
