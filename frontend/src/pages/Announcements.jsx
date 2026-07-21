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
import { Plus, Trash, Megaphone, EnvelopeSimple } from "@phosphor-icons/react";
import { toast } from "sonner";

const CATS = ["notice", "event", "maintenance", "general"];

export default function Announcements() {
    const { user } = useAuth();
    const [items, setItems] = useState([]);
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState({ title: "", content: "", category: "notice" });
    const [digestOpen, setDigestOpen] = useState(false);
    const [digest, setDigest] = useState(null);
    const [digestRuns, setDigestRuns] = useState([]);
    const [digestBusy, setDigestBusy] = useState(false);
    const isAdmin = user?.role === "admin";
    const isStaff = user?.role === "admin" || user?.role === "committee";

    async function load() {
        try { const { data } = await api.get("/announcements"); setItems(data); }
        catch (e) { toast.error(formatError(e)); }
    }
    useEffect(() => {
        load();
        if (isAdmin) {
            api.get("/admin/digest/runs").then((r) => setDigestRuns(r.data)).catch(() => {});
        }
    }, [isAdmin]);

    async function openDigest() {
        setDigest(null);
        setDigestOpen(true);
        setDigestBusy(true);
        try {
            const { data } = await api.post("/admin/digest/preview");
            setDigest(data);
        } catch (e) { toast.error(formatError(e)); }
        finally { setDigestBusy(false); }
    }

    async function sendDigest() {
        if (!confirm(`Send the ${digest?.label} digest to all residents now?`)) return;
        setDigestBusy(true);
        try {
            const { data } = await api.post("/admin/digest/send");
            if (data.skipped) {
                toast.info(`Digest for ${data.month} was already sent.`);
            } else {
                toast.success(`Digest sent to ${data.sent_count}/${data.total_users} residents`);
            }
            const runs = await api.get("/admin/digest/runs");
            setDigestRuns(runs.data);
            setDigestOpen(false);
        } catch (e) { toast.error(formatError(e)); }
        finally { setDigestBusy(false); }
    }

    async function submit(e) {
        e.preventDefault();
        try {
            await api.post("/announcements", form);
            toast.success("Notice posted");
            setOpen(false);
            setForm({ title: "", content: "", category: "notice" });
            load();
        } catch (e) { toast.error(formatError(e)); }
    }
    async function remove(a) {
        if (!confirm("Delete this notice?")) return;
        try { await api.delete(`/announcements/${a.id}`); toast.success("Deleted"); load(); }
        catch (e) { toast.error(formatError(e)); }
    }

    return (
        <div className="animate-fade-up">
            <PageHeader
                overline="Broadcast"
                title="Notices & Announcements"
                description="Keep the community informed. Notices, events, and maintenance updates."
                actions={isStaff && (
                    <div className="flex flex-wrap gap-2">
                        {isAdmin && (
                            <Button data-testid="digest-open-btn" onClick={openDigest} variant="outline"
                                className="rounded-full border-brand-ink text-brand-ink hover:bg-brand-ink hover:text-white">
                                <EnvelopeSimple size={16} className="mr-1.5" /> Monthly digest
                            </Button>
                        )}
                        <Button data-testid="add-announcement-btn" onClick={() => setOpen(true)}
                            className="rounded-full bg-brand-action hover:bg-brand-actionHover text-white active:scale-[0.98]">
                            <Plus size={16} className="mr-1.5" /> New notice
                        </Button>
                    </div>
                )}
            />

            {items.length === 0 ? (
                <EmptyState title="No notices yet" description="Post an announcement to keep residents informed." />
            ) : (
                <div className="grid md:grid-cols-2 gap-4">
                    {items.map((a) => (
                        <div key={a.id} className="bg-white border border-brand-line rounded-sm p-6 hover:-translate-y-1 hover:shadow-lg transition-transform duration-200">
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-sm bg-brand-sage flex items-center justify-center text-brand-ink">
                                        <Megaphone size={20} weight="duotone" />
                                    </div>
                                    <div>
                                        <h3 className="font-heading text-lg text-brand-ink leading-tight">{a.title}</h3>
                                        <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft mt-1">{new Date(a.created_at).toLocaleDateString()} · {a.created_by_name}</p>
                                    </div>
                                </div>
                                <Chip>{a.category}</Chip>
                            </div>
                            <p className="text-sm text-brand-ink mt-4 leading-relaxed whitespace-pre-wrap">{a.content}</p>
                            {isStaff && (
                                <div className="mt-4 flex justify-end">
                                    <button data-testid={`delete-announcement-${a.id}`} onClick={() => remove(a)} className="p-1.5 hover:bg-[#F5D6CE] rounded-sm text-brand-action"><Trash size={14} /></button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="rounded-sm">
                    <DialogHeader><DialogTitle className="font-heading text-2xl tracking-tight">New notice</DialogTitle></DialogHeader>
                    <form onSubmit={submit} className="space-y-4">
                        <div className="space-y-2"><Label>Title</Label>
                            <Input data-testid="announcement-title-input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="rounded-sm border-brand-line" />
                        </div>
                        <div className="space-y-2"><Label>Category</Label>
                            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                                <SelectTrigger className="rounded-sm border-brand-line"><SelectValue /></SelectTrigger>
                                <SelectContent>{CATS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2"><Label>Content</Label>
                            <Textarea data-testid="announcement-content-input" required rows={6} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} className="rounded-sm border-brand-line" />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-full">Cancel</Button>
                            <Button type="submit" data-testid="announcement-submit-btn" className="rounded-full bg-brand-action hover:bg-brand-actionHover">Post</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Digest preview + send dialog */}
            <Dialog open={digestOpen} onOpenChange={setDigestOpen}>
                <DialogContent className="rounded-sm max-w-xl">
                    <DialogHeader>
                        <DialogTitle className="font-heading text-2xl tracking-tight">Monthly digest</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-brand-inkSoft -mt-2">
                        A warm one-glance email of collections, resolved complaints, upcoming bookings and notices —
                        auto-sent on the 1st of each month, or send it now.
                    </p>

                    {digestBusy && !digest && <p className="py-6 text-sm text-brand-inkSoft text-center">Loading preview…</p>}
                    {digest && (
                        <div className="border border-brand-line rounded-sm p-5 bg-brand-bg space-y-4" data-testid="digest-preview">
                            <div>
                                <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft">Preview for</p>
                                <p className="font-heading text-xl text-brand-ink">{digest.label}</p>
                            </div>
                            <div>
                                <p className="text-xs text-brand-inkSoft">Collection</p>
                                <p className="font-heading text-3xl text-brand-ink tracking-tight">{digest.collection_pct}%</p>
                                <div className="h-2 bg-brand-line rounded-full overflow-hidden mt-1">
                                    <div className="h-full bg-brand-action" style={{ width: `${digest.collection_pct}%` }} />
                                </div>
                                <p className="text-xs text-brand-inkSoft mt-1">
                                    {digest.invoices_paid} of {digest.total_invoices} invoices paid · ₹{Math.round(digest.collected).toLocaleString('en-IN')} collected
                                </p>
                            </div>
                            <div className="grid grid-cols-3 gap-3 text-center">
                                <div className="bg-white border border-brand-line rounded-sm p-3">
                                    <p className="font-heading text-xl text-brand-ink">{digest.resolved_complaints}</p>
                                    <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft mt-1">Resolved</p>
                                </div>
                                <div className="bg-white border border-brand-line rounded-sm p-3">
                                    <p className="font-heading text-xl text-brand-ink">{digest.upcoming_bookings.length}</p>
                                    <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft mt-1">Upcoming</p>
                                </div>
                                <div className="bg-white border border-brand-line rounded-sm p-3">
                                    <p className="font-heading text-xl text-brand-ink">{digest.notices.length}</p>
                                    <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft mt-1">Notices</p>
                                </div>
                            </div>
                            {digestRuns.length > 0 && (
                                <div>
                                    <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft">Recent sends</p>
                                    <ul className="mt-2 space-y-1 text-xs text-brand-inkSoft">
                                        {digestRuns.slice(0, 3).map((r) => (
                                            <li key={r.month}>
                                                <b className="text-brand-ink">{r.label}</b> — sent to {r.sent_count}/{r.total_users} on {new Date(r.sent_at).toLocaleDateString()}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setDigestOpen(false)} className="rounded-full">Close</Button>
                        <Button type="button" data-testid="digest-send-btn" onClick={sendDigest} disabled={digestBusy || !digest}
                            className="rounded-full bg-brand-action hover:bg-brand-actionHover">
                            <EnvelopeSimple size={14} className="mr-1.5" />
                            {digestBusy ? "Sending..." : `Send ${digest?.label || ""} digest`}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
