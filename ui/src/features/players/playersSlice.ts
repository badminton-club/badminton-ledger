import {
  createSlice,
  createEntityAdapter,
  createAsyncThunk,
  PayloadAction,
} from '@reduxjs/toolkit';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import type { Player } from 'types';
import type { RootState } from '../../store';

const playersAdapter = createEntityAdapter<Player>();  // no selectId needed — RTK infers 'id'

interface PlayersState {
  status:      'idle' | 'loading' | 'succeeded' | 'failed';
  error:       string | null;
  isListening: boolean;
}

const initialState = playersAdapter.getInitialState<PlayersState>({
  status:      'idle',
  error:       null,
  isListening: false,
});

export const subscribeToPlayers = createAsyncThunk(
  'players/subscribeToPlayers',
  async (_, { dispatch, signal }) => {
    const q = query(
      collection(db, 'players'),
      orderBy('firstName'),
      orderBy('lastName')
    );

    dispatch(playersSlice.actions.setLoading());

    return new Promise<string>((resolve, reject) => {
      const unsubscribe = onSnapshot(
        q,
        snap => {
          const players = snap.docs.map(d => ({ id: d.id, ...d.data() } as Player));
          dispatch(playersSlice.actions.setPlayers(players));
          resolve('listener attached');
        },
        err => {
          dispatch(playersSlice.actions.setError(err.message));
          reject(err);
        }
      );

      signal.addEventListener('abort', () => {
        unsubscribe();
        dispatch(playersSlice.actions.setListenerInactive());
        resolve('listener aborted');
      });
    });
  }
);

const playersSlice = createSlice({
  name: 'players',
  initialState,
  reducers: {
    setLoading: state => {
      state.status      = 'loading';
      state.isListening = true;
    },
    setPlayers: (state, action: PayloadAction<Player[]>) => {
      playersAdapter.setAll(state, action.payload);
      state.status = 'succeeded';
      state.error  = null;
    },
    setError: (state, action: PayloadAction<string>) => {
      state.status      = 'failed';
      state.error       = action.payload;
      state.isListening = false;
    },
    setListenerInactive: state => {
      state.isListening = false;
      state.status      = 'idle';
    },
  },
  extraReducers: builder => {
    builder
      .addCase(subscribeToPlayers.pending, state => {
        if (state.status === 'idle') {
          state.status      = 'loading';
          state.isListening = true;
        }
        state.error = null;
      })
      .addCase(subscribeToPlayers.rejected, (state, action) => {
        state.status      = 'failed';
        state.error       = action.error.message ?? 'Subscription failed';
        state.isListening = false;
      });
  },
});

export const { setLoading, setPlayers, setError, setListenerInactive } = playersSlice.actions;
export default playersSlice.reducer;

export const {
  selectAll:  selectAllPlayers,
  selectById: selectPlayerById,
  selectIds:  selectPlayerIds,
} = playersAdapter.getSelectors((state: RootState) => state.players);

export const selectPlayersStatus     = (s: RootState) => s.players.status;
export const selectPlayersError      = (s: RootState) => s.players.error;
export const selectIsPlayerListening = (s: RootState) => s.players.isListening;