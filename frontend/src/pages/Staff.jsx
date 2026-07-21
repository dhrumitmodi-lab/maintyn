import React, { useEffect, useState } from "react";
import api, { formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, EmptyState, Chip } from "@/components/Shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash, PencilSimple, Phone, EnvelopeSimple, ToggleLeft, ToggleRight, Wrench } from "@phosphor-icons/react";
import { toast } from "sonner";

const CATS = ["plumbing", "electrical", "security", "cleanliness", "parking", "amenities", "lift", "general"];

const emptyForm = {
    name: "", role_label: "", category: "general",
    phone: "", email: "", vendor_org: "", notes: "", is_active: true,
};

export default function Staff() {
    const { user } = useAuth();
    const [rows, setRows] = useState([]);
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(emptyForm);
    const [filterCat, setFilterCat] = useState("all");

    const isStaff = user?.role === "admin" || user?.role === "committee";

    async function load() {
        try {
            const { data } = await api.get("/staff");
            setRows(data);
        } catch (e) { toast.error(formatError(e)); }
    }
    useEffect(() => { load(); }, []);

    function openNew() {
        setEditing(null); setForm(emptyForm); setOpen(true);
    }
    function openEdit(s) {
        setEditing(s);
        setForm({
            name: s.name || "", role_label: s.role_label || "", category: s.category || "general",
            phone: s.phone || "", email: s.email || "", vendor_org: s.vendor_org || "",
            notes: s.notes || "", is_active: s.is_active !== false,
        });
        setOpen(true);
    }

    async function submit(e) {
        e.preventDefault();
        try {
            const payload = { ...form, email: form.email || null };
            if (editing) {
                await api.patch(`/staff/${editing.id}`, payload);
                toast.success("Updated");
            } else {
                await api.post("/staff", payload);
                toast.success("Added");
            }
            setOpen(false); setForm(emptyForm); setEditing(null);
            load();
        } catch (e) { toast.error(formatError(e)); }
    }

    async function remove(s) {
        if (!confirm(`Remove ${s.name}? Complaints assigned to them will become unassigned.`)) return;
        try { await api.delete(`/staff/${s.id}`); toast.success("Removed"); load(); }
        catch (e) { toast.error(formatError(e)); }
    }

    async function toggleActive(s) {
        try {
            await api.patch(`/staff/${s.id}`, {
                name: s.name, role_label: s.role_label, category: s.category,
                phone: s.phone || null, email: s.email || null,
                vendor_org: s.vendor_org || null, notes: s.notes || null,
                is_active: !s.is_active,
            });
            load();
        } catch (e) { toast.error(formatError(e)); }
    }

    const filtered = filterCat === "all" ? rows : rows.filter(r => r.category === filterCat);

    return (
        <div className="animate-fade-up">
            <PageHeader
                overline="Operations"
                title="Staff & Vendors"
                description={isStaff
                    ? "Keep contacts of your plumbers, electricians, security and vendors. New complaints auto-route to the first active staff in the matching category."
                    : "Community staff and vendors — contact them when your complaint is assigned."}
                actions={isStaff && (
                    <Button data-testid="add-staff-btn" onClick={openNew} className="rounded-full bg-brand-action hover:bg-brand-actionHover text-white active:scale-[0.98]">
                        <Plus size={16} className="mr-1.5" /> Add staff / vendor
                    </Button>
                )}
            />

            <div className="flex flex-wrap gap-2 mb-4">
                <button data-testid="staff-filter-all" onClick={() => setFilterCat("all")}
                    className={`px-4 py-1.5 rounded-full text-xs uppercase tracking-overline font-medium transition-colors ${filterCat === "all" ? "bg-brand-ink text-white" : "bg-white border border-brand-line text-brand-inkSoft hover:bg-brand-sage"}`}>
                    All
                </button>
                {CATS.map(c => (
                    <button key={c} data-testid={`staff-filter-${c}`} onClick={() => setFilterCat(c)}
                        className={`px-4 py-1.5 rounded-full text-xs uppercase tracking-overline font-medium transition-colors ${filterCat === c ? "bg-brand-ink text-white" : "bg-white border border-brand-line text-brand-inkSoft hover:bg-brand-sage"}`}>
                        {c}
                    </button>
                ))}
            </div>

            {filtered.length === 0 ? (
                <EmptyState title="No staff yet" description={isStaff ? "Add your first plumber, electrician or vendor. Complaints in matching category will be auto-assigned." : "The committee hasn't added staff for this category yet."} />
            ) : (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="staff-grid">
                    {filtered.map(s => (
                        <div key={s.id} data-testid={`staff-card-${s.id}`}
                            className={`bg-white border rounded-sm p-5 transition-all ${s.is_active ? "border-brand-line hover:border-brand-ink" : "border-dashed border-brand-line opacity-70"}`}>
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex items-start gap-3 min-w-0">
                                    <div className="w-10 h-10 rounded-sm bg-brand-sage flex items-center justify-center flex-shrink-0">
                                        <Wrench size={18} weight="duotone" className="text-brand-ink" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-heading text-lg text-brand-ink leading-tight truncate">{s.name}</p>
                                        <p className="text-xs text-brand-inkSoft">{s.role_label}</p>
                                        {s.vendor_org && <p className="text-[11px] text-brand-inkSoft mt-0.5 italic truncate">{s.vendor_org}</p>}
                                    </div>
                                </div>
                                <Chip variant={s.is_active ? "success" : "neutral"}>{s.category}</Chip>
                            </div>
                            <div className="mt-4 space-y-1.5">
                                {s.phone && (
                                    <a href={`tel:${s.phone}`} className="flex items-center gap-2 text-sm text-brand-ink hover:text-brand-action">
                                        <Phone size={14} weight="duotone" /> {s.phone}
                                    </a>
                                )}
                                {s.email && (
                                    <a href={`mailto:${s.email}`} className="flex items-center gap-2 text-sm text-brand-ink hover:text-brand-action truncate">
                                        <EnvelopeSimple size={14} weight="duotone" /> <span className="truncate">{s.email}</span>
                                    </a>
                                )}
                                {s.notes && <p className="text-xs text-brand-inkSoft mt-2 line-clamp-2">{s.notes}</p>}
                            </div>
                            {isStaff && (
                                <div className="flex items-center justify-between mt-4 pt-3 border-t border-brand-line">
                                    <button onClick={() => toggleActive(s)} data-testid={`toggle-active-${s.id}`}
                                        className="text-xs text-brand-inkSoft hover:text-brand-ink flex items-center gap-1">
                                        {s.is_active ? <><ToggleRight size={16} weight="fill" className="text-[#1F5B32]" /> Active</> : <><ToggleLeft size={16} /> Inactive</>}
                                    </button>
                                    <div className="flex items-center gap-1">
                                        <button data-testid={`edit-staff-${s.id}`} onClick={() => openEdit(s)} className="p-1.5 hover:bg-brand-sage rounded-sm text-brand-ink"><PencilSimple size={14} /></button>
                                        <button data-testid={`delete-staff-${s.id}`} onClick={() => remove(s)} className="p-1.5 hover:bg-[#F5D6CE] rounded-sm text-brand-action"><Trash size={14} /></button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="rounded-sm max-w-lg">
                    <DialogHeader><DialogTitle className="font-heading text-2xl tracking-tight">{editing ? "Edit" : "Add"} staff / vendor</DialogTitle></DialogHeader>
                    <form onSubmit={submit} className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2 col-span-2"><Label>Name</Label>
                                <Input data-testid="staff-name-input" required value={form.name}
                                    onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-sm border-brand-line" />
                            </div>
                            <div className="space-y-2"><Label>Role / title</Label>
                                <Input data-testid="staff-role-input" required placeholder="e.g. Plumber" value={form.role_label}
                                    onChange={(e) => setForm({ ...form, role_label: e.target.value })} className="rounded-sm border-brand-line" />
                            </div>
                            <div className="space-y-2"><Label>Category</Label>
                                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                                    <SelectTrigger data-testid="staff-category-select" className="rounded-sm border-brand-line"><SelectValue /></SelectTrigger>
                                    <SelectContent>{CATS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2"><Label>Phone</Label>
                                <Input data-testid="staff-phone-input" value={form.phone}
                                    onChange={(e) => setForm({ ...form, phone: e.target.value })} className="rounded-sm border-brand-line" />
                            </div>
                            <div className="space-y-2"><Label>Email (optional)</Label>
                                <Input data-testid="staff-email-input" type="email" value={form.email}
                                    onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-sm border-brand-line" />
                            </div>
                            <div className="space-y-2 col-span-2"><Label>Vendor / organisation (optional)</Label>
                                <Input value={form.vendor_org}
                                    onChange={(e) => setForm({ ...form, vendor_org: e.target.value })} className="rounded-sm border-brand-line" />
                            </div>
                            <div className="space-y-2 col-span-2"><Label>Notes</Label>
                                <Textarea rows={2} value={form.notes}
                                    onChange={(e) => setForm({ ...form, notes: e.target.value })} className="rounded-sm border-brand-line" />
                            </div>
                            <label className="col-span-2 flex items-center gap-2 text-sm text-brand-ink cursor-pointer">
                                <input type="checkbox" checked={form.is_active}
                                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                                Active (available for auto-assignment)
                            </label>
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-full">Cancel</Button>
                            <Button type="submit" data-testid="staff-submit-btn" className="rounded-full bg-brand-action hover:bg-brand-actionHover">{editing ? "Save" : "Add"}</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
