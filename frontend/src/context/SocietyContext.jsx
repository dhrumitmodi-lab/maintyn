import React, { createContext, useContext, useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const SocietyContext = createContext(null);

export function SocietyProvider({ children }) {
    const { user } = useAuth();
    const [society, setSociety] = useState(null);

    async function refresh() {
        try {
            const { data } = await api.get("/society");
            setSociety(data);
        } catch { /* ignore */ }
    }

    useEffect(() => {
        if (user) refresh();
        else setSociety(null);
    }, [user, refresh]);

    return (
        <SocietyContext.Provider value={{ society, refresh, setSociety }}>
            {children}
        </SocietyContext.Provider>
    );
}

export function useSociety() {
    return useContext(SocietyContext) || { society: null };
}
