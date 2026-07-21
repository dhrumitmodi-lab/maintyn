import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, StatCard, Chip } from "@/components/Shared";
import { Buildings, Receipt, ChatCircleDots, IdentificationBadge, TrendUp, TrendDown, Users as UsersIcon } from "@phosphor-icons/react";
import { Link } from "react-router-dom";

const inr = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);

export default function Dashboard() {
    const { user } = useAuth();
    const [stats, setStats] = useState(null);
    const [announcements, setAnnouncements] = useState([]);
    const [complaints, setComplaints] = useState([]);
    const [invoices, setInvoices] = useState([]);

    useEffect(() => {
        (async () => {
            try {
                const [s, a, c, i] = await Promise.all([
                    api.get("/stats"),
                    api.get("/announcements"),
                    api.get("/complaints"),
                    api.get("/invoices"),
                ]);
                setStats(s.data);
                setAnnouncements(a.data.slice(0, 3));
                setComplaints(c.data.slice(0, 5));
                setInvoices(i.data.slice(0, 5));
            } catch (e) { /* ignore */ }
        })();
    }, []);

    const isStaff = user?.role === "admin" || user?.role === "committee";

    return (
        <div className="animate-fade-up">
            <PageHeader
                overline={`${user?.role} dashboard`}
                title="Overview"
                description="A snapshot of your community — invoices, expenses, complaints and residents."
            />

            {isStaff ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <StatCard label="Total Flats" value={stats?.total_flats ?? "—"} hint={`${stats?.total_residents ?? 0} residents`} />
                    <StatCard label="Collected" value={inr(stats?.total_collected)} hint={`${stats?.invoices_paid ?? 0} invoices paid`} />
                    <StatCard label="Pending" value={inr(stats?.total_pending)} hint={`${stats?.invoices_unpaid ?? 0} unpaid`} accent />
                    <StatCard label="Expenses" value={inr(stats?.total_expenses)} hint="Total logged" />
                    <StatCard label="Open Complaints" value={stats?.complaints_open ?? "—"} hint={`${stats?.complaints_inprogress ?? 0} in progress`} />
                    <StatCard label="Resolved" value={stats?.complaints_resolved ?? "—"} hint="All time" />
                    <StatCard label="Active Visitors" value={stats?.active_visitors ?? "—"} hint="On premises" />
                    <StatCard label="Notices" value={stats?.announcements_count ?? "—"} hint="Published" />
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <StatCard label="My unpaid invoices" value={stats?.my_unpaid_count ?? "—"} accent />
                    <StatCard label="Amount pending" value={inr(stats?.my_pending_amount)} />
                    <StatCard label="Open complaints" value={complaints.filter(c => c.status !== "resolved").length} />
                </div>
            )}

            <div className="grid lg:grid-cols-3 gap-6 mt-8">
                <div className="lg:col-span-2 bg-white border border-brand-line rounded-sm p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft">Recent</p>
                            <h3 className="font-heading text-xl text-brand-ink mt-1">Invoices</h3>
                        </div>
                        <Link to="/app/invoices" className="text-xs uppercase tracking-overline text-brand-action hover:underline">View all →</Link>
                    </div>
                    <div className="mt-4 divide-y divide-brand-line">
                        {invoices.length === 0 && <p className="py-6 text-sm text-brand-inkSoft">No invoices yet.</p>}
                        {invoices.map((inv) => (
                            <div key={inv.id} className="py-3 flex items-center justify-between">
                                <div>
                                    <p className="font-medium text-brand-ink">{inv.description}</p>
                                    <p className="text-xs text-brand-inkSoft mt-0.5">
                                        {inv.flat ? `${inv.flat.block}-${inv.flat.number}` : "—"} · {inv.month}
                                    </p>
                                </div>
                                <div className="text-right">
                                    <p className="font-heading text-brand-ink">{inr(inv.amount)}</p>
                                    <Chip variant={inv.status === "paid" ? "success" : "warn"}>{inv.status}</Chip>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="bg-white border border-brand-line rounded-sm p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft">Board</p>
                            <h3 className="font-heading text-xl text-brand-ink mt-1">Notices</h3>
                        </div>
                        <Link to="/app/announcements" className="text-xs uppercase tracking-overline text-brand-action hover:underline">All →</Link>
                    </div>
                    <div className="mt-4 space-y-4">
                        {announcements.length === 0 && <p className="text-sm text-brand-inkSoft">No notices yet.</p>}
                        {announcements.map((a) => (
                            <div key={a.id} className="border-l-2 border-brand-action pl-3">
                                <p className="font-medium text-brand-ink">{a.title}</p>
                                <p className="text-xs text-brand-inkSoft mt-1 line-clamp-2">{a.content}</p>
                                <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft mt-2">{new Date(a.created_at).toLocaleDateString()}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
