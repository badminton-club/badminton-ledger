import { configureStore } from '@reduxjs/toolkit';
import playersReducer   from './features/players/playersSlice';
import sessionModalReducer from './features/SessionModal/sessionModalSlice';
import clubReducer      from './features/club/clubSlice';

export const store = configureStore({
  reducer: {
    players:      playersReducer,
    sessionModal: sessionModalReducer,
    club:         clubReducer,
  },
  middleware: getDefault =>
    getDefault({ serializableCheck: false }),
});

export type RootState   = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
