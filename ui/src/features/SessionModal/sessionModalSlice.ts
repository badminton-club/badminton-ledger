import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { ModalMode, NameResolutionItem, ConfirmedPlayer } from 'types';
import type { RootState } from '../../store';

// ─── State ────────────────────────────────────────────────────────────────────

interface SessionModalState {
  mode: ModalMode;

  // Step 1 – paste
  playersInput: string;

  // Step 2 – resolve
  resolutionItems: NameResolutionItem[];

  // Step 3 – details
  confirmedPlayers: ConfirmedPlayer[];

  // Errors (grouped — not two separate fields)
  errors: {
    form?: string;
    add?: string;
  };
}

const initialState: SessionModalState = {
  mode:             'view',
  playersInput:     '',
  resolutionItems:  [],
  confirmedPlayers: [],
  errors:           {},
};

// ─── Slice ────────────────────────────────────────────────────────────────────

const sessionModalSlice = createSlice({
  name: 'sessionModal',
  initialState,
  reducers: {
    setMode: (state, action: PayloadAction<ModalMode>) => {
      state.mode = action.payload;
    },
    setPlayersInput: (state, action: PayloadAction<string>) => {
      state.playersInput = action.payload;
    },
    setResolutionItems: (state, action: PayloadAction<NameResolutionItem[]>) => {
      state.resolutionItems = action.payload;
    },
    updateResolutionItem: (
      state,
      action: PayloadAction<{ index: number; patch: Partial<NameResolutionItem> }>
    ) => {
      const { index, patch } = action.payload;
      if (state.resolutionItems[index]) {
        state.resolutionItems[index] = { ...state.resolutionItems[index], ...patch };
      }
    },
    setConfirmedPlayers: (state, action: PayloadAction<ConfirmedPlayer[]>) => {
      state.confirmedPlayers = action.payload;
    },
    setFormError: (state, action: PayloadAction<string>) => {
      state.errors.form = action.payload || undefined;
    },
    setAddError: (state, action: PayloadAction<string>) => {
      state.errors.add = action.payload || undefined;
    },
    clearErrors: state => {
      state.errors = {};
    },
    resetModal: () => initialState,
  },
});

export const {
  setMode,
  setPlayersInput,
  setResolutionItems,
  updateResolutionItem,
  setConfirmedPlayers,
  setFormError,
  setAddError,
  clearErrors,
  resetModal,
} = sessionModalSlice.actions;

export default sessionModalSlice.reducer;

// ─── Selectors ────────────────────────────────────────────────────────────────

export const selectModalMode         = (s: RootState) => s.sessionModal.mode;
export const selectPlayersInput      = (s: RootState) => s.sessionModal.playersInput;
export const selectResolutionItems   = (s: RootState) => s.sessionModal.resolutionItems;
export const selectConfirmedPlayers  = (s: RootState) => s.sessionModal.confirmedPlayers;
export const selectFormError         = (s: RootState) => s.sessionModal.errors.form;
export const selectAddError          = (s: RootState) => s.sessionModal.errors.add;

/** True when every resolution item has a resolvedPlayerId. */
export const selectAllResolved = (s: RootState) =>
  s.sessionModal.resolutionItems.length > 0 &&
  s.sessionModal.resolutionItems.every(item => item.resolvedPlayerId !== null);
