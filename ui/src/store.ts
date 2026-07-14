import { configureStore } from '@reduxjs/toolkit';
import playersReducer   from './features/players/playersSlice';
import sessionModalReducer from './features/SessionModal/sessionModalSlice';

export const store = configureStore({
  reducer: {
    players:      playersReducer,
    sessionModal: sessionModalReducer,
  },
  middleware: getDefault =>
    getDefault({ serializableCheck: false }),
});

export type RootState   = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
