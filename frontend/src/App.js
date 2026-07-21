import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import Users from "@/pages/Users";
import Flats from "@/pages/Flats";
import Invoices from "@/pages/Invoices";
import Expenses from "@/pages/Expenses";
import Complaints from "@/pages/Complaints";
import Announcements from "@/pages/Announcements";
import Visitors from "@/pages/Visitors";
import "@/App.css";

function Protected({ children, roles }) {
    const { user, loading } = useAuth();
    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-brand-bg">
                <div className="text-brand-inkSoft font-heading tracking-overline uppercase text-xs">
                    Loading maintyn...
                </div>
            </div>
        );
    }
    if (!user) return <Navigate to="/login" replace />;
    if (roles && !roles.includes(user.role)) return <Navigate to="/app" replace />;
    return children;
}

function App() {
    return (
        <AuthProvider>
            <BrowserRouter>
                <Toaster position="top-right" />
                <Routes>
                    <Route path="/" element={<Landing />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/app" element={<Protected><Layout /></Protected>}>
                        <Route index element={<Dashboard />} />
                        <Route path="users" element={<Protected roles={["admin", "committee"]}><Users /></Protected>} />
                        <Route path="flats" element={<Flats />} />
                        <Route path="invoices" element={<Invoices />} />
                        <Route path="expenses" element={<Expenses />} />
                        <Route path="complaints" element={<Complaints />} />
                        <Route path="announcements" element={<Announcements />} />
                        <Route path="visitors" element={<Visitors />} />
                    </Route>
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </BrowserRouter>
        </AuthProvider>
    );
}

export default App;
