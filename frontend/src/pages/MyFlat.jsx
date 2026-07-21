import React, { useEffect, useMemo, useState } from "react";
import api, { formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, EmptyState, Chip, StatCard } from "@/components/Shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Lightning, Fire, Drop, WifiHigh, Television, Question,
    Plus, PencilSimple, Trash, Receipt, CheckCircle
} from "@phosphor-icons/react";
import { toast } from "sonner";

const UTILITIES = [
    { key: "electricity", label: "Electricity", icon: Lightning, color: "#E5A73C" },
    { key: "piped_gas", label: "Piped Gas", icon: Fire, color: "#C85A3C" },
    { key: "water", label: "Water", icon: Drop, color: "#5AA0C8" },
    { key: "internet", label: "Internet", icon: WifiHigh, color: "#1B3127" },
    { key: "dth", label: "DTH / Cable", icon: Television, color: "#8B5CF6" },
    { key: "other", label: "Other", icon: Question, color: "#576B61" },
];
const UTIL_MAP = Object.fromEntries(UTILITIES.map((u) => [u.key, u]));
const inr = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);

export default function MyFlat() {
    const { user } = useAuth();
    const [data, setData] = useState(null);

    // Connection dialog
    const [connOpen, setConnOpen] = useState(false);
    const [editingConn, setEditingConn] = useState(null);
    const [connForm, setConnForm] = useState({ utility_type: "electricity", provider_name: "", customer_id: "", meter_number: "", notes: "" });

    // Bill dialog
    const [billOpen, setBillOpen] = useState(false);
    const [billForm, setBillForm] = useState({ utility_type: "electricity", connection_id: "", amount: "", bill_period: "", due_date: "", provider_name: "", customer_id: "", notes: "" });

    async function load() {
        try {
            const { data: d } = await api.get("/my-flat");
            setData(d);
        } catch (e) { toast.error(formatError(e)); }
    }
    useEffect(() => { load(); }, []);

    // Group connections by utility_type (must be before early returns per hook rules)
    const connsByType = useMemo(() => {
        const m = {};
        (data?.connections || []).forEach((c) => {
            if (!m[c.utility_type]) m[c.utility_type] = [];
            m[c.utility_type].push(c);
        });
        return m;
    }, [data]);

    if (!data) return <div className="p-6 text-brand-inkSoft text-sm">Loading your flat…</div>;
    if (!data.flat) {
        return (
            <div className="animate-fade-up">
                <PageHeader overline="Your home" title="My flat" />
                <EmptyState
                    title="You're not assigned to a flat yet"
                    description="Please contact your committee to assign your flat. Once assigned, you can track your utility connections and bills here."
                />
            </div>
        );
    }

    const flat = data.flat;
    const bills = data.recent_bills || [];
    const conns = data.connections || [];
    const unpaid = bills.filter((b) => b.status !== "paid");
    const pendingAmount = unpaid.reduce((s, b) => s + Number(b.amount || 0), 0);

    // ---- Connection CRUD ----
    function openCreateConn(utility_type = "electricity") {
        setEditingConn(null);
        setConnForm({ utility_type, provider_name: "", customer_id: "", meter_number: "", notes: "" });
        setConnOpen(true);
    }
    function openEditConn(c) {
        setEditingConn(c);
        setConnForm({
            utility_type: c.utility_type,
            provider_name: c.provider_name || "",
            customer_id: c.customer_id || "",
            meter_number: c.meter_number || "",
            notes: c.notes || "",
        });
        setConnOpen(true);
    }
    async function saveConn(e) {
        e.preventDefault();
        try {
            const payload = { ...connForm };
            Object.keys(payload).forEach((k) => { if (payload[k] === "") payload[k] = null; });
            payload.utility_type = connForm.utility_type;
            payload.provider_name = connForm.provider_name;
            payload.customer_id = connForm.customer_id;
            if (editingConn) {
                await api.patch(`/utility-connections/${editingConn.id}`, payload);
                toast.success("Connection updated");
            } else {
                await api.post(`/flats/${flat.id}/utility-connections`, payload);
                toast.success("Connection added");
            }
            setConnOpen(false);
            load();
        } catch (e) { toast.error(formatError(e)); }
    }
    async function removeConn(c) {
        if (!confirm(`Remove ${UTIL_MAP[c.utility_type]?.label || c.utility_type} connection?`)) return;
        try { await api.delete(`/utility-connections/${c.id}`); toast.success("Removed"); load(); }
        catch (e) { toast.error(formatError(e)); }
    }

    // ---- Bill actions ----
    function openCreateBill(prefill = {}) {
        setBillForm({
            utility_type: prefill.utility_type || "electricity",
            connection_id: prefill.connection_id || "",
            provider_name: prefill.provider_name || "",
            customer_id: prefill.customer_id || "",
            amount: "",
            bill_period: "",
            due_date: "",
            notes: "",
        });
        setBillOpen(true);
    }
    async function saveBill(e) {
        e.preventDefault();
        try {
            const payload = {
                flat_id: flat.id,
                utility_type: billForm.utility_type,
                connection_id: billForm.connection_id || null,
                provider_name: billForm.provider_name || null,
                customer_id: billForm.customer_id || null,
                amount: Number(billForm.amount),
                bill_period: billForm.bill_period,
                due_date: billForm.due_date,
                notes: billForm.notes || null,
            };
            await api.post("/utility-bills", payload);
            toast.success("Bill added");
            setBillOpen(false);
            load();
        } catch (e) { toast.error(formatError(e)); }
    }
    async function payBill(b) {
        try { await api.post(`/utility-bills/${b.id}/pay`, { method: "manual" }); toast.success("Marked paid"); load(); }
        catch (e) { toast.error(formatError(e)); }
    }
    async function removeBill(b) {
        if (!confirm("Delete this bill?")) return;
        try { await api.delete(`/utility-bills/${b.id}`); toast.success("Deleted"); load(); }
        catch (e) { toast.error(formatError(e)); }
    }

    // When picking a connection in bill dialog, prefill provider/customer
    function onPickConnection(cid) {
        const c = conns.find((x) => x.id === cid);
        setBillForm((f) => ({
            ...f,
            connection_id: cid,
            provider_name: c?.provider_name || f.provider_name,
            customer_id: c?.customer_id || f.customer_id,
            utility_type: c?.utility_type || f.utility_type,
        }));
    }

    return (
        <div className="animate-fade-up">
            <PageHeader
                overline="Your home"
                title={`Flat ${flat.block}-${flat.number}`}
                description={`${flat.floor ? `Floor ${flat.floor} · ` : ""}${flat.bhk || ""} · ${flat.occupancy}-occupied`}
                actions={
                    <div className="flex gap-2">
                        <Button data-testid="add-utility-bill-btn" onClick={() => openCreateBill()}
                            className="rounded-full bg-brand-action hover:bg-brand-actionHover text-white active:scale-[0.98]">
                            <Receipt size={16} className="mr-1.5" /> Log utility bill
                        </Button>
                    </div>
                }
            />

            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <StatCard label="Residents" value={data.residents.length} />
                <StatCard label="Connections" value={conns.length} hint={`${new Set(conns.map(c => c.utility_type)).size} utility type(s)`} />
                <StatCard label="Bills tracked" value={bills.length} />
                <StatCard label="Pending" value={inr(pendingAmount)} hint={`${unpaid.length} unpaid`} accent />
            </div>

            {/* Utility connections */}
            <div className="mb-10">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="font-heading text-xl text-brand-ink">Utility connections</h2>
                        <p className="text-sm text-brand-inkSoft">Save provider + customer ID once, then log bills in seconds.</p>
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {UTILITIES.filter(u => u.key !== "other").map((u) => {
                        const list = connsByType[u.key] || [];
                        const Icon = u.icon;
                        return (
                            <div key={u.key} data-testid={`utility-slot-${u.key}`}
                                className="bg-white border border-brand-line rounded-sm p-5 hover:-translate-y-1 hover:shadow-lg transition-transform duration-200">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-sm flex items-center justify-center" style={{ background: u.color + "22", color: u.color }}>
                                        <Icon size={20} weight="duotone" />
                                    </div>
                                    <div className="flex-1">
                                        <p className="font-heading text-lg text-brand-ink">{u.label}</p>
                                        <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft">
                                            {list.length ? `${list.length} account${list.length > 1 ? "s" : ""}` : "Not configured"}
                                        </p>
                                    </div>
                                </div>
                                <div className="mt-3 space-y-2">
                                    {list.map((c) => (
                                        <div key={c.id} data-testid={`connection-${c.id}`}
                                            className="border border-brand-line rounded-sm p-3 text-sm">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <p className="font-medium text-brand-ink truncate">{c.provider_name}</p>
                                                    <p className="text-xs text-brand-inkSoft mt-0.5 font-mono">CID: {c.customer_id}</p>
                                                    {c.meter_number && <p className="text-xs text-brand-inkSoft mt-0.5">Meter: {c.meter_number}</p>}
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <button data-testid={`edit-connection-${c.id}`} onClick={() => openEditConn(c)}
                                                        className="p-1.5 hover:bg-brand-sage rounded-sm"><PencilSimple size={13} /></button>
                                                    <button data-testid={`delete-connection-${c.id}`} onClick={() => removeConn(c)}
                                                        className="p-1.5 hover:bg-[#F5D6CE] rounded-sm text-brand-action"><Trash size={13} /></button>
                                                </div>
                                            </div>
                                            <button data-testid={`log-bill-${c.id}`}
                                                onClick={() => openCreateBill({ utility_type: c.utility_type, connection_id: c.id, provider_name: c.provider_name, customer_id: c.customer_id })}
                                                className="mt-3 text-xs text-brand-action hover:underline inline-flex items-center gap-1">
                                                <Receipt size={12} /> Log bill for this
                                            </button>
                                        </div>
                                    ))}
                                    <Button data-testid={`add-connection-${u.key}`} onClick={() => openCreateConn(u.key)}
                                        variant="outline" size="sm"
                                        className="w-full rounded-full border-dashed border-brand-line text-brand-inkSoft hover:text-brand-ink hover:border-brand-ink">
                                        <Plus size={14} className="mr-1" /> Add {u.label.toLowerCase()}
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Bills */}
            <div>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="font-heading text-xl text-brand-ink">Utility bills</h2>
                </div>
                {bills.length === 0 ? (
                    <EmptyState title="No bills logged yet" description="Log your first electricity, gas, or water bill to start tracking." />
                ) : (
                    <div className="bg-white border border-brand-line rounded-sm overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-brand-bg border-b border-brand-line text-left">
                                    {["Utility", "Provider", "Customer ID", "Period", "Amount", "Due", "Status", ""].map(h => (
                                        <th key={h} className="py-3 px-4 font-medium text-brand-inkSoft text-[10px] uppercase tracking-overline">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {bills.map((b) => {
                                    const u = UTIL_MAP[b.utility_type] || UTIL_MAP.other;
                                    const Icon = u.icon;
                                    return (
                                        <tr key={b.id} data-testid={`utility-bill-${b.id}`} className="border-b border-brand-line/60 hover:bg-brand-bg/50">
                                            <td className="py-3 px-4">
                                                <div className="flex items-center gap-2">
                                                    <Icon size={16} weight="duotone" style={{ color: u.color }} />
                                                    <span className="font-medium text-brand-ink">{u.label}</span>
                                                </div>
                                            </td>
                                            <td className="py-3 px-4 text-brand-inkSoft">{b.provider_name || "—"}</td>
                                            <td className="py-3 px-4 text-brand-inkSoft font-mono text-xs">{b.customer_id || "—"}</td>
                                            <td className="py-3 px-4 text-brand-inkSoft">{b.bill_period}</td>
                                            <td className="py-3 px-4 font-heading text-brand-ink">{inr(b.amount)}</td>
                                            <td className="py-3 px-4 text-brand-inkSoft">{b.due_date}</td>
                                            <td className="py-3 px-4"><Chip variant={b.status === "paid" ? "success" : "warn"}>{b.status}</Chip></td>
                                            <td className="py-3 px-4 text-right">
                                                {b.status !== "paid" && (
                                                    <button data-testid={`pay-utility-bill-${b.id}`} onClick={() => payBill(b)}
                                                        className="text-brand-action hover:underline text-xs font-medium inline-flex items-center gap-1">
                                                        <CheckCircle size={12} /> Mark paid
                                                    </button>
                                                )}
                                                <button data-testid={`delete-utility-bill-${b.id}`} onClick={() => removeBill(b)}
                                                    className="ml-3 p-1.5 hover:bg-[#F5D6CE] rounded-sm text-brand-action inline-flex">
                                                    <Trash size={13} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Connection Dialog */}
            <Dialog open={connOpen} onOpenChange={setConnOpen}>
                <DialogContent className="rounded-sm">
                    <DialogHeader>
                        <DialogTitle className="font-heading text-2xl tracking-tight">
                            {editingConn ? "Edit connection" : "Add utility connection"}
                        </DialogTitle>
                    </DialogHeader>
                    <form onSubmit={saveConn} className="space-y-4">
                        <div className="space-y-2">
                            <Label>Utility</Label>
                            <Select value={connForm.utility_type} onValueChange={(v) => setConnForm({ ...connForm, utility_type: v })}>
                                <SelectTrigger data-testid="conn-utility-select" className="rounded-sm border-brand-line"><SelectValue /></SelectTrigger>
                                <SelectContent>{UTILITIES.map(u => <SelectItem key={u.key} value={u.key}>{u.label}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <Label>Service provider</Label>
                                <Input data-testid="conn-provider-input" required value={connForm.provider_name}
                                    onChange={(e) => setConnForm({ ...connForm, provider_name: e.target.value })}
                                    placeholder="BESCOM, Adani Gas..."
                                    className="rounded-sm border-brand-line" />
                            </div>
                            <div className="space-y-2">
                                <Label>Customer ID</Label>
                                <Input data-testid="conn-customer-input" required value={connForm.customer_id}
                                    onChange={(e) => setConnForm({ ...connForm, customer_id: e.target.value })}
                                    placeholder="e.g. 5000123456"
                                    className="rounded-sm border-brand-line font-mono" />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Meter / Account no. (optional)</Label>
                            <Input value={connForm.meter_number} onChange={(e) => setConnForm({ ...connForm, meter_number: e.target.value })}
                                className="rounded-sm border-brand-line" />
                        </div>
                        <div className="space-y-2">
                            <Label>Notes (optional)</Label>
                            <Textarea rows={2} value={connForm.notes} onChange={(e) => setConnForm({ ...connForm, notes: e.target.value })}
                                className="rounded-sm border-brand-line" />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setConnOpen(false)} className="rounded-full">Cancel</Button>
                            <Button type="submit" data-testid="conn-submit-btn" className="rounded-full bg-brand-action hover:bg-brand-actionHover">
                                {editingConn ? "Save" : "Add"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Bill Dialog */}
            <Dialog open={billOpen} onOpenChange={setBillOpen}>
                <DialogContent className="rounded-sm">
                    <DialogHeader><DialogTitle className="font-heading text-2xl tracking-tight">Log utility bill</DialogTitle></DialogHeader>
                    <form onSubmit={saveBill} className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <Label>Utility</Label>
                                <Select value={billForm.utility_type} onValueChange={(v) => setBillForm({ ...billForm, utility_type: v })}>
                                    <SelectTrigger data-testid="bill-utility-select" className="rounded-sm border-brand-line"><SelectValue /></SelectTrigger>
                                    <SelectContent>{UTILITIES.map(u => <SelectItem key={u.key} value={u.key}>{u.label}</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Connection</Label>
                                <Select value={billForm.connection_id || "__none"}
                                    onValueChange={(v) => v === "__none" ? setBillForm({ ...billForm, connection_id: "" }) : onPickConnection(v)}>
                                    <SelectTrigger data-testid="bill-conn-select" className="rounded-sm border-brand-line"><SelectValue placeholder="None" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__none">None (fill manually)</SelectItem>
                                        {conns.map((c) => (
                                            <SelectItem key={c.id} value={c.id}>
                                                {UTIL_MAP[c.utility_type]?.label} · {c.provider_name} · {c.customer_id}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <Label>Provider</Label>
                                <Input value={billForm.provider_name} onChange={(e) => setBillForm({ ...billForm, provider_name: e.target.value })}
                                    className="rounded-sm border-brand-line" />
                            </div>
                            <div className="space-y-2">
                                <Label>Customer ID</Label>
                                <Input value={billForm.customer_id} onChange={(e) => setBillForm({ ...billForm, customer_id: e.target.value })}
                                    className="rounded-sm border-brand-line font-mono" />
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-2">
                                <Label>Amount (₹)</Label>
                                <Input data-testid="bill-amount-input" required type="number" step="0.01" value={billForm.amount}
                                    onChange={(e) => setBillForm({ ...billForm, amount: e.target.value })}
                                    className="rounded-sm border-brand-line" />
                            </div>
                            <div className="space-y-2">
                                <Label>Bill period</Label>
                                <Input data-testid="bill-period-input" required value={billForm.bill_period}
                                    onChange={(e) => setBillForm({ ...billForm, bill_period: e.target.value })}
                                    placeholder="2026-01" className="rounded-sm border-brand-line" />
                            </div>
                            <div className="space-y-2">
                                <Label>Due date</Label>
                                <Input data-testid="bill-due-input" required type="date" value={billForm.due_date}
                                    onChange={(e) => setBillForm({ ...billForm, due_date: e.target.value })}
                                    className="rounded-sm border-brand-line" />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Notes</Label>
                            <Textarea rows={2} value={billForm.notes} onChange={(e) => setBillForm({ ...billForm, notes: e.target.value })}
                                className="rounded-sm border-brand-line" />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setBillOpen(false)} className="rounded-full">Cancel</Button>
                            <Button type="submit" data-testid="bill-submit-btn" className="rounded-full bg-brand-action hover:bg-brand-actionHover">Save</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
