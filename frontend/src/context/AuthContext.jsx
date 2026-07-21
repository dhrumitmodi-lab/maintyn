import React, { createContext, useContext, useEffect, useState } from "react";
import api from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    async function refresh() {
        try {
            const { data } = await api.get("/auth/me");
            setUser(data);
        } catch {
            setUser(false);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        if (localStorage.getItem("maintyn_token")) {
            refresh();
        } else {
            setUser(false);
            setLoading(false);
        }
    }, []);

    async function login(email, password) {
        const { data } = await api.post("/auth/login", { email, password });
        if (data.access_token) localStorage.setItem("maintyn_token", data.access_token);
        await refresh();
        return data;
    }

    async function register(payload) {
        const { data } = await api.post("/auth/register", payload);
        if (data.access_token) localStorage.setItem("maintyn_token", data.access_token);
        await refresh();
        return data;
    }

    async function logout() {
        try { await api.post("/auth/logout"); } catch {}
        localStorage.removeItem("maintyn_token");
        setUser(false);
    }

    return (
        <AuthContext.Provider value={{ user, loading, login, register, logout, refresh, setUser }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
