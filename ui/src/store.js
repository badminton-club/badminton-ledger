import { configureStore } from "@reduxjs/toolkit";
import playersReducer from "./features/players/playersSlice";
import sessionModalReducer from "./features/SessionModal/sessionModalSlice";

export const store = configureStore({
    reducer: {
        players: playersReducer,
        sessionModal: sessionModalReducer,
    },
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
            serializableCheck: false,
            // ignoredActions: ["players/subscribeToPlayers/fulfilled", "players/setPlayers", "sessionModal"],
            // ignoredPaths: ["players.entities"],
        }),
});
