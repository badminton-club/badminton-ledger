import {
  getFirestore, collection, query, where, getDocs, Timestamp, doc, getDoc, updateDoc,orderBy,
  addDoc,
  serverTimestamp,
  writeBatch 
} from 'firebase/firestore';

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
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_
};

let app
let db
let analytics
try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  analytics = getAnalytics(app);
  console.log("Firebase Initialized Successfully with Project ID:", firebaseConfig.projectId);
} catch (error) {
  console.error("Firebase initialization failed:", error);
  db = null;
  analytics = null;
}


const sessionsRef = db ? collection(db, "sessions") : null;
const usersRef = db ? collection(db, "users") : null;
const birdieInventoryRef = db ? collection(db, "birdieInventory") : null;
const courtCreditsRef = db ? collection(db, "courtCredits") : null;
const inventoryAdjustmentsRef = db ? collection(db, "inventoryAdjustments") : null;


/**
 * adds a new birdie batch document to Firestore.
 * @param {object} batchData - The data for the new birdie batch.
 * 
 * @returns {Promise<string>} A promise resolving to the ID of the newly created document.
 */
export const addBirdieBatchToFirestore = async (batchData) => {
  if (!db || !birdieInventoryRef) {
    console.error("Firestore database instance (db) or birdieInventoryRef is not available.");
    throw new Error("Database not initialized. Cannot add birdie batch.");
  }

  console.log("Service: Attempting to add new birdie batch:", batchData);

  try {
    const finalBatchData = {
      ...batchData, 
      purchaseDate: Timestamp.fromDate(new Date(batchData.purchaseDate)), 
      createdAt: serverTimestamp()
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
    'name', 'purchaseDate', 'purchaserName', 'costPerTube',
    'tubesPurchased', 'birdsPerTube', 'unopenedTubesRemaining', 'birdsInOpenTube'
  ];

  for (const field of fieldsToCompare) {
    let originalValue = originalBatchData[field];
    let newValue = dataToUpdateInInventory[field]; 
    if (field === 'purchaseDate') {
      const originalDate = originalBatchData.purchaseDate instanceof Date ? originalBatchData.purchaseDate.toISOString() : originalBatchData.purchaseDate;
      const newDateVal = dataToUpdateInInventory.purchaseDate instanceof Timestamp ? dataToUpdateInInventory.purchaseDate.toDate().toISOString() : new Date(dataToUpdateInInventory.purchaseDate).toISOString();

      if (originalDate !== newDateVal) {
        changes.push({
          fieldName: field,
          oldValue: originalDate, 
          newValue: newDateVal    
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
    changes: changes
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
 * Fetches all inventory adjustment logs for a specific birdie batch.
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
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error("Error fetching inventory adjustments:", error);
    throw error;
  }
};

/**
* Fetches all sessions where a specific birdie batch was used.
* Note: This requires querying the 'sessions' collection and checking inside an array,
* which is not ideal for performance if done frequently across many sessions.
* For high-performance history, a dedicated 'resourceUsageLog' collection is better.
* This function provides a basic implementation.
* @param {string} batchId - The ID of the birdie batch.
* @returns {Promise<Array<object>>} A promise resolving to an array of usage details.
*/
export const fetchSessionUsageForBirdieBatch = async (batchId) => {
  if (!sessionsRef) {
    console.error("Firestore (sessionsRef) is not initialized.");
    return [];
  }
  if (!batchId) return [];

  const q = query(sessionsRef, orderBy("date", "desc"));
  try {
    const querySnapshot = await getDocs(q);
    const usageDetails = [];
    querySnapshot.forEach(doc => {
      const sessionData = doc.data();
      if (Array.isArray(sessionData.birdieUsage)) {
        sessionData.birdieUsage.forEach(usage => {
          if (usage.batchId === batchId && usage.quantityUsed > 0) {
            usageDetails.push({
              sessionId: doc.id,
              sessionDate: sessionData.date, 
              quantityUsed: usage.quantityUsed
            });
          }
        });
      }
    });
    return usageDetails;
  } catch (error) {
    console.error("Error fetching session usage for birdie batch:", error);
    throw error;
  }
};
export { db }