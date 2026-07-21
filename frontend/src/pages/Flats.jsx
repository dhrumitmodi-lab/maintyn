import React, { useEffect, useMemo, useState } from "react";
import api, { formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, EmptyState, Chip, StatCard } from "@/components/Shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash, PencilSimple, UploadSimple } from "@phosphor-icons/react";
import { toast } from "sonner";
import CsvImport from "@/components/CsvImport";

export default function Flats() {
    const { user } = useAuth();
    const [flats, setFlats] = useState([]);
    const [summary, setSummary] = useState(null);
    const [open, setOpen] = useState(false);
    const [csvOpen, setCsvOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState({ block: "", number: "", floor: "", bhk: "", occupancy: "vacant" });
    const [blockFilter, setBlockFilter] = useState("all");
    const [occupancyFilter, setOccupancyFilter] = useState("all");

    async function load() {
        try {
            const [f, s] = await Promise.all([api.get("/flats"), api.get("/flats/summary")]);
            setFlats(f.data);
            setSummary(s.data);
        } catch (e) { toast.error(formatError(e)); }
    }
    useEffect(() => { load(); }, []);

    const isStaff = user?.role === "admin" || user?.role === "committee";

    function openCreate() {
        setEditing(null);
        setForm({ block: "", number: "", floor: "", bhk: "", occupancy: "vacant" });
        setOpen(true);
    }
    function openEdit(f) {
        setEditing(f);
        setForm({ block: f.block, number: f.number, floor: f.floor || "", bhk: f.bhk || "", occupancy: f.occupancy || "vacant" });
        setOpen(true);
    }
    async function submit(e) {
        e.preventDefault();
        try {
            if (editing) {
                await api.patch(`/flats/${editing.id}`, form);
                toast.success("Flat updated");
            } else {
                await api.post("/flats", form);
                toast.success("Flat added");
            }
            setOpen(false);
            load();
        } catch (e) { toast.error(formatError(e)); }
    }
    async function remove(f) {
        if (!confirm(`Delete flat ${f.block}-${f.number}?`)) return;
        try { await api.delete(`/flats/${f.id}`); toast.success("Deleted"); load(); }
        catch (e) { toast.error(formatError(e)); }
    }

    const blocks = useMemo(() => {
        const set = new Set(flats.map(f => f.block).filter(Boolean));
        return Array.from(set).sort();
    }, [flats]);

    const filtered = useMemo(() => {
        return flats.filter(f =>
            (blockFilter === "all" || f.block === blockFilter) &&
            (occupancyFilter === "all" || f.occupancy === occupancyFilter)
        );
    }, [flats, blockFilter, occupancyFilter]);

    const grouped = useMemo(() => {
        const g = {};
        for (const f of filtered) {
            const k = f.block || "—";
            if (!g[k]) g[k] = [];
            g[k].push(f);
        }
        return Object.entries(g).sort(([a], [b]) => a.localeCompare(b));
    }, [filtered]);

    return (
        <div className="animate-fade-up">
            <PageHeader
                overline="Directory"
                title="Flats"
                description="Every unit in your society — grouped by block, with occupancy at a glance."
                actions={isStaff && (
                    <div className="flex flex-wrap gap-2">
                        <Button data-testid="import-flats-btn" onClick={() => setCsvOpen(true)} variant="outline"
                            className="rounded-full border-brand-ink text-brand-ink hover:bg-brand-ink hover:text-white">
                            <UploadSimple size={16} className="mr-1.5" /> Import CSV
                        </Button>
                        <Button data-testid="add-flat-btn" onClick={openCreate} className="rounded-full bg-brand-action hover:bg-brand-actionHover text-white active:scale-[0.98]">
                            <Plus size={16} className="mr-1.5" /> Add flat
                        </Button>
                    </div>
                )}
            />

            {/* Summary */}
            {summary && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                    <StatCard label="Total flats" value={summary.total} hint={`${summary.blocks.length} blocks`} />
                    <StatCard label="Occupied" value={summary.occupied} hint={summary.total ? `${Math.round((summary.occupied/summary.total)*100)}%` : "0%"} />
                    <StatCard label="Vacant" value={summary.vacant} hint={summary.total ? `${Math.round((summary.vacant/summary.total)*100)}%` : "0%"} accent />
                    <StatCard label="Owner-occupied" value={summary.owners} />
                    <StatCard label="Tenant-occupied" value={summary.tenants} />
                </div>
            )}

            {/* Filters */}
            {flats.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 mb-6">
                    <span className="text-[10px] uppercase tracking-overline text-brand-inkSoft mr-2">Block</span>
                    <button data-testid="block-filter-all" onClick={() => setBlockFilter("all")}
                        className={`px-3 py-1.5 rounded-full text-xs uppercase tracking-overline font-medium transition-colors ${blockFilter === "all" ? "bg-brand-ink text-white" : "bg-white border border-brand-line text-brand-inkSoft hover:bg-brand-sage"}`}>
                        All ({flats.length})
                    </button>
                    {blocks.map(b => {
                        const count = flats.filter(f => f.block === b).length;
                        return (
                            <button key={b} data-testid={`block-filter-${b}`} onClick={() => setBlockFilter(b)}
                                className={`px-3 py-1.5 rounded-full text-xs uppercase tracking-overline font-medium transition-colors ${blockFilter === b ? "bg-brand-ink text-white" : "bg-white border border-brand-line text-brand-inkSoft hover:bg-brand-sage"}`}>
                                {b} ({count})
                            </button>
                        );
                    })}
                    <div className="w-px h-6 bg-brand-line mx-2" />
                    <span className="text-[10px] uppercase tracking-overline text-brand-inkSoft mr-1">Occupancy</span>
                    {["all", "owner", "tenant", "vacant"].map(o => (
                        <button key={o} data-testid={`occupancy-filter-${o}`} onClick={() => setOccupancyFilter(o)}
                            className={`px-3 py-1.5 rounded-full text-xs uppercase tracking-overline font-medium transition-colors ${occupancyFilter === o ? "bg-brand-ink text-white" : "bg-white border border-brand-line text-brand-inkSoft hover:bg-brand-sage"}`}>
                            {o}
                        </button>
                    ))}
                </div>
            )}

            {flats.length === 0 ? (
                <EmptyState title="No flats yet" description="Add flats to start managing your society." />
            ) : filtered.length === 0 ? (
                <EmptyState title="No matches" description="Try a different filter." />
            ) : (
                <div className="space-y-8">
                    {grouped.map(([block, items]) => (
                        <section key={block} data-testid={`block-section-${block}`}>
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-8 h-8 rounded-sm bg-brand-ink text-white flex items-center justify-center font-heading">
                                    {block}
                                </div>
                                <h2 className="font-heading text-xl text-brand-ink">Block {block}</h2>
                                <span className="text-xs text-brand-inkSoft">— {items.length} flat{items.length !== 1 ? "s" : ""}</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {items.map((f) => (
                                    <div key={f.id} data-testid={`flat-card-${f.id}`}
                                        className="bg-white border border-brand-line rounded-sm p-6 hover:-translate-y-1 hover:shadow-lg transition-transform duration-200">
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft">Block {f.block}</p>
                                                <p className="font-heading text-3xl tracking-tight text-brand-ink mt-1">{f.number}</p>
                                                <p className="text-xs text-brand-inkSoft mt-1">{f.floor ? `Floor ${f.floor}` : ""} {f.bhk && `· ${f.bhk}`}</p>
                                            </div>
                                            <Chip variant={f.occupancy === "vacant" ? "neutral" : f.occupancy === "owner" ? "success" : "default"}>{f.occupancy}</Chip>
                                        </div>
                                        <div className="mt-4 pt-4 border-t border-brand-line">
                                            <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft mb-2">Residents</p>
                                            {f.residents && f.residents.length > 0 ? (
                                                <div className="space-y-1">
                                                    {f.residents.map((r) => (
                                                        <div key={r.id} className="text-sm text-brand-ink">
                                                            {r.name} <span className="text-brand-inkSoft text-xs">· {r.role}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : <p className="text-sm text-brand-inkSoft">No residents assigned</p>}
                                        </div>
                                        {isStaff && (
                                            <div className="mt-4 flex justify-end gap-1">
                                                <button data-testid={`edit-flat-${f.id}`} onClick={() => openEdit(f)} className="p-1.5 hover:bg-brand-sage rounded-sm"><PencilSimple size={14} /></button>
                                                <button data-testid={`delete-flat-${f.id}`} onClick={() => remove(f)} className="p-1.5 hover:bg-[#F5D6CE] rounded-sm text-brand-action"><Trash size={14} /></button>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            )}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="rounded-sm">
                    <DialogHeader>
                        <DialogTitle className="font-heading text-2xl tracking-tight">{editing ? "Edit flat" : "Add flat"}</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={submit} className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2"><Label>Block</Label>
                                <Input data-testid="flat-block-input" required value={form.block} onChange={(e) => setForm({ ...form, block: e.target.value })} className="rounded-sm border-brand-line" />
                            </div>
                            <div className="space-y-2"><Label>Flat number</Label>
                                <Input data-testid="flat-number-input" required value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} className="rounded-sm border-brand-line" />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2"><Label>Floor</Label>
                                <Input value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} className="rounded-sm border-brand-line" />
                            </div>
                            <div className="space-y-2"><Label>BHK</Label>
                                <Input value={form.bhk} onChange={(e) => setForm({ ...form, bhk: e.target.value })} placeholder="2BHK" className="rounded-sm border-brand-line" />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Occupancy</Label>
                            <Select value={form.occupancy} onValueChange={(v) => setForm({ ...form, occupancy: v })}>
                                <SelectTrigger className="rounded-sm border-brand-line"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="owner">Owner occupied</SelectItem>
                                    <SelectItem value="tenant">Tenant occupied</SelectItem>
                                    <SelectItem value="vacant">Vacant</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-full">Cancel</Button>
                            <Button type="submit" data-testid="flat-submit-btn" className="rounded-full bg-brand-action hover:bg-brand-actionHover">{editing ? "Save" : "Add"}</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <CsvImport
                open={csvOpen}
                onOpenChange={setCsvOpen}
                endpoint="/flats/import-csv"
                title="Import flats"
                columns="block, number, floor, bhk, occupancy"
                template={`block,number,floor,bhk,occupancy\nA,101,1,2BHK,owner\nA,102,1,2BHK,tenant\nA,103,1,3BHK,vacant\n`}
                onDone={load}
            />
        </div>
    );
}
