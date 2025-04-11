interface user {
    name: string;
    id: string;
    highlighted: boolean;
    attendedSessionIds: string[];
    balance: number;
}

interface Session {
    id: string; // Firestore Document ID
    date: Date; // Start time of the session
    location?: string;
    durationHours: number;
    birdieUsage: BirdieUsage[]; // Array tracking usage from specific batches
    players: sessionPlayer[];
    courtCredits: string[]; // array of court credit ids
}

interface sessionPlayer {
    id: string;
    name: string;
    percentage: number;
    cost: number;
    paid: boolean;
    highlighted: boolean;
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
    birdsinOpenTube: number;
    paidBy: string;
}

interface courtCredits {
    id: string;
    name: string;
    location: string;
    totalCost: number;
    costPerHour:number;
    quantity: number; //number of hours
    date: Date; 
    remaining: number;
    paidBy: string;
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