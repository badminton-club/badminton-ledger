interface player {
    firstName: string;
    lastName?: string;
    id: string;
    attendedSessionIds: string[];
    balance: number;
    description: string;
    email?: string;
}

interface Session {
    id: string; // Firestore Document ID
    date: Date; // Start time of the session
    location?: string;
    durationHours: number;
    birdieUsage: BirdieUsage[]; // Array tracking usage from specific batches
    players: sessionPlayer[];
    courtCredits: courtCreditUsage[];
}

interface sessionPlayer {
    id: string;
    firstName: string;
    lastName?: string;
    percentage: number;
    cost: number;
    paid: boolean;
    highlighted: boolean;
}

interface courtCreditUsage {
    id: string;
    hoursUsed: number;
}

interface BirdieUsage {
    id: string; 
    quantity: number; 
}

interface birdieBatch {
    id: string;
    name: string;
    costPerTube: number;
    birdsPerTube: number;
    unopenedTubesRemaining: number;
    birdsInOpenTube: number;
    purchaserName: string;
    purchaseDate: Date; 
}   

interface courtCredits {
    id: string;
    name: string;
    location: string;
    totalCost: number;
    costPerHour:number;
    hours: number;
    purchaseDate: Date; 
    remainingHours: number;
    purchaserName: string;
}

interface transaction{
    id:string;
    sessionId:string;
    resourceType: "birdie"|'court'
    batchId:string;
    quantity:number;
    date: Date;
    isPreloaded: boolean
    payerId: string;
}

interface inventoryAdjustment{
    adjustmentDate: Date,
    userId: string,
    userName: string,
    resourceType: "birdieBatch"|"courtCredits",
    batchId: string,
    batchNameSnapshot: string,
    reason: string,
    changes: string
}