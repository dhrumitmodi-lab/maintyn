import React, { useEffect, useState } from "react";
import api, { formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, EmptyState, Chip, StatCard } from "@/components/Shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash, CheckCircle, Stack, Eye, WarningOctagon, TrendUp } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

const inr = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);

export default function Invoices() {
    const { user } = useAuth();
    const nav = useNavigate();
    const [invoices, setInvoices] = useState([]);
    const [flats, setFlats] = useState([]);
    const [stats, setStats] = useState(null);
    const [open, setOpen] = useState(false);
    const [bulkOpen, setBulkOpen] = useState(false);
    const [filter, setFilter] = useState("all");
    const [form, setForm] = useState({ flat_id: "", amount: "", description: "", month: "", due_date: "" });
    const [bulkForm, setBulkForm] = useState({ amount: "", description: "", month: "", due_date: "" });

    const isStaff = user?.role === "admin" || user?.role === "committee";

    async function load() {
        try {
            const calls = [api.get("/invoices"), api.get("/flats")];
            if (isStaff) calls.push(api.get("/invoices/stats"));
            const results = await Promise.all(calls);
            setInvoices(results[0].data);
            setFlats(results[1].data);
            if (isStaff) setStats(results[2].data);
        } catch (e) { toast.error(formatError(e)); }
    }
    useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

    async function submit(e) {
        e.preventDefault();
        try {
            await api.post("/invoices", { ...form, amount: parseFloat(form.amount) });
            toast.success("Invoice created");
            setOpen(false);
            setForm({ flat_id: "", amount: "", description: "", month: "", due_date: "" });
            load();
        } catch (e) { toast.error(formatError(e)); }
    }
    async function submitBulk(e) {
        e.preventDefault();
        try {
            const { data } = await api.post("/invoices/bulk", { ...bulkForm, amount: parseFloat(bulkForm.amount) });
            toast.success(`${data.count} invoices raised`);
            setBulkOpen(false);
            setBulkForm({ amount: "", description: "", month: "", due_date: "" });
            load();
        } catch (e) { toast.error(formatError(e)); }
    }
    async function markPaid(inv) {
        try { await api.post(`/invoices/${inv.id}/pay`, { method: "manual" }); toast.success("Marked paid · receipt emailed"); load(); }
        catch (e) { toast.error(formatError(e)); }
    }
    async function remove(inv) {
        if (!confirm("Delete this invoice?")) return;
        try { await api.delete(`/invoices/${inv.id}`); toast.success("Deleted"); load(); }
        catch (e) { toast.error(formatError(e)); }
    }

    const filtered = invoices.filter(i => filter === "all" ? true : i.status === filter);

    return (
        <div className="animate-fade-up">
            <PageHeader
                overline="Billing"
                title="Invoices"
                description="Maintenance bills raised per flat. Track paid and pending in one place."
                actions={isStaff && (
                    <div className="flex gap-2">
                        <Button data-testid="bulk-invoice-btn" onClick={() => setBulkOpen(true)} variant="outline" className="rounded-full border-brand-ink text-brand-ink hover:bg-brand-ink hover:text-white">
                            <Stack size={16} className="mr-1.5" /> Raise for all flats
                        </Button>
                        <Button data-testid="add-invoice-btn" onClick={() => setOpen(true)} className="rounded-full bg-brand-action hover:bg-brand-actionHover text-white active:scale-[0.98]">
                            <Plus size={16} className="mr-1.5" /> New invoice
                        </Button>
                    </div>
                )}
            />

            {isStaff && stats && (
                <div data-testid="invoice-dashboard" className="mb-8 space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <StatCard label="Raised" value={inr(stats.raised.total)} hint={`${stats.raised.count} invoices`} />
                        <StatCard label="Received" value={inr(stats.received.total)} hint={`${stats.received.count} paid · ${stats.collection_pct}% collection`} accent />
                        <StatCard label="Pending" value={inr(stats.pending.total)} hint={`${stats.pending.count} unpaid`} />
                        <StatCard label="Defaulters" value={stats.defaulters.length} hint="flats >3 months overdue" />
                    </div>

                    {stats.trend?.length > 0 && (
                        <div className="bg-white border border-brand-line rounded-sm p-5">
                            <div className="flex items-center gap-2 mb-4">
                                <TrendUp size={16} className="text-brand-action" weight="duotone" />
                                <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft">Monthly trend · raised vs received</p>
                            </div>
                            <div className="flex items-end gap-2 h-32">
                                {stats.trend.map((t, i) => {
                                    const max = Math.max(...stats.trend.map(x => x.raised), 1);
                                    const rHeight = (t.raised / max) * 100;
                                    const pHeight = (t.received / max) * 100;
                                    return (
                                        <div key={i} className="flex-1 flex flex-col items-center gap-1" data-testid={`invoice-trend-${t.month}`}>
                                            <div className="w-full flex items-end gap-1 flex-1">
                                                <div className="flex-1 bg-brand-line rounded-t-sm relative group" style={{ height: `${rHeight}%` }}>
                                                    <span className="opacity-0 group-hover:opacity-100 absolute -top-5 left-0 text-[10px] text-brand-inkSoft whitespace-nowrap">{inr(t.raised)}</span>
                                                </div>
                                                <div className="flex-1 bg-brand-action rounded-t-sm relative group" style={{ height: `${pHeight}%` }}>
                                                    <span className="opacity-0 group-hover:opacity-100 absolute -top-5 left-0 text-[10px] text-brand-action whitespace-nowrap">{inr(t.received)}</span>
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-brand-inkSoft">{t.month}</p>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="flex gap-4 mt-3 text-[10px] uppercase tracking-overline text-brand-inkSoft">
                                <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-brand-line rounded-sm"></span> Raised</span>
                                <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-brand-action rounded-sm"></span> Received</span>
                            </div>
                        </div>
                    )}

                    {stats.defaulters.length > 0 && (
                        <div className="bg-white border border-brand-line rounded-sm p-5" data-testid="invoice-defaulters">
                            <div className="flex items-center gap-2 mb-4">
                                <WarningOctagon size={18} className="text-brand-action" weight="duotone" />
                                <h3 className="font-heading text-lg text-brand-ink tracking-tight">Defaulters ({stats.defaulters.length})</h3>
                                <span className="text-xs text-brand-inkSoft">flats with unpaid invoices &gt; 3 months old</span>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-brand-bg border-b border-brand-line text-left">
                                            {["Flat", "Residents", "Unpaid", "Months pending", "Total due"].map(h => (
                                                <th key={h} className="py-2 px-3 font-medium text-brand-inkSoft text-[10px] uppercase tracking-overline">{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {stats.defaulters.map(d => (
                                            <tr key={d.flat_id} data-testid={`defaulter-${d.flat_id}`} className="border-b border-brand-line/60">
                                                <td className="py-2 px-3 font-medium text-brand-ink">{d.flat_label}</td>
                                                <td className="py-2 px-3 text-brand-inkSoft">
                                                    {d.residents.length === 0 ? <span className="italic">— no resident linked</span> :
                                                        d.residents.map(r => r.name).join(", ")}
                                                </td>
                                                <td className="py-2 px-3 text-brand-inkSoft">{d.unpaid_count}</td>
                                                <td className="py-2 px-3"><Chip variant="danger">{d.months_pending}mo</Chip></td>
                                                <td className="py-2 px-3 font-heading text-brand-ink">{inr(d.amount)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="flex gap-2 mb-4">
                {["all", "unpaid", "paid"].map(f => (
                    <button key={f} data-testid={`filter-${f}`} onClick={() => setFilter(f)}
                        className={`px-4 py-1.5 rounded-full text-xs uppercase tracking-overline font-medium transition-colors ${filter === f ? "bg-brand-ink text-white" : "bg-white border border-brand-line text-brand-inkSoft hover:bg-brand-sage"}`}>
                        {f}
                    </button>
                ))}
            </div>

            {filtered.length === 0 ? (
                <EmptyState title="No invoices" description={isStaff ? "Raise your first maintenance bill." : "You have no invoices yet."}
                    image="https://images.unsplash.com/photo-1625585598750-3535fe40efb3?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTJ8MHwxfHNlYXJjaHwxfHxtaW5pbWFsaXN0JTIwZW1wdHklMjByb29tJTIwc3VubGlnaHR8ZW58MHx8fHwxNzg0NjIzMzM0fDA&ixlib=rb-4.1.0&q=85" />
            ) : (
                <div className="bg-white border border-brand-line rounded-sm overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-brand-bg border-b border-brand-line text-left">
                                {["Flat", "Description", "Month", "Amount", "Due", "Status", ""].map(h => (
                                    <th key={h} className="py-3 px-4 font-medium text-brand-inkSoft text-[10px] uppercase tracking-overline">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((inv) => (
                                <tr key={inv.id} className="border-b border-brand-line/60 hover:bg-brand-bg/50">
                                    <td className="py-3 px-4 font-medium text-brand-ink">{inv.flat ? `${inv.flat.block}-${inv.flat.number}` : "—"}</td>
                                    <td className="py-3 px-4 text-brand-inkSoft">{inv.description}</td>
                                    <td className="py-3 px-4 text-brand-inkSoft">{inv.month}</td>
                                    <td className="py-3 px-4 font-heading text-brand-ink">{inr(inv.amount)}</td>
                                    <td className="py-3 px-4 text-brand-inkSoft">{inv.due_date}</td>
                                    <td className="py-3 px-4"><Chip variant={inv.status === "paid" ? "success" : "warn"}>{inv.status}</Chip></td>
                                    <td className="py-3 px-4 text-right">
                                        <button data-testid={`view-invoice-${inv.id}`} onClick={() => nav(`/app/invoices/${inv.id}`)}
                                            className="text-brand-ink hover:text-brand-action text-xs font-medium inline-flex items-center gap-1 mr-3">
                                            <Eye size={13} /> View
                                        </button>
                                        {inv.status !== "paid" && (
                                            <button data-testid={`pay-invoice-${inv.id}`} onClick={() => markPaid(inv)} className="text-brand-action hover:underline text-xs font-medium">Mark paid</button>
                                        )}
                                        {isStaff && (
                                            <button data-testid={`delete-invoice-${inv.id}`} onClick={() => remove(inv)} className="ml-3 p-1.5 hover:bg-[#F5D6CE] rounded-sm text-brand-action inline-flex"><Trash size={14} /></button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Single */}
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="rounded-sm">
                    <DialogHeader><DialogTitle className="font-heading text-2xl tracking-tight">New invoice</DialogTitle></DialogHeader>
                    <form onSubmit={submit} className="space-y-4">
                        <div className="space-y-2"><Label>Flat</Label>
                            <Select value={form.flat_id} onValueChange={(v) => setForm({ ...form, flat_id: v })}>
                                <SelectTrigger data-testid="invoice-flat-select" className="rounded-sm border-brand-line"><SelectValue placeholder="Select flat" /></SelectTrigger>
                                <SelectContent>{flats.map(f => <SelectItem key={f.id} value={f.id}>{f.block}-{f.number}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2"><Label>Description</Label>
                            <Input data-testid="invoice-desc-input" required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Maintenance charge - Feb 2026" className="rounded-sm border-brand-line" />
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-2"><Label>Amount (₹)</Label>
                                <Input data-testid="invoice-amount-input" required type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="rounded-sm border-brand-line" />
                            </div>
                            <div className="space-y-2"><Label>Month</Label>
                                <Input required placeholder="2026-02" value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} className="rounded-sm border-brand-line" />
                            </div>
                            <div className="space-y-2"><Label>Due date</Label>
                                <Input required type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} className="rounded-sm border-brand-line" />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-full">Cancel</Button>
                            <Button type="submit" data-testid="invoice-submit-btn" className="rounded-full bg-brand-action hover:bg-brand-actionHover">Create</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Bulk */}
            <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
                <DialogContent className="rounded-sm">
                    <DialogHeader><DialogTitle className="font-heading text-2xl tracking-tight">Raise for all flats</DialogTitle></DialogHeader>
                    <p className="text-sm text-brand-inkSoft">This will create one invoice per flat with the same amount and description.</p>
                    <form onSubmit={submitBulk} className="space-y-4">
                        <div className="space-y-2"><Label>Description</Label>
                            <Input required value={bulkForm.description} onChange={(e) => setBulkForm({ ...bulkForm, description: e.target.value })} placeholder="Maintenance - Feb 2026" className="rounded-sm border-brand-line" />
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-2"><Label>Amount (₹)</Label>
                                <Input required type="number" step="0.01" value={bulkForm.amount} onChange={(e) => setBulkForm({ ...bulkForm, amount: e.target.value })} className="rounded-sm border-brand-line" />
                            </div>
                            <div className="space-y-2"><Label>Month</Label>
                                <Input required placeholder="2026-02" value={bulkForm.month} onChange={(e) => setBulkForm({ ...bulkForm, month: e.target.value })} className="rounded-sm border-brand-line" />
                            </div>
                            <div className="space-y-2"><Label>Due date</Label>
                                <Input required type="date" value={bulkForm.due_date} onChange={(e) => setBulkForm({ ...bulkForm, due_date: e.target.value })} className="rounded-sm border-brand-line" />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setBulkOpen(false)} className="rounded-full">Cancel</Button>
                            <Button type="submit" data-testid="bulk-invoice-submit" className="rounded-full bg-brand-action hover:bg-brand-actionHover">Raise for all</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
