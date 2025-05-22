// src/features/players/playersSlice.js
import { createSlice, createEntityAdapter, createAsyncThunk } from '@reduxjs/toolkit';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebaseService';

const playersAdapter = createEntityAdapter({
    selectId: (player) => player.id,

});

const initialState = playersAdapter.getInitialState({
    status: 'idle', // 'idle' | 'loading' | 'succeeded' | 'failed'
    error: null,    // string | null
    isListening: false,
});


export const subscribeToPlayers = createAsyncThunk(
    'players/subscribeToPlayers',
    async (_, { dispatch, signal }) => {
        if (!db) {
            dispatch(playersSlice.actions.setError("Firestore not initialized."));
            throw new Error("Firestore not initialized.");
        }
        const playersCollectionRef = collection(db, "players");
        const q = query(playersCollectionRef, orderBy("firstName"), orderBy("lastName"));

        dispatch(playersSlice.actions.setLoading());

        return new Promise((resolve, reject) => {
            const unsubscribe = onSnapshot(q,
                (querySnapshot) => {
                    const fetchedPlayers = querySnapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data(),
                    }));
                    console.log("Players snapshot received, count:", fetchedPlayers.length);
                    dispatch(playersSlice.actions.setPlayers(fetchedPlayers));
                    resolve("Player listener attached");
                },
                (error) => {
                    console.error("Error in players onSnapshot listener:", error);
                    dispatch(playersSlice.actions.setError(error.message));
                    reject(error);
                }
            );

            signal.addEventListener('abort', () => {
                console.log("Aborting players subscription, unsubscribing...");
                unsubscribe();
                dispatch(playersSlice.actions.setListenerInactive());
                resolve("Player listener aborted and unsubscribed");
            });
        });
    }
);


export const playersSlice = createSlice({
    name: 'players',
    initialState,
    reducers: {
        setLoading: (state) => {
            state.status = 'loading';
            state.isListening = true;
        },
        setPlayers: (state, action) => {
            playersAdapter.setAll(state, action.payload);
            state.status = 'succeeded';
            state.error = null;
        },
        addPlayer: playersAdapter.addOne,
        updatePlayer: playersAdapter.updateOne,
        removePlayer: playersAdapter.removeOne,
        setError: (state, action) => {
            state.status = 'failed';
            state.error = action.payload;
            state.isListening = false;
        },
        setListenerInactive: (state) => {
            state.isListening = false;
            state.status = 'idle';
        }
    },
    extraReducers: (builder) => {
        builder
            .addCase(subscribeToPlayers.pending, (state) => {
                if (state.status === 'idle') {
                    state.status = 'loading';
                    state.isListening = true;
                }
                state.error = null;
            })
            .addCase(subscribeToPlayers.fulfilled, (state, action) => {
                if (state.status === 'loading') state.status = 'succeeded';
                console.log("Player subscription fulfilled:", action.payload);
            })
            .addCase(subscribeToPlayers.rejected, (state, action) => {
                state.status = 'failed';
                state.error = action.error.message || 'Failed to subscribe to players';
                state.isListening = false;
            });
    },
});

export const {
    setLoading,
    setPlayers,
    addPlayer,
    updatePlayer,
    removePlayer,
    setError,
    setListenerInactive
} = playersSlice.actions;

export const {
    selectAll: selectAllPlayers,
    selectById: selectPlayerById,
    selectIds: selectPlayerIds,
} = playersAdapter.getSelectors((state) => state.players);

export const selectPlayersStatus = (state) => state.players.status;
export const selectPlayersError = (state) => state.players.error;
export const selectIsPlayerListenerActive = (state) => state.players.isListening;


export default playersSlice.reducer;
