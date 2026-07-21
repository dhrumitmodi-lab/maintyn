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
import { Plus, Trash, Megaphone } from "@phosphor-icons/react";
import { toast } from "sonner";

const CATS = ["notice", "event", "maintenance", "general"];

export default function Announcements() {
    const { user } = useAuth();
    const [items, setItems] = useState([]);
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState({ title: "", content: "", category: "notice" });

    async function load() {
        try { const { data } = await api.get("/announcements"); setItems(data); }
        catch (e) { toast.error(formatError(e)); }
    }
    useEffect(() => { load(); }, []);

    const isStaff = user?.role === "admin" || user?.role === "committee";

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
                    <Button data-testid="add-announcement-btn" onClick={() => setOpen(true)} className="rounded-full bg-brand-action hover:bg-brand-actionHover text-white active:scale-[0.98]">
                        <Plus size={16} className="mr-1.5" /> New notice
                    </Button>
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
        </div>
    );
}
