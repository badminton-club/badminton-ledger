import React, { useEffect, useState } from "react";
import { signInWithGoogle, signOutUser, onAuthStateChangedListener } from "../services/firebaseService";

const AuthPage = () => {
    const [user, setUser] = useState(null);
    useEffect(() => {
        const unsubscribe = onAuthStateChangedListener((currentUser) => {
            setUser(currentUser);;
        });
        return () => unsubscribe();
    }, []);

    const handleSignIn = async () => {
        try {
            await signInWithGoogle();
        } catch (error) {
            alert("Google sign-in failed: " + error.message);
        }
    };

    const handleSignOut = async () => {
        try {
            await signOutUser();
        } catch (error) {
            alert("Sign out failed: " + error.message);
        }
    };

    return (
        <div style={{ maxWidth: 400, margin: "40px auto", padding: 24, border: "1px solid #eee", borderRadius: 8, boxShadow: "0 2px 8px #eee" }}>
            <h2 style={{ paddingBottom: 15 }}>Sign In with Google</h2>
            {user ? (
                <div>
                    {/* <img src={user.photoURL} alt="Profile" style={{ width: 64, borderRadius: "50%" }} /> */}
                    <p>Welcome, {user.displayName}</p>
                    <p>Email: {user.email}</p>
                    <button onClick={handleSignOut} style={{ padding: "8px 16px", marginTop: 12 }}>Sign Out</button>
                </div>
            ) : (
                <button onClick={handleSignIn} style={{ padding: "8px 16px" }}>Sign In with Google</button>
            )}
        </div>
    );
};

export default AuthPage;
