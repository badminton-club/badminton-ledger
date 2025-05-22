import { configureStore } from '@reduxjs/toolkit';
import playersReducer from './features/players/playersSlice'; 


export const store = configureStore({
  reducer: {
    players: playersReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['players/subscribeToPlayers/fulfilled','players/setPlayers'], 
        ignoredPaths: ['players.entities'],
      },
    }),
});
