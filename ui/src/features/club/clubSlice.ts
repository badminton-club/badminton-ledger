import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '../../store';
import type { ClubRole, UserClub } from '../../types';

interface ClubState {
  currentClubId: string | null;
  role: ClubRole | null;      // the signed-in user's role in the current club
  clubs: UserClub[];          // the user's saved clubs (name + role)
  birdiesEnabled: boolean;    // current club's Birdies-tab setting (default on)
  ready: boolean;             // club bootstrap has finished
}

const initialState: ClubState = {
  currentClubId: null,
  role: null,
  clubs: [],
  birdiesEnabled: true,
  ready: false,
};

const clubSlice = createSlice({
  name: 'club',
  initialState,
  reducers: {
    setCurrentClub(state, action: PayloadAction<string | null>) {
      state.currentClubId = action.payload;
    },
    setRole(state, action: PayloadAction<ClubRole | null>) {
      state.role = action.payload;
    },
    setClubs(state, action: PayloadAction<UserClub[]>) {
      state.clubs = action.payload;
    },
    setBirdiesEnabled(state, action: PayloadAction<boolean>) {
      state.birdiesEnabled = action.payload;
    },
    setReady(state, action: PayloadAction<boolean>) {
      state.ready = action.payload;
    },
    resetClub() {
      return { ...initialState, ready: true };
    },
  },
});

export const { setCurrentClub, setRole, setClubs, setBirdiesEnabled, setReady, resetClub } = clubSlice.actions;
export default clubSlice.reducer;

export const selectCurrentClubId = (s: RootState) => s.club.currentClubId;
export const selectClubRole      = (s: RootState) => s.club.role;
export const selectUserClubs     = (s: RootState) => s.club.clubs;
export const selectBirdiesEnabled = (s: RootState) => s.club.birdiesEnabled;
export const selectClubReady     = (s: RootState) => s.club.ready;
export const selectIsClubAdmin   = (s: RootState) => s.club.role === 'admin';
export const selectCurrentClub   = (s: RootState) =>
  s.club.clubs.find((c) => c.id === s.club.currentClubId) ?? null;
