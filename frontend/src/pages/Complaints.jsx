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
import { Plus, CheckCircle, Clock, Warning, Bell, Wrench, Phone, EnvelopeSimple, UserGear } from "@phosphor-icons/react";
import { toast } from "sonner";

const CATS = ["plumbing", "electrical", "security", "cleanliness", "parking", "amenities", "general"];
const STATUSES = ["open", "in_progress", "resolved"];
const UNASSIGNED = "__unassigned__";

export default function Complaints() {
    const { user } = useAuth();
    const [complaints, setComplaints] = useState([]);
    const [staff, setStaff] = useState([]);
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState({ title: "", description: "", category: "general" });

    async function load() {
        try {
            const [c, s] = await Promise.all([api.get("/complaints"), api.get("/staff")]);
            setComplaints(c.data);
            setStaff(s.data);
        }
        catch (e) { toast.error(formatError(e)); }
    }
    useEffect(() => { load(); }, []);

    const isStaff = user?.role === "admin" || user?.role === "committee";

    async function submit(e) {
        e.preventDefault();
        try {
            await api.post("/complaints", form);
            toast.success("Complaint raised");
            setOpen(false);
            setForm({ title: "", description: "", category: "general" });
            load();
        } catch (e) { toast.error(formatError(e)); }
    }

    async function updateStatus(c, status) {
        try {
            await api.patch(`/complaints/${c.id}`, { status });
            toast.success("Updated");
            load();
        } catch (e) { toast.error(formatError(e)); }
    }

    async function reassign(c, staffId) {
        try {
            await api.patch(`/complaints/${c.id}`, { assigned_to: staffId === UNASSIGNED ? "" : staffId });
            toast.success(staffId === UNASSIGNED ? "Unassigned" : "Reassigned");
            load();
        } catch (e) { toast.error(formatError(e)); }
    }

    const grouped = {
        open: complaints.filter(c => c.status === "open"),
        in_progress: complaints.filter(c => c.status === "in_progress"),
        resolved: complaints.filter(c => c.status === "resolved"),
    };

    const statusChip = { open: "warn", in_progress: "default", resolved: "success" };

    return (
        <div className="animate-fade-up">
            <PageHeader
                overline="Support"
                title="Complaints"
                description={isStaff ? "Manage resident complaints. New ones auto-route to staff by category — reassign anytime." : "Raise issues about your flat or society and track resolution."}
                actions={
                    <Button data-testid="add-complaint-btn" onClick={() => setOpen(true)} className="rounded-full bg-brand-action hover:bg-brand-actionHover text-white active:scale-[0.98]">
                        <Plus size={16} className="mr-1.5" /> New complaint
                    </Button>
                }
            />

            {!isStaff && (
                <div className="mb-6 bg-brand-sage/60 border border-brand-line rounded-sm p-4 flex items-start gap-3" data-testid="complaint-notify-banner">
                    <Bell size={20} weight="duotone" className="text-brand-action mt-0.5" />
                    <div>
                        <p className="font-medium text-brand-ink">Your complaint auto-routes to the right person.</p>
                        <p className="text-xs text-brand-inkSoft mt-1">You'll see assigned staff contact details on your complaint card and get email updates as it moves.</p>
                    </div>
                </div>
            )}

            {complaints.length === 0 ? (
                <EmptyState title="Nothing to complain about" description="All quiet. Raise a complaint to bring an issue to the committee's attention." />
            ) : (
                <div className="grid md:grid-cols-3 gap-4">
                    {STATUSES.map((status) => (
                        <div key={status} className="bg-white border border-brand-line rounded-sm p-4">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    {status === "open" && <Warning size={18} className="text-brand-action" weight="duotone" />}
                                    {status === "in_progress" && <Clock size={18} className="text-brand-ink" weight="duotone" />}
                                    {status === "resolved" && <CheckCircle size={18} className="text-[#1F5B32]" weight="duotone" />}
                                    <h3 className="font-heading text-lg text-brand-ink capitalize">{status.replace("_", " ")}</h3>
                                </div>
                                <span className="text-xs text-brand-inkSoft">{grouped[status].length}</span>
                            </div>
                            <div className="space-y-3">
                                {grouped[status].length === 0 && <p className="text-xs text-brand-inkSoft py-6 text-center">Empty</p>}
                                {grouped[status].map((c) => (
                                    <div key={c.id} data-testid={`complaint-card-${c.id}`}
                                        className="border border-brand-line rounded-sm p-3 hover:border-brand-ink transition-colors">
                                        <div className="flex items-start justify-between gap-2">
                                            <p className="font-medium text-brand-ink text-sm">{c.title}</p>
                                            <Chip variant={statusChip[c.status]} data-testid={`complaint-status-chip-${c.id}`}>{c.status.replace("_", " ")}</Chip>
                                        </div>
                                        <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft mt-1">{c.category}</p>
                                        <p className="text-xs text-brand-inkSoft mt-2 line-clamp-2">{c.description}</p>

                                        {/* Assigned staff */}
                                        {c.assigned_staff ? (
                                            <div className="mt-3 p-2 bg-brand-sage/40 border border-brand-line rounded-sm" data-testid={`complaint-assigned-${c.id}`}>
                                                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-overline text-brand-inkSoft mb-1">
                                                    <Wrench size={11} weight="duotone" /> Assigned to
                                                </div>
                                                <p className="text-sm font-medium text-brand-ink leading-tight">{c.assigned_staff.name}</p>
                                                <p className="text-[11px] text-brand-inkSoft">{c.assigned_staff.role_label}{c.assigned_staff.vendor_org ? ` · ${c.assigned_staff.vendor_org}` : ""}</p>
                                                <div className="flex flex-wrap gap-2 mt-1.5">
                                                    {c.assigned_staff.phone && (
                                                        <a href={`tel:${c.assigned_staff.phone}`} className="text-[11px] text-brand-action hover:underline flex items-center gap-1">
                                                            <Phone size={11} weight="duotone" /> {c.assigned_staff.phone}
                                                        </a>
                                                    )}
                                                    {c.assigned_staff.email && (
                                                        <a href={`mailto:${c.assigned_staff.email}`} className="text-[11px] text-brand-action hover:underline flex items-center gap-1">
                                                            <EnvelopeSimple size={11} weight="duotone" /> Email
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        ) : isStaff ? (
                                            <div className="mt-3 p-2 border border-dashed border-brand-line rounded-sm text-[11px] text-brand-inkSoft flex items-center gap-1.5">
                                                <UserGear size={12} /> Not yet assigned — pick staff below
                                            </div>
                                        ) : null}

                                        <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
                                            <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft">{c.created_by_name}</p>
                                            {isStaff && (
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <Select value={c.assigned_to || UNASSIGNED} onValueChange={(v) => reassign(c, v)}>
                                                        <SelectTrigger data-testid={`complaint-assign-${c.id}`} className="h-7 text-xs rounded-sm border-brand-line w-36"><SelectValue placeholder="Assign" /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                                                            {staff.filter(s => s.is_active).map(s => (
                                                                <SelectItem key={s.id} value={s.id}>{s.name} · {s.category}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                    <Select value={c.status} onValueChange={(v) => updateStatus(c, v)}>
                                                        <SelectTrigger data-testid={`complaint-status-${c.id}`} className="h-7 text-xs rounded-sm border-brand-line w-28"><SelectValue /></SelectTrigger>
                                                        <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}</SelectContent>
                                                    </Select>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="rounded-sm">
                    <DialogHeader><DialogTitle className="font-heading text-2xl tracking-tight">New complaint</DialogTitle></DialogHeader>
                    <form onSubmit={submit} className="space-y-4">
                        <div className="space-y-2"><Label>Title</Label>
                            <Input data-testid="complaint-title-input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="rounded-sm border-brand-line" />
                        </div>
                        <div className="space-y-2"><Label>Category</Label>
                            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                                <SelectTrigger data-testid="complaint-category-select" className="rounded-sm border-brand-line"><SelectValue /></SelectTrigger>
                                <SelectContent>{CATS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2"><Label>Description</Label>
                            <Textarea data-testid="complaint-desc-input" required rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="rounded-sm border-brand-line" />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-full">Cancel</Button>
                            <Button type="submit" data-testid="complaint-submit-btn" className="rounded-full bg-brand-action hover:bg-brand-actionHover">Submit</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
