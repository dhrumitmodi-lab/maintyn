import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { SocietyProvider } from "@/context/SocietyContext";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import Users from "@/pages/Users";
import Flats from "@/pages/Flats";
import Invoices from "@/pages/Invoices";
import Expenses from "@/pages/Expenses";
import Complaints from "@/pages/Complaints";
import Announcements from "@/pages/Announcements";
import Visitors from "@/pages/Visitors";
import Amenities from "@/pages/Amenities";
import Directory from "@/pages/Directory";
import MyFlat from "@/pages/MyFlat";
import InvoiceView from "@/pages/InvoiceView";
import MasterConsole from "@/pages/MasterConsole";
import Staff from "@/pages/Staff";
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

function MasterProtected({ children }) {
    const { user, loading } = useAuth();
    if (loading) return null;
    if (!user) return <Navigate to="/login" replace />;
    if (user.kind !== "master") return <Navigate to="/app" replace />;
    return children;
}

function App() {
    return (
        <AuthProvider>
            <SocietyProvider>
                <BrowserRouter>
                    <Toaster position="top-right" />
                    <Routes>
                        <Route path="/" element={<Landing />} />
                        <Route path="/login" element={<Login />} />
                        <Route path="/register" element={<Register />} />
                        <Route path="/forgot-password" element={<ForgotPassword />} />
                        <Route path="/reset-password" element={<ResetPassword />} />
                        <Route path="/master" element={<MasterProtected><MasterConsole /></MasterProtected>} />
                        <Route path="/app" element={<Protected><Layout /></Protected>}>
                            <Route index element={<Dashboard />} />
                            <Route path="users" element={<Protected roles={["admin", "committee"]}><Users /></Protected>} />
                            <Route path="directory" element={<Directory />} />
                            <Route path="flats" element={<Protected roles={["admin", "committee"]}><Flats /></Protected>} />
                            <Route path="my-flat" element={<MyFlat />} />
                            <Route path="invoices" element={<Invoices />} />
                            <Route path="invoices/:id" element={<InvoiceView />} />
                            <Route path="expenses" element={<Expenses />} />
                            <Route path="complaints" element={<Complaints />} />
                            <Route path="staff" element={<Staff />} />
                            <Route path="announcements" element={<Announcements />} />
                            <Route path="visitors" element={<Visitors />} />
                            <Route path="amenities" element={<Amenities />} />
                        </Route>
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </BrowserRouter>
            </SocietyProvider>
        </AuthProvider>
    );
}

export default App;
