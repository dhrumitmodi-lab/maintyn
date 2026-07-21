import React, { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import {
    House, Users as UsersIcon, Buildings, Receipt, CurrencyInr,
    ChatCircleDots, Megaphone, IdentificationBadge, SignOut, List
} from "@phosphor-icons/react";
import Logo from "@/components/Logo";
import { Button } from "@/components/ui/button";

const NAV = [
    { to: "/app", label: "Overview", icon: House, roles: ["admin", "committee", "resident"], end: true, testId: "nav-overview" },
    { to: "/app/flats", label: "Flats", icon: Buildings, roles: ["admin", "committee", "resident"], testId: "nav-flats" },
    { to: "/app/users", label: "Residents", icon: UsersIcon, roles: ["admin", "committee"], testId: "nav-users" },
    { to: "/app/invoices", label: "Invoices", icon: Receipt, roles: ["admin", "committee", "resident"], testId: "nav-invoices" },
    { to: "/app/expenses", label: "Expenses", icon: CurrencyInr, roles: ["admin", "committee", "resident"], testId: "nav-expenses" },
    { to: "/app/complaints", label: "Complaints", icon: ChatCircleDots, roles: ["admin", "committee", "resident"], testId: "nav-complaints" },
    { to: "/app/announcements", label: "Notices", icon: Megaphone, roles: ["admin", "committee", "resident"], testId: "nav-announcements" },
    { to: "/app/visitors", label: "Visitors", icon: IdentificationBadge, roles: ["admin", "committee", "resident"], testId: "nav-visitors" },
];

export default function Layout() {
    const { user, logout } = useAuth();
    const nav = useNavigate();
    const [mobileOpen, setMobileOpen] = useState(false);
    const items = NAV.filter((n) => n.roles.includes(user?.role));

    return (
        <div className="min-h-screen flex bg-brand-bg">
            {/* Sidebar */}
            <aside
                data-testid="app-sidebar"
                className={`${mobileOpen ? "block" : "hidden"} lg:block fixed lg:static inset-y-0 left-0 z-40 w-64 bg-[#13241D] text-[#E2DFD8] flex flex-col`}
            >
                <div className="px-6 py-6 border-b border-white/5">
                    <div className="flex items-center gap-2">
                        <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
                            <rect x="2" y="10" width="28" height="20" rx="1" fill="#F6F4F1" />
                            <path d="M2 10 L16 2 L30 10" stroke="#F6F4F1" strokeWidth="2" strokeLinejoin="round" fill="none" />
                            <rect x="7" y="16" width="4" height="6" fill="#C85A3C" />
                            <rect x="14" y="16" width="4" height="6" fill="#DDECE5" />
                            <rect x="21" y="16" width="4" height="6" fill="#DDECE5" />
                        </svg>
                        <span className="font-heading font-bold text-xl tracking-tight text-white">maintyn</span>
                    </div>
                    <p className="mt-2 text-[10px] uppercase tracking-overline text-[#8FA69A]">Community OS</p>
                </div>

                <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
                    {items.map((it) => {
                        const Icon = it.icon;
                        return (
                            <NavLink
                                key={it.to}
                                to={it.to}
                                end={it.end}
                                data-testid={it.testId}
                                onClick={() => setMobileOpen(false)}
                                className={({ isActive }) =>
                                    `flex items-center gap-3 px-4 py-2.5 rounded-sm text-sm font-medium transition-colors duration-150 ${
                                        isActive
                                            ? "bg-[#1B3127] text-white border-l-4 border-[#C85A3C] pl-3"
                                            : "text-[#B7C7BE] hover:bg-[#1B3127]/60 hover:text-white"
                                    }`
                                }
                            >
                                <Icon size={18} weight="duotone" />
                                <span>{it.label}</span>
                            </NavLink>
                        );
                    })}
                </nav>

                <div className="p-4 border-t border-white/5">
                    <div className="text-xs text-[#8FA69A]">Signed in as</div>
                    <div className="text-sm font-medium text-white truncate" data-testid="sidebar-user-name">{user?.name}</div>
                    <div className="text-[10px] uppercase tracking-overline text-[#C85A3C] mt-1">{user?.role}</div>
                    <button
                        data-testid="sidebar-logout"
                        onClick={async () => { await logout(); nav("/login"); }}
                        className="mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-full bg-white/5 hover:bg-[#C85A3C] hover:text-white text-sm text-[#E2DFD8] transition-colors duration-200"
                    >
                        <SignOut size={16} />
                        Sign out
                    </button>
                </div>
            </aside>

            {/* Main */}
            <div className="flex-1 flex flex-col min-w-0">
                <header className="h-16 bg-white border-b border-brand-line flex items-center justify-between px-4 lg:px-8">
                    <div className="flex items-center gap-3">
                        <button
                            className="lg:hidden p-2 rounded-sm border border-brand-line"
                            onClick={() => setMobileOpen(!mobileOpen)}
                            data-testid="mobile-menu-toggle"
                        >
                            <List size={18} />
                        </button>
                        <div className="lg:hidden"><Logo /></div>
                        <div className="hidden lg:block">
                            <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft">Society</p>
                            <p className="font-heading font-semibold text-brand-ink">Welcome back, {user?.name?.split(" ")[0]}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="hidden md:inline text-xs uppercase tracking-overline text-brand-inkSoft">
                            {new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                        </span>
                    </div>
                </header>

                <main className="flex-1 p-4 lg:p-8 overflow-y-auto">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}
