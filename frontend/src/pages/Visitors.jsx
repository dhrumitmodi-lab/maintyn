import React, { useEffect, useState } from "react";
import api, { formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, EmptyState, Chip } from "@/components/Shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, SignOut } from "@phosphor-icons/react";
import { toast } from "sonner";

export default function Visitors() {
    const { user } = useAuth();
    const [visitors, setVisitors] = useState([]);
    const [flats, setFlats] = useState([]);
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState({ name: "", phone: "", purpose: "", flat_id: "", vehicle_no: "" });

    async function load() {
        try {
            const [v, f] = await Promise.all([api.get("/visitors"), api.get("/flats")]);
            setVisitors(v.data); setFlats(f.data);
        } catch (e) { toast.error(formatError(e)); }
    }
    useEffect(() => { load(); }, []);

    async function submit(e) {
        e.preventDefault();
        try {
            await api.post("/visitors", form);
            toast.success("Visitor logged");
            setOpen(false);
            setForm({ name: "", phone: "", purpose: "", flat_id: "", vehicle_no: "" });
            load();
        } catch (e) { toast.error(formatError(e)); }
    }
    async function checkout(v) {
        try { await api.post(`/visitors/${v.id}/checkout`); toast.success("Checked out"); load(); }
        catch (e) { toast.error(formatError(e)); }
    }

    const fmt = (iso) => iso ? new Date(iso).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" }) : "—";

    return (
        <div className="animate-fade-up">
            <PageHeader
                overline="Gate"
                title="Visitors"
                description="Log visitors coming in and out. Committee sees all, residents see their own."
                actions={
                    <Button data-testid="add-visitor-btn" onClick={() => setOpen(true)} className="rounded-full bg-brand-action hover:bg-brand-actionHover text-white active:scale-[0.98]">
                        <Plus size={16} className="mr-1.5" /> Log visitor
                    </Button>
                }
            />

            {visitors.length === 0 ? (
                <EmptyState title="No visitors logged" description="Log the first visitor at the gate to get started." />
            ) : (
                <div className="bg-white border border-brand-line rounded-sm overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-brand-bg border-b border-brand-line text-left">
                                {["Name", "Purpose", "Flat", "Vehicle", "Check-in", "Check-out", ""].map(h => (
                                    <th key={h} className="py-3 px-4 font-medium text-brand-inkSoft text-[10px] uppercase tracking-overline">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {visitors.map((v) => (
                                <tr key={v.id} className="border-b border-brand-line/60 hover:bg-brand-bg/50">
                                    <td className="py-3 px-4 font-medium text-brand-ink">
                                        {v.name}
                                        {v.phone && <div className="text-xs text-brand-inkSoft mt-0.5">{v.phone}</div>}
                                    </td>
                                    <td className="py-3 px-4 text-brand-inkSoft">{v.purpose}</td>
                                    <td className="py-3 px-4 text-brand-inkSoft">{v.flat ? `${v.flat.block}-${v.flat.number}` : "—"}</td>
                                    <td className="py-3 px-4 text-brand-inkSoft">{v.vehicle_no || "—"}</td>
                                    <td className="py-3 px-4 text-brand-inkSoft">{fmt(v.check_in)}</td>
                                    <td className="py-3 px-4">
                                        {v.check_out ? <span className="text-brand-inkSoft">{fmt(v.check_out)}</span> : <Chip variant="warn">On premises</Chip>}
                                    </td>
                                    <td className="py-3 px-4 text-right">
                                        {!v.check_out && (
                                            <button data-testid={`checkout-visitor-${v.id}`} onClick={() => checkout(v)} className="text-brand-action hover:underline text-xs font-medium inline-flex items-center gap-1">
                                                <SignOut size={14} /> Check-out
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="rounded-sm">
                    <DialogHeader><DialogTitle className="font-heading text-2xl tracking-tight">Log visitor</DialogTitle></DialogHeader>
                    <form onSubmit={submit} className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2"><Label>Name</Label>
                                <Input data-testid="visitor-name-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-sm border-brand-line" />
                            </div>
                            <div className="space-y-2"><Label>Phone</Label>
                                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="rounded-sm border-brand-line" />
                            </div>
                        </div>
                        <div className="space-y-2"><Label>Purpose</Label>
                            <Input data-testid="visitor-purpose-input" required value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Delivery, guest, service..." className="rounded-sm border-brand-line" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2"><Label>Visiting flat</Label>
                                <Select value={form.flat_id} onValueChange={(v) => setForm({ ...form, flat_id: v })}>
                                    <SelectTrigger data-testid="visitor-flat-select" className="rounded-sm border-brand-line"><SelectValue placeholder="Select flat" /></SelectTrigger>
                                    <SelectContent>{flats.map(f => <SelectItem key={f.id} value={f.id}>{f.block}-{f.number}</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2"><Label>Vehicle no. (optional)</Label>
                                <Input value={form.vehicle_no} onChange={(e) => setForm({ ...form, vehicle_no: e.target.value })} className="rounded-sm border-brand-line" />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-full">Cancel</Button>
                            <Button type="submit" data-testid="visitor-submit-btn" className="rounded-full bg-brand-action hover:bg-brand-actionHover">Log entry</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
