import {
    getFirestore,
    collection,
    query,
    where,
    getDocs,
    Timestamp,
    doc,
    getDoc,
    updateDoc,
    orderBy,
    addDoc,
    serverTimestamp,
    writeBatch,
    runTransaction,
    limit,
    FieldValue,
} from "firebase/firestore";

import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use

const firebaseConfig = {
    apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
    authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
    storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.REACT_APP_FIREBASE_APP_ID,
    measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID,
};

let app;
let db;
let analytics;
try {
    console.log("Firebase Config Being Used:", JSON.stringify(firebaseConfig, null, 2));
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    analytics = getAnalytics(app);
    console.log("Firebase Initialized Successfully with Project ID:", firebaseConfig.projectId);

    console.log("Initialized Firebase App Instance:", app);
    console.log("Initialized Firestore DB Instance:", db);
    if (app) {
        console.log("Firebase App Name:", app.name); // Should be '[DEFAULT]' or your app name
    }
    if (db) {
        console.log("Firestore DB App associated:", db.app.name);
    }
} catch (error) {
    console.error("Firebase initialization failed:", error);
    db = null;
    analytics = null;
}

const sessionsRef = db ? collection(db, "sessions") : null;
const playersRef = db ? collection(db, "players") : null;
const birdieInventoryRef = db ? collection(db, "birdieInventory") : null;
const courtCreditsRef = db ? collection(db, "courtCredits") : null;
const inventoryAdjustmentsRef = db ? collection(db, "inventoryAdjustments") : null;
const transcationsRef = db ? collection(db, "transactions") : null;

/**
 *
 *
 *
 */
export const fetchBirdieInventory = async () => {
    if (!db || !birdieInventoryRef) {
        console.error("Firestore (birdieInventoryRef) is not initialized.");
        return [];
    }

    try {
        const q = query(birdieInventoryRef, orderBy("purchaseDate", "asc"));
        const querySnapshot = await getDocs(q);
        const batches = querySnapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
            purchaseDate: doc.data().purchaseDate?.toDate
                ? doc.data().purchaseDate.toDate()
                : new Date(doc.data().purchaseDate),
        }));
        return batches;
    } catch (error) {
        console.error("Error fetching birdie inventory:", error);
        throw error;
    }
};

/**
 * adds a new birdie batch document to Firestore.
 * @param {object} batchData - The data for the new birdie batch.
 *
 * @returns {Promise<string>} A promise resolving to the ID of the newly created document.
 */
export const addBirdieBatch = async (batchData) => {
    if (!db || !birdieInventoryRef) {
        console.error("Firestore database instance (db) or birdieInventoryRef is not available.");
        throw new Error("Database not initialized. Cannot add birdie batch.");
    }

    console.log("Service: Attempting to add new birdie batch:", batchData);

    try {
        const finalBatchData = {
            ...batchData,
            purchaseDate: Timestamp.fromDate(new Date(batchData.purchaseDate)),
            createdAt: serverTimestamp(),
        };

        const docRef = await addDoc(birdieInventoryRef, finalBatchData);

        console.log("Service: Successfully added birdie batch with ID:", docRef.id);
        return docRef.id;
    } catch (error) {
        console.error("Service: Error writing new birdie batch to Firestore:", error);
        throw new Error(error.message || "Database error: Could not save the new birdie batch.");
    }
};

/**
 * Fetches a single birdie batch document from Firestore by its ID.
 * @param {string} batchId - The ID of the birdie batch document to fetch.
 * @returns {Promise<object|null>} A promise resolving to the batch data object (with id)
 *
 */
export const fetchBirdieBatchById = async (batchId) => {
    if (!db || !birdieInventoryRef) {
        console.error("Firestore is not initialized. Cannot fetch birdie batch.");
        throw new Error("Database not initialized.");
    }
    if (!batchId) {
        console.error("fetchBirdieBatchById called with no batchId.");
        return null;
    }
    try {
        const batchDocRef = doc(db, "birdieInventory", batchId);
        const batchSnap = await getDoc(batchDocRef);

        if (batchSnap.exists()) {
            console.log("Service: Fetched birdie batch:", batchId);
            return { id: batchSnap.id, ...batchSnap.data() };
        } else {
            console.warn("Service: No birdie batch found with ID:", batchId);
            return null;
        }
    } catch (error) {
        console.error("Service: Error fetching birdie batch by ID:", error);
        throw new Error(error.message || "Database error: Could not fetch birdie batch.");
    }
};

/**
 * Updates a birdie batch document in Firestore and logs the changes
 * to the 'inventoryAdjustments' collection.
 * @param {string} batchId - The ID of the birdie batch to update.
 * @param {object} originalBatchData - The batch data *before* edits (fetched from DB).
 * @param {object} updatedFormData - The new data from the edit form.
 * @param {string} reason - The reason for the edit.
 * @param {string} userId - The ID of the user making the edit.
 * @param {string} userName - The name of the user making the edit.
 * @returns {Promise<void>}
 */
export const updateBirdieBatchAndLogAdjustments = async (
    batchId,
    originalBatchData,
    updatedFormData,
    reason,
    userId,
    userName
) => {
    if (!db || !birdieInventoryRef || !inventoryAdjustmentsRef) {
        console.error("Firestore is not initialized or collections are missing.");
        throw new Error("Database not initialized. Cannot update batch.");
    }
    if (!batchId || !originalBatchData || !updatedFormData || !reason || !userId || !userName) {
        console.error("Missing required parameters for updateBirdieBatchAndLogAdjustments");
        throw new Error("Invalid parameters for updating batch.");
    }

    const dataToUpdateInInventory = {
        ...updatedFormData,
        purchaseDate: Timestamp.fromDate(new Date(updatedFormData.purchaseDate)),
        lastModifiedAt: serverTimestamp(),
        lastModifiedBy: userId,
    };

    const changes = [];
    const fieldsToCompare = [
        "name",
        "purchaseDate",
        "purchaserName",
        "costPerTube",
        "tubesPurchased",
        "birdsPerTube",
        "unopenedTubesRemaining",
        "birdsInOpenTube",
    ];

    for (const field of fieldsToCompare) {
        let originalValue = originalBatchData[field];
        let newValue = dataToUpdateInInventory[field];
        if (field === "purchaseDate") {
            const originalDate =
                originalBatchData.purchaseDate instanceof Date
                    ? originalBatchData.purchaseDate.toISOString()
                    : originalBatchData.purchaseDate;
            const newDateVal =
                dataToUpdateInInventory.purchaseDate instanceof Timestamp
                    ? dataToUpdateInInventory.purchaseDate.toDate().toISOString()
                    : new Date(dataToUpdateInInventory.purchaseDate).toISOString();

            if (originalDate !== newDateVal) {
                changes.push({
                    fieldName: field,
                    oldValue: originalDate,
                    newValue: newDateVal,
                });
            }
        } else if (originalValue !== newValue) {
            changes.push({ fieldName: field, oldValue: originalValue, newValue: newValue });
        }
    }

    if (changes.length === 0) {
        console.log("Service: No actual changes detected for batch update. Skipping log and update.");
        return;
    }

    const adjustmentLogData = {
        adjustmentDate: serverTimestamp(),
        userId: userId,
        userName: userName,
        resourceType: "birdieBatch",
        batchId: batchId,
        batchNameSnapshot: originalBatchData.name,
        reason: reason,
        changes: changes,
    };

    try {
        const batch = writeBatch(db);

        const inventoryDocRef = doc(db, "birdieInventory", batchId);
        batch.update(inventoryDocRef, dataToUpdateInInventory);

        const adjustmentLogDocRef = doc(inventoryAdjustmentsRef);
        batch.set(adjustmentLogDocRef, adjustmentLogData);

        await batch.commit();
        console.log(`Service: Successfully updated batch ${batchId} and logged ${changes.length} adjustment(s).`);
    } catch (error) {
        console.error("Service: Error in batched write for update/log:", error);
        throw new Error(error.message || "Database error: Could not update batch and log adjustments.");
    }
};

/**
 * Fetches all inventory adjustment logs for specified birdie batch.
 * @param {string} batchId - The ID of the birdie batch.
 * @returns {Promise<Array<object>>} A promise resolving to an array of adjustment log objects.
 */
export const fetchInventoryAdjustmentsForBatch = async (batchId) => {
    if (!inventoryAdjustmentsRef) {
        console.error("Firestore (inventoryAdjustmentsRef) is not initialized.");
        return [];
    }
    if (!batchId) return [];

    const q = query(
        inventoryAdjustmentsRef,
        where("batchId", "==", batchId),
        where("resourceType", "==", "birdieBatch"),
        orderBy("adjustmentDate", "desc")
    );
    try {
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        console.error("Error fetching inventory adjustments:", error);
        throw error;
    }
};

/**
 * Fetches all sessions where birdie batch was used.
 * @param {string} batchId - The ID of the birdie batch.
 * @returns {Promise<Array<object>>} A promise resolving to an array of usage details.
 */
export const fetchSessionUsageForBirdieBatch = async (batchId) => {
    if (!transcationsRef) {
        console.error("Firestore (transcationsRef) is not initialized.");
        return [];
    }
    if (!batchId) return [];

    console.log("batchId ==> ", batchId);
    const q = query(
        transcationsRef,
        where("resourceType", "==", "birdie"),
        where("batchId", "==", batchId),
        orderBy("date", "desc")
    );
    try {
        const querySnapshot = await getDocs(q);
        const usageDetails = [];
        querySnapshot.forEach((doc) => {
            const transactionData = doc.data();
            usageDetails.push(transactionData);
        });
        return usageDetails;
    } catch (error) {
        console.error("Error fetching session usage for birdie batch:", error);
        throw error;
    }
};

export const fetchCourtCredits = async () => {
    if (!db || !courtCreditsRef) {
        console.error("Firestore (courtCreditsRef) is not initialized.");
        return [];
    }

    try {
        const q = query(courtCreditsRef, orderBy("purchaseDate", "asc"));
        const querySnapshot = await getDocs(q);
        const batches = querySnapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
            purchaseDate: doc.data().purchaseDate?.toDate
                ? doc.data().purchaseDate.toDate()
                : new Date(doc.data().purchaseDate),
        }));
        return batches;
    } catch (error) {
        console.error("Error fetching birdie inventory:", error);
        throw error;
    }
};

/**
 * Adds a new court credit batch document to the 'courtCredits' collection.
 * @param {object} batchData - Data from the form { name, purchaseDate, purchaserName, hoursPurchased, totalCost, remainingHours, notes }
 * @returns {Promise<string>} The ID of the new document.
 */
export const addCourtCredits = async (batchData) => {
    if (!db || !courtCreditsRef) {
        throw new Error("Database not initialized. Cannot add court credit batch.");
    }
    try {
        const finalBatchData = {
            ...batchData,
            purchaseDate: Timestamp.fromDate(new Date(batchData.purchaseDate)),
            remainingHours: parseFloat(batchData.hoursPurchased), // Initially remaining is same as purchased
            createdAt: serverTimestamp(),
        };
        const docRef = await addDoc(courtCreditsRef, finalBatchData);
        console.log("Service: Successfully added court credit batch with ID:", docRef.id);
        return docRef.id;
    } catch (error) {
        console.error("Service: Error writing new court credit batch:", error);
        throw new Error(error.message || "Database error: Could not save court credit batch.");
    }
};

/**
 * Fetches a single court credit batch by ID.
 * @param {string} batchId
 * @returns {Promise<object|null>}
 */
export const fetchCourtCreditBatchById = async (batchId) => {
    if (!db || !courtCreditsRef) {
        throw new Error("Database not initialized.");
    }
    if (!batchId) return null;
    try {
        const batchDocRef = doc(db, "courtCredits", batchId);
        const batchSnap = await getDoc(batchDocRef);
        if (batchSnap.exists()) {
            const data = batchSnap.data();
            return {
                id: batchSnap.id,
                ...data,
                purchaseDate: data.purchaseDate?.toDate ? data.purchaseDate.toDate() : new Date(data.purchaseDate),
            };
        }
        return null;
    } catch (error) {
        console.error("Service: Error fetching court credit batch by ID:", error);
        throw new Error(error.message || "Database error: Could not fetch court credit batch.");
    }
};

/**
 * Updates a court credit batch and logs adjustments.
 * @param {string} batchId
 * @param {object} originalBatchData (with JS Dates)
 * @param {object} updatedFormData (with JS Dates)
 * @param {string} reason
 * @param {string} userId
 * @param {string} userName
 * @returns {Promise<void>}
 */
export const updateCourtCreditBatchAndLogAdjustments = async (
    batchId,
    originalBatchData,
    updatedFormData,
    reason,
    userId,
    userName
) => {
    if (!db || !courtCreditsRef || !inventoryAdjustmentsRef) {
        throw new Error("Database not initialized.");
    }
    if (!batchId || !originalBatchData || !updatedFormData || !reason || !userId || !userName) {
        throw new Error("Invalid parameters for updating court credit batch.");
    }

    const dataToUpdateInInventory = {
        ...updatedFormData,
        purchaseDate: Timestamp.fromDate(new Date(updatedFormData.purchaseDate)),
        lastModifiedAt: serverTimestamp(),
        lastModifiedBy: userId,
        lastModifiedByName: userName,
    };

    const changes = [];
    const fieldsToCompare = ["purchaseDate", "purchaserName", "hoursPurchased", "totalCost", "remainingHours", "notes"];
    for (const field of fieldsToCompare) {
        let originalValueForComparison = originalBatchData[field];
        let newValueForComparison = updatedFormData[field];
        if (field === "purchaseDate") {
            originalValueForComparison =
                originalBatchData.purchaseDate instanceof Date
                    ? originalBatchData.purchaseDate.toISOString().split("T")[0]
                    : null;
            newValueForComparison =
                updatedFormData.purchaseDate instanceof Date
                    ? updatedFormData.purchaseDate.toISOString().split("T")[0]
                    : null;
        }
        if (String(originalValueForComparison ?? "") !== String(newValueForComparison ?? "")) {
            // Compare as strings after handling null/undefined
            changes.push({ fieldName: field, oldValue: originalBatchData[field], newValue: updatedFormData[field] });
        }
    }

    if (changes.length === 0) {
        console.log("Service: No actual changes for court credit batch. Updating lastModified fields only.");
        const inventoryDocRefOnlyModified = doc(db, "courtCredits", batchId);
        await updateDoc(inventoryDocRefOnlyModified, {
            lastModifiedAt: serverTimestamp(),
            lastModifiedBy: userId,
            lastModifiedByName: userName,
        });
        return;
    }

    const adjustmentLogData = {
        adjustmentDate: serverTimestamp(),
        userId,
        userName,
        resourceType: "courtCreditBatch",
        batchId,
        reason,
        changes,
    };
    try {
        const batchWrite = writeBatch(db);
        const inventoryDocRef = doc(db, "courtCredits", batchId);
        batchWrite.update(inventoryDocRef, dataToUpdateInInventory);
        const adjustmentLogDocRef = doc(inventoryAdjustmentsRef);
        console.log("adjustmentLogData ==> ", adjustmentLogData);
        batchWrite.set(adjustmentLogDocRef, adjustmentLogData);
        await batchWrite.commit();
    } catch (error) {
        console.error("Service: Error in batched write for court credit update/log:", error);
        throw new Error(error.message || "DB error.");
    }
};

/**
 * Fetches inventory adjustment logs for specified court credit batch.
 * @param {string} batchId
 * @returns {Promise<Array<object>>}
 */
export const fetchCourtCreditAdjustmentsForBatch = async (batchId) => {
    if (!inventoryAdjustmentsRef) {
        return [];
    }
    if (!batchId) return [];
    const q = query(
        inventoryAdjustmentsRef,
        where("batchId", "==", batchId),
        where("resourceType", "==", "courtCreditBatch"),
        orderBy("adjustmentDate", "desc")
    );
    try {
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        console.error("Error fetching court credit adjustments:", error);
        throw error;
    }
};

/**
 * Fetches all transctions where court credit batch was used.
 * @param {string} batchId - The ID of the court credit batch.
 * @returns {Promise<Array<object>>} A promise resolving to an array of usage details.
 */
export const fetchSessionUsageForCourtCredit = async (batchId) => {
    if (!transcationsRef) {
        console.error("Firestore (transcationsRef) is not initialized.");
        return [];
    }
    if (!batchId) return [];

    console.log("batchId ==> ", batchId);
    const q = query(
        transcationsRef,
        where("resourceType", "==", "courtCredit"),
        where("batchId", "==", batchId),
        orderBy("date", "desc")
    );
    try {
        const querySnapshot = await getDocs(q);
        console.log("querySnapshot ==> ", querySnapshot.docs);
        const usageDetails = [];
        querySnapshot.forEach((doc) => {
            const transactionData = doc.data();
            console.log("transactionData ==> ", transactionData);
            usageDetails.push(transactionData);
        });
        return usageDetails;
    } catch (error) {
        console.error("Error fetching session usage for birdie batch:", error);
        throw error;
    }
};

/**
 * Find user matches in Firestore based on a parsed name.
 * Assumes 'players' collection has 'firstNameLower' and 'lastNameLower' fields for case-insensitive search.
 * @param {string} parsedName - The name string to search for.
 * @returns {Promise<Array<object>>} A promise resolving to an array of matching user objects { id, firstName, lastName, ...otherData }.
 * Returns an empty array if no matches.
 */
export const findUserMatchesByName = async (parsedName) => {
    if (!playersRef) {
        console.error("Firestore (playersRef) is not initialized. Cannot find user matches.");
        throw new Error("Database not initialized.");
    }
    if (!parsedName || !parsedName.trim()) {
        return [];
    }

    const nameParts = parsedName
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter((part) => part.length > 0);
    let results = [];
    const uniqueResultIds = new Set();

    if (nameParts.length === 0) {
        return [];
    }

    if (nameParts.length >= 2) {
        const firstNameQueryPart = nameParts[0];
        const lastNameQueryPart = nameParts.slice(1).join(" ");

        const qFullName = query(
            playersRef,
            where("firstNameLower", "==", firstNameQueryPart),
            where("lastNameLower", "==", lastNameQueryPart)
        );
        try {
            const querySnapshot = await getDocs(qFullName);
            querySnapshot.forEach((doc) => {
                if (!uniqueResultIds.has(doc.id)) {
                    results.push({ id: doc.id, ...doc.data(), isSelected: false });
                    uniqueResultIds.add(doc.id);
                }
            });
        } catch (error) {
            console.error(`Error querying for full name "${parsedName}":`, error);
        }
    }

    if (results.length === 0 || nameParts.length === 1) {
        const qFirstNameOnly = query(playersRef, where("firstNameLower", "==", nameParts[0]));
        try {
            const querySnapshot = await getDocs(qFirstNameOnly);
            querySnapshot.forEach((doc) => {
                if (!uniqueResultIds.has(doc.id)) {
                    results.push({ id: doc.id, ...doc.data(), isSelected: false });
                    uniqueResultIds.add(doc.id);
                }
            });
        } catch (error) {
            console.error(`Error querying for first name "${nameParts[0]}":`, error);
        }
    }
    console.log(`Matches found for "${parsedName}":`, results.length);
    return results;
};

/**
 * Adds a new session document to Firestore and updates the birdie inventory, court credits, and player balances.
 * @param {
 *
 * } sessionData
 * @param {string|null} existingSessionId - If updating an existing session, provide its ID.
 */
export const addSessionAndUpdateInventory = async (sessionData, existingSessionId = null) => {
    console.log("sessionData ==> ", sessionData);
    if (!db) {
        console.error("Invalid Firestore db instance provided.");
        throw new Error("Invalid Firestore db instance provided.");
    }
    if (!sessionData || typeof sessionData !== "object") {
        console.error("Session data is required and must be an object.");
        throw new Error("Session data is required and must be an object.");
    }
    const isUpdate = !!existingSessionId;

    const sessionId = isUpdate ? existingSessionId : doc(sessionsRef).id;
    const newSessionRef = doc(sessionsRef, sessionId);
    try {
        await runTransaction(db, async (transaction) => {
            let originalSessionData = null;
            const birdieBatchDocs = new Map();
            const courtCreditDocs = new Map();
            const playerDocs = new Map();

            if (isUpdate) {
                const originalSessionSnap = await transaction.get(newSessionRef);
                if (!originalSessionSnap.exists()) {
                    throw new Error(`Session with ID ${existingSessionId} not found for update.`);
                }
                originalSessionData = originalSessionSnap.data();
                originalSessionData.id = originalSessionSnap.id; // Ensure ID is on the object

                // Collect items from original session
                (originalSessionData.birdieUsage || []).forEach((usage) =>
                    birdieBatchDocs.set(usage.id, doc(birdieInventoryRef, usage.id))
                );
                (originalSessionData.courtCreditsUsed || []).forEach((usage) =>
                    courtCreditDocs.set(usage.id, doc(courtCreditsRef, usage.id))
                );
                (originalSessionData.players || []).forEach((player) =>
                    playerDocs.set(player.id, doc(playersRef, player.id))
                );
            }

            // read all affected documents
            for (const birdieUsage of sessionData.birdieUsage) {
                if (birdieUsage.id) {
                    const birdieBatchRef = doc(birdieInventoryRef, birdieUsage.id);
                    const birdieBatchDoc = await transaction.get(birdieBatchRef);
                    birdieBatchDocs.set(birdieUsage.id, birdieBatchDoc);
                }
            }

            for (const courtUsage of sessionData.courtCreditUsage) {
                if (courtUsage.id) {
                    const courtCreditRef = doc(courtCreditsRef, courtUsage.id);
                    const courtCreditDoc = await transaction.get(courtCreditRef);
                    courtCreditDocs.set(courtUsage.id, courtCreditDoc);
                }
            }

            for (const player of sessionData.players) {
                if (player.id) {
                    const playerRef = doc(playersRef, player.id);
                    const playerDoc = await transaction.get(playerRef);
                    playerDocs.set(player.id, playerDoc);
                }
            }
            console.log("playerDocs ==> ", playerDocs);

            if (isUpdate && originalSessionData) {
                // 2.1 Revert Birdie Usage
                for (const usage of originalSessionData.birdieUsage || []) {
                    const birdieBatchDocSnap = birdieBatchDocs.get(usage.id);
                    if (birdieBatchDocSnap && birdieBatchDocSnap.exists()) {
                        const batchData = birdieBatchDocSnap.data();
                        const birdsPerTube = batchData.birdsPerTube || 12;
                        const originalQuantityUsed = usage.quantity || 0;

                        let currentUnopened = batchData.unopenedTubesRemaining || 0;
                        let currentOpen = batchData.birdsInOpenTube || 0;

                        let totalBirds = currentUnopened * birdsPerTube + currentOpen + originalQuantityUsed;

                        transaction.update(birdieBatchDocSnap.ref, {
                            unopenedTubesRemaining: Math.floor(totalBirds / birdsPerTube),
                            birdsInOpenTube: totalBirds % birdsPerTube,
                        });
                    } else {
                        console.warn(`Original birdie batch ${usage.id} not found during revert. Skipping.`);
                    }
                }
                // 2.2 Revert Court Credit Usage
                for (const usage of originalSessionData.courtCreditsUsed || []) {
                    const creditBatchDocSnap = courtCreditDocs.get(usage.id);
                    const batchData = creditBatchDocSnap.data();
                    const currentRemainingHours = batchData.remainingHours || 0;
                    const newRemainingHours = currentRemainingHours + (usage.hoursUsed || 0);
                    if (creditBatchDocSnap && creditBatchDocSnap.exists()) {
                        transaction.update(creditBatchDocSnap.ref, {
                            remainingHours: newRemainingHours
                        });
                    } else {
                        console.warn(`Original court credit batch ${usage.id} not found during revert. Skipping.`);
                    }
                }
                // 2.3 Revert Player Costs
                for (const player of originalSessionData.players || []) {
                console.log("playerasdfasdfsdf ==> ", player);
                    const playerDocSnap = playerDocs.get(player.id);
                    const batchData = playerDocSnap.data();
                    const currentBalance = batchData.balance || 0;
                    const newBalance = currentBalance + (player.cost || 0);
                    if (playerDocSnap && playerDocSnap.exists()) {
                        transaction.update(playerDocSnap.ref, {
                            balance: newBalance, // Add back cost
                        });
                    } else {
                        console.warn(`Original player ${player.userId} not found during revert. Skipping.`);
                    }
                }
            }

            //create new session document
            if (isUpdate) {
                originalSessionData.players.forEach((player) => {
                    const playerIndex = sessionData.players.findIndex((p) => p.id === player.id);
                    sessionData.players[playerIndex].paid = player.paid;
                    sessionData.players[playerIndex].highlighted = player.highlighted;
                });
                transaction.update(newSessionRef, { ...sessionData, updatedAt: serverTimestamp() }, { merge: true });
            } else {
                transaction.set(newSessionRef, { ...sessionData, id: sessionId, createdAt: serverTimestamp() });
            }
            //update birdied inventory
            for (const batchUsage of sessionData.birdieUsage) {
                if (!batchUsage.id || typeof batchUsage.quantity !== "number" || batchUsage.quantity <= 0) {
                    console.error("Invalid birdie batch data:", batchUsage);
                    throw new Error("Invalid birdie batch data.");
                }

                const birdieBatchDoc = birdieBatchDocs.get(batchUsage.id);
                if (!birdieBatchDoc.exists()) {
                    console.error(`Birdie batch with ID ${batchUsage.id} does not exist.`);
                    throw new Error(`Birdie batch with ID ${batchUsage.id} does not exist.`);
                }
                const batchData = birdieBatchDoc.data();
                let currentTotalBirds =
                    (batchData.unopenedTubesRemaining || 0) * batchData.birdsPerTube + (batchData.birdsInOpenTube || 0);

                if (currentTotalBirds < batchUsage.quantity) {
                    console.error(
                        `Insufficient birds in batch ${batchUsage.id}. Available: ${currentTotalBirds}, Requested: ${batchUsage.quantity}`
                    );
                    throw new Error(
                        `Insufficient birds in batch ${batchUsage.id}. Available: ${currentTotalBirds}, Requested: ${batchUsage.quantity}`
                    );
                }

                currentTotalBirds -= batchUsage.quantity;
                const newUnopenedTubesRemaining = Math.floor(currentTotalBirds / batchData.birdsPerTube);
                const newBirdsInOpenTube = currentTotalBirds % batchData.birdsPerTube;

                transaction.update(birdieBatchDoc.ref, {
                    unopenedTubesRemaining: newUnopenedTubesRemaining,
                    birdsInOpenTube: newBirdsInOpenTube,
                    // lastUpdated: FieldValue.serverTimestamp() // Optional
                });

                //log birdie usage transaction
                const birdieCostforBatch =
                    batchUsage.quantity * (batchData.costPerTube / (batchData.birdsPerTube || 1));
                if (isUpdate) {
                    const birdieUsageTransactionDoc = query(
                        transcationsRef,
                        where("resourceType", "==", "birdie"),
                        where("batchId", "==", batchUsage.id),
                        where("sessionId", "==", existingSessionId)
                    );
                    const querySnapshot = await getDocs(birdieUsageTransactionDoc);
                    const transactionDoc = querySnapshot.docs[0];
                    if (transactionDoc) {
                        transaction.update(transactionDoc.ref, {
                            quantityUsed: batchUsage.quantity,
                            cost: birdieCostforBatch,
                            updatedAt: serverTimestamp(),
                        });
                    }
                } else {
                    const transactionDocRef = doc(transcationsRef);

                    transaction.set(transactionDocRef, {
                        resourceType: "birdie",
                        batchId: batchUsage.id,
                        quantityUsed: batchUsage.quantity,
                        cost: birdieCostforBatch,
                        sessionId: sessionId, // Assuming sessionData has an id field
                        createdAt: serverTimestamp(),
                        date: sessionData.date ? Timestamp.fromDate(new Date(sessionData.date)) : serverTimestamp(),
                    });
                }
            }
            //update court credits usage
            for (const courtUsage of sessionData.courtCreditUsage) {
                if (!courtUsage.id || typeof courtUsage.hoursUsed !== "number" || courtUsage.hoursUsed <= 0) {
                    console.error("Invalid court credit data:", courtUsage);
                    throw new Error("Invalid court credit data.");
                }

                const courtCreditDoc = courtCreditDocs.get(courtUsage.id);
                if (!courtCreditDoc.exists()) {
                    console.error(`Court credit with ID ${courtUsage.id} does not exist.`);
                    throw new Error(`Court credit with ID ${courtUsage.id} does not exist.`);
                }
                const courtCreditData = courtCreditDoc.data();
                if (courtCreditData.remainingHours < courtUsage.hoursUsed) {
                    console.error(
                        `Insufficient hours in court credit ${courtUsage.id}. Available: ${courtCreditData.remainingHours}, Requested: ${courtUsage.hoursUsed}`
                    );
                    throw new Error(
                        `Insufficient hours in court credit ${courtUsage.id}. Available: ${courtCreditData.remainingHours}, Requested: ${courtUsage.hoursUsed}`
                    );
                }

                const newRemainingHours = courtCreditData.remainingHours - courtUsage.hoursUsed;
                transaction.update(courtCreditDoc.ref, { remainingHours: newRemainingHours });
                const courtCostforBatch = courtUsage.hoursUsed * (courtCreditData.costPerHour || 0);
                //log court credit transaction

                if (isUpdate) {
                    const courtCreditTransactionDoc = query(
                        transcationsRef,
                        where("resourceType", "==", "courtCredit"),
                        where("batchId", "==", courtUsage.id),
                        where("sessionId", "==", existingSessionId)
                    );
                    const querySnapshot = await getDocs(courtCreditTransactionDoc);
                    const transactionDoc = querySnapshot.docs[0];
                    if (transactionDoc) {
                        transaction.update(transactionDoc.ref, {
                            hoursUsed: courtUsage.hoursUsed,
                            cost: courtCostforBatch,
                            updatedAt: serverTimestamp(),
                        });
                    }
                }

                const transactionDocRef = doc(transcationsRef);
                transaction.set(transactionDocRef, {
                    resourceType: "courtCredit",
                    batchId: courtUsage.id,
                    hoursUsed: courtUsage.hoursUsed,
                    sessionId: sessionId,
                    createdAt: serverTimestamp(),
                    date: sessionData.date ? Timestamp.fromDate(new Date(sessionData.date)) : serverTimestamp(),
                    cost: courtCostforBatch,
                });
            }

            // update player balances
            for (const player of sessionData.players) {
                if (!player.id || typeof player.cost !== "number") {
                    console.error("Invalid player data:", player);
                    throw new Error("Invalid player data.");
                }

                const playerDoc = playerDocs.get(player.id);
                if (!playerDoc.exists()) {
                    console.error(`Player with ID ${player.id} does not exist.`);
                    throw new Error(`Player with ID ${player.id} does not exist.`);
                }
                const playerData = playerDoc.data();
                const currentBalance = playerData.balance || 0;
                if(isUpdate && originalSessionData) {
                    
                }
                const newBalance = currentBalance - player.cost;
                const newAttendedSessionIds = (playerData.attendedSessionIds || [])
                if(!isUpdate){
                    newAttendedSessionIds.concat(sessionId);
                }
                transaction.update(playerDoc.ref, { balance: newBalance, attendedSessionIds: newAttendedSessionIds });
            }
        });
    } catch (error) {
        console.error(
            `Client-side transaction failed for session ${
                sessionId || "(ID not yet generated)"
            }. Data: ${JSON.stringify(sessionData)}. Error:`,
            error
        );
        throw new Error(`Failed to save session: ${error.message || "An unknown error occurred."}`);
    }
};

/**
 * Fetches sessions from Firestore.
 * @param {object} [options] - Optional parameters for querying.
 * @param {Date} [options.startDate] - Filter sessions on or after this date.
 * @param {Date} [options.endDate] - Filter sessions before this date (exclusive).
 * @param {"asc" | "desc"} [options.orderDirection="desc"] - Direction of ordering.
 * @param {number} [options.limitCount] - Limit the number of sessions fetched.
 * @returns {Promise<Array<object>>} A promise that resolves to an array of session objects.
 * @throws {Error} If fetching fails.
 */
export const fetchSessions = async (options = {}) => {
    if (!db) {
        console.error("Firestore is not initialized.");
        throw new Error("Firestore not initialized.");
    }

    const queryConstraints = [];

    if (options.startDate) {
        queryConstraints.push(where("date", ">=", options.startDate));
    }
    if (options.endDate) {
        queryConstraints.push(where("date", "<=", options.endDate));
    }
    queryConstraints.push(orderBy("date", options.orderDirection || "desc"));

    let q =
        options.limitCount && typeof options.limitCount === "number" && options.limitCount > 0
            ? query(sessionsRef, ...queryConstraints, limit(options.limitCount))
            : query(sessionsRef, ...queryConstraints);

    try {
        const querySnapshot = await getDocs(q);
        const sessions = querySnapshot.docs.map((docSnap) => {
            const data = docSnap.data();
            return {
                id: docSnap.id,
                ...data,
                date: data.date && data.date.toDate ? data.date.toDate() : data.date ? new Date(data.date) : null,
            };
        });
        return sessions;
    } catch (error) {
        console.error("Error fetching sessions:", error);
        throw new Error(`Failed to fetch sessions: ${error.message}`);
    }
};

//give me a function to fetch a single session by ID
/**
 * Fetches a single session by its ID.
 *
 * @param {string} sessionId - The ID of the session to fetch.
 * @returns {Promise<object>} A promise that resolves to the session object.
 *
 *
 */
export const fetchSessionById = async (sessionId) => {
    if (!db || !sessionsRef) {
        console.error("Firestore is not initialized or sessionsRef is missing.");
        throw new Error("Database not initialized. Cannot fetch session.");
    }
    if (!sessionId) {
        console.error("Session ID is required to fetch a session.");
        throw new Error("Session ID is required.");
    }
    try {
        const sessionDocRef = doc(sessionsRef, sessionId);
        const sessionDocSnap = await getDoc(sessionDocRef);
        if (!sessionDocSnap.exists()) {
            console.error(`Session with ID ${sessionId} not found.`);
            throw new Error(`Session with ID ${sessionId} not found.`);
        }
        const sessionData = sessionDocSnap.data();
        return {
            id: sessionDocSnap.id,
            ...sessionData,
            date: sessionData.date && sessionData.date.toDate ? sessionData.date.toDate() : new Date(sessionData.date),
        };
    } catch (error) {
        console.error(`Error fetching session with ID ${sessionId}:`, error);
        throw new Error(`Failed to fetch session: ${error.message || "An unknown error occurred."}`);
    }
};
/**
 * toggles the payment status of a specific player within a session.
 *
 * @param {string} sessionId - The ID of the session to update.
 * @param {string} playerId - The `userId` of the player whose payment status is to be updated.
 * @returns {Promise<{message: string}>} A success message.
 * @throws {Error} If the operation fails or player/session not found.
 */
export async function togglePlayerPaidStatus(sessionId, playerId) {
    const sessionDocRef = doc(sessionsRef, sessionId);

    try {
        await runTransaction(db, async (transaction) => {
            const sessionDoc = await transaction.get(sessionDocRef);
            const playerDoc = await transaction.get(doc(playersRef, playerId));
            if (!sessionDoc.exists()) {
                throw new Error(`Session with ID ${sessionId} not found.`);
            }
            const sessionData = sessionDoc.data();
            const players = sessionData.players || [];
            let playerFound = false;
            let newPlayerPaidStatus = null;
            let playerCost = 0;
            const updatedPlayers = players.map((player) => {
                if (player.id === playerId) {
                    playerFound = true;
                    newPlayerPaidStatus = !player.paid;
                    playerCost = player.cost || 0;
                    return { ...player, paid: !player.paid };
                }
                return player;
            });
            if (!playerFound || newPlayerPaidStatus === null) {
                throw new Error(`Player with userId ${playerId} not found in session ${sessionId}.`);
            }
            transaction.update(sessionDocRef, { players: updatedPlayers });
            transaction.update(playerDoc.ref, {
                balance: FieldValue.increment(newPlayerPaidStatus ? playerCost : -playerCost),
            });
        });
        return { message: `Player payment status updated successfully.` };
    } catch (error) {
        console.error(`Failed to update payment status for player ${playerId} in session ${sessionId}:`, error);
        throw new Error(`Failed to update payment status: ${error.message || "An unknown error occurred."}`);
    }
}

/**
 * toggles the highlight status of a specific player within a session.
 *
 * @param {string} sessionId - The ID of the session to update.
 * @param {string} playerId - The `userId` of the player whose highlight status is to be updated.
 * @returns {Promise<{message: string}>} A success message.
 * @throws {Error} If the operation fails or player/session not found.
 */
export async function togglePlayerHighlightStatus(sessionId, playerId) {
    const sessionDocRef = doc(sessionsRef, sessionId);

    try {
        await runTransaction(db, async (transaction) => {
            const sessionDoc = await transaction.get(sessionDocRef);

            if (!sessionDoc.exists()) {
                throw new Error(`Session with ID ${sessionId} not found.`);
            }

            const sessionData = sessionDoc.data();
            const players = sessionData.players || [];
            let playerFound = false;

            const updatedPlayers = players.map((player) => {
                if (player.id === playerId) {
                    playerFound = true;
                    return {
                        ...player,
                        highlighted: !player.highlighted, // Toggle the current status
                    };
                }
                return player;
            });

            if (!playerFound) {
                throw new Error(`Player with userId ${playerId} not found in session ${sessionId}.`);
            }

            transaction.update(sessionDocRef, { players: updatedPlayers });
        });
        return { message: `Player highlight status toggled successfully.` };
    } catch (error) {
        console.error(`Failed to toggle highlight for player ${playerId} in session ${sessionId}:`, error);
        throw new Error(`Failed to toggle highlight status: ${error.message || "An unknown error occurred."}`);
    }
}
export { db };
