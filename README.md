# badminton-ledger

This repository contains two main parts:

- `ui/` — React frontend (Create React App)
<!-- - `ledger/` — Spring Boot backend (Maven) -->

**Prerequisites**

- Node.js (16+ recommended) and `npm` or `yarn` for the UI
<!-- - Java JDK 21 (project `ledger` uses Java 21) -->
- Git (optional)

**Environment / Firebase**

The frontend expects Firebase configuration to be provided through environment variables. Create a file named `.env` in the `ui/` folder with the following variables (replace values with your Firebase project's values):

```
REACT_APP_FIREBASE_API_KEY=your_api_key
REACT_APP_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID=your_project_id
REACT_APP_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
REACT_APP_FIREBASE_APP_ID=your_app_id
REACT_APP_FIREBASE_MEASUREMENT_ID=your_measurement_id
```

There is a `firebaseSchema.ts` in the repo that documents expected Firestore collections and document shapes.

**Start the UI (development)**

Open a terminal (PowerShell recommended on Windows) and run:

```powershell
cd ui
npm install
npm start
```

This runs the React dev server at `http://localhost:3000` by default. The UI reads Firebase config from the `.env` file above (through `ui/src/services/firebaseService.js`).

**Build the UI (production)**

```powershell
cd ui
npm run build
```

The production build will be written to `ui/build`.

<!-- **Start the Server (development)**

The backend is a Spring Boot application located in `ledger/`. A Maven wrapper is included so you can run Maven without installing it globally.

To run the server in development mode (using the wrapper) from PowerShell:

```powershell
cd ledger
.\mvnw.cmd spring-boot:run
```

By default Spring Boot listens on port `8080`.

**Build the Server (jar) and Run**

```powershell
cd ledger
.\mvnw.cmd clean package -DskipTests
java -jar target\ledger-0.0.1-SNAPSHOT.jar
```

If you are running on Windows and the jar name differs (for example after repackaging), check `target/` for the exact jar filename and use that.

**Running UI and Server Together**

1. Start the backend first (so API is available):

```powershell
cd ledger
.\mvnw.cmd spring-boot:run
```

2. In another terminal, start the frontend:

```powershell
cd ui
npm start
```

If you need to change ports, update the Spring Boot configuration (e.g., `ledger/src/main/resources/application.properties`) or start the React app on a different port (e.g., `SET PORT=3001; npm start` in PowerShell). -->

**Troubleshooting**

- If Firebase doesn't initialize, verify your `.env` variables and that you restarted the dev server after creating `.env`.
<!-- - If Maven fails due to Java version, ensure your `JAVA_HOME` points to JDK 21 or a compatible JDK. -->
- If ports are in use, change the port for Spring Boot (`server.port`) or React (set `PORT` env var) and restart the services.

**Useful files**

- `ui/src/services/firebaseService.js` — shows how the frontend reads Firebase env vars.
- `firebaseSchema.ts` — documents Firestore document shapes the app expects.
<!-- - `ledger/pom.xml` — Maven configuration (Java 21). -->

