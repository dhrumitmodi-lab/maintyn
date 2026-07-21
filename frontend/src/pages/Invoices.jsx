import React, { useEffect, useState } from "react";
import api, { formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, EmptyState, Chip } from "@/components/Shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash, CheckCircle, Stack } from "@phosphor-icons/react";
import { toast } from "sonner";

const inr = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);

export default function Invoices() {
    const { user } = useAuth();
    const [invoices, setInvoices] = useState([]);
    const [flats, setFlats] = useState([]);
    const [open, setOpen] = useState(false);
    const [bulkOpen, setBulkOpen] = useState(false);
    const [filter, setFilter] = useState("all");
    const [form, setForm] = useState({ flat_id: "", amount: "", description: "", month: "", due_date: "" });
    const [bulkForm, setBulkForm] = useState({ amount: "", description: "", month: "", due_date: "" });

    async function load() {
        try {
            const [i, f] = await Promise.all([api.get("/invoices"), api.get("/flats")]);
            setInvoices(i.data);
            setFlats(f.data);
        } catch (e) { toast.error(formatError(e)); }
    }
    useEffect(() => { load(); }, []);

    const isStaff = user?.role === "admin" || user?.role === "committee";

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
        try { await api.post(`/invoices/${inv.id}/pay`, { method: "manual" }); toast.success("Marked paid"); load(); }
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
