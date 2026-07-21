import React, { useEffect, useRef, useState } from "react";
import api, { formatError, API_BASE } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, EmptyState, Chip } from "@/components/Shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash, Paperclip, DownloadSimple } from "@phosphor-icons/react";
import { toast } from "sonner";

const inr = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);
const CATS = ["maintenance", "repairs", "utilities", "security", "cleaning", "events", "other"];

export default function Expenses() {
    const { user } = useAuth();
    const [expenses, setExpenses] = useState([]);
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState({ title: "", amount: "", category: "maintenance", date: "", description: "", receipt_file_id: "" });
    const [uploading, setUploading] = useState(false);
    const [receiptName, setReceiptName] = useState("");
    const fileRef = useRef();

    async function load() {
        try { const { data } = await api.get("/expenses"); setExpenses(data); }
        catch (e) { toast.error(formatError(e)); }
    }
    useEffect(() => { load(); }, []);

    const isStaff = user?.role === "admin" || user?.role === "committee";

    async function uploadReceipt(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append("file", file);
            const { data } = await api.post("/files/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
            setForm(f => ({ ...f, receipt_file_id: data.id }));
            setReceiptName(file.name);
            toast.success("Receipt uploaded");
        } catch (e) { toast.error(formatError(e)); }
        finally { setUploading(false); }
    }

    async function submit(e) {
        e.preventDefault();
        try {
            await api.post("/expenses", { ...form, amount: parseFloat(form.amount) });
            toast.success("Expense recorded");
            setOpen(false);
            setForm({ title: "", amount: "", category: "maintenance", date: "", description: "", receipt_file_id: "" });
            setReceiptName("");
            load();
        } catch (e) { toast.error(formatError(e)); }
    }
    async function remove(exp) {
        if (!confirm("Delete this expense?")) return;
        try { await api.delete(`/expenses/${exp.id}`); toast.success("Deleted"); load(); }
        catch (e) { toast.error(formatError(e)); }
    }

    function downloadUrl(fid) {
        const token = localStorage.getItem("maintyn_token");
        return `${API_BASE}/files/${fid}/download?auth=${encodeURIComponent(token || "")}`;
    }

    const total = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);

    return (
        <div className="animate-fade-up">
            <PageHeader
                overline="Books"
                title="Expenses"
                description="Log every rupee spent on society upkeep — with receipts attached."
                actions={isStaff && (
                    <Button data-testid="add-expense-btn" onClick={() => setOpen(true)} className="rounded-full bg-brand-action hover:bg-brand-actionHover text-white active:scale-[0.98]">
                        <Plus size={16} className="mr-1.5" /> Log expense
                    </Button>
                )}
            />

            <div className="bg-white border border-brand-line rounded-sm p-6 mb-6 flex items-center justify-between">
                <div>
                    <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft">Total logged</p>
                    <p className="font-heading text-3xl text-brand-ink tracking-tight mt-1">{inr(total)}</p>
                </div>
                <div className="text-right">
                    <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft">Entries</p>
                    <p className="font-heading text-3xl text-brand-ink tracking-tight mt-1">{expenses.length}</p>
                </div>
            </div>

            {expenses.length === 0 ? (
                <EmptyState title="No expenses yet" description="Log your first society expense to start tracking."
                    image="https://images.unsplash.com/photo-1704310546522-59f10c7ec294?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTJ8MHwxfHNlYXJjaHwyfHxtaW5pbWFsaXN0JTIwZW1wdHklMjByb29tJTIwc3VubGlnaHR8ZW58MHx8fHwxNzg0NjIzMzM0fDA&ixlib=rb-4.1.0&q=85" />
            ) : (
                <div className="bg-white border border-brand-line rounded-sm overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-brand-bg border-b border-brand-line text-left">
                                {["Title", "Category", "Date", "Amount", "By", "Receipt", ""].map(h => (
                                    <th key={h} className="py-3 px-4 font-medium text-brand-inkSoft text-[10px] uppercase tracking-overline">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {expenses.map((e) => (
                                <tr key={e.id} className="border-b border-brand-line/60 hover:bg-brand-bg/50">
                                    <td className="py-3 px-4 font-medium text-brand-ink">
                                        {e.title}
                                        {e.description && <div className="text-xs text-brand-inkSoft mt-1">{e.description}</div>}
                                    </td>
                                    <td className="py-3 px-4"><Chip>{e.category}</Chip></td>
                                    <td className="py-3 px-4 text-brand-inkSoft">{e.date}</td>
                                    <td className="py-3 px-4 font-heading text-brand-ink">{inr(e.amount)}</td>
                                    <td className="py-3 px-4 text-brand-inkSoft">{e.created_by_name}</td>
                                    <td className="py-3 px-4">
                                        {e.receipt_file_id ? (
                                            <a href={downloadUrl(e.receipt_file_id)} target="_blank" rel="noreferrer" className="text-brand-action hover:underline text-xs inline-flex items-center gap-1">
                                                <DownloadSimple size={14} /> View
                                            </a>
                                        ) : <span className="text-brand-inkSoft text-xs">—</span>}
                                    </td>
                                    <td className="py-3 px-4 text-right">
                                        {isStaff && (
                                            <button data-testid={`delete-expense-${e.id}`} onClick={() => remove(e)} className="p-1.5 hover:bg-[#F5D6CE] rounded-sm text-brand-action"><Trash size={14} /></button>
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
                    <DialogHeader><DialogTitle className="font-heading text-2xl tracking-tight">Log expense</DialogTitle></DialogHeader>
                    <form onSubmit={submit} className="space-y-4">
                        <div className="space-y-2"><Label>Title</Label>
                            <Input data-testid="expense-title-input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="rounded-sm border-brand-line" />
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-2"><Label>Amount (₹)</Label>
                                <Input data-testid="expense-amount-input" required type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="rounded-sm border-brand-line" />
                            </div>
                            <div className="space-y-2"><Label>Category</Label>
                                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                                    <SelectTrigger className="rounded-sm border-brand-line"><SelectValue /></SelectTrigger>
                                    <SelectContent>{CATS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2"><Label>Date</Label>
                                <Input required type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="rounded-sm border-brand-line" />
                            </div>
                        </div>
                        <div className="space-y-2"><Label>Description</Label>
                            <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="rounded-sm border-brand-line" />
                        </div>
                        <div className="space-y-2">
                            <Label>Receipt (optional)</Label>
                            <input ref={fileRef} type="file" onChange={uploadReceipt} accept="image/*,application/pdf" className="hidden" />
                            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="expense-upload-btn"
                                className="rounded-full border-brand-line w-full">
                                <Paperclip size={14} className="mr-1.5" />
                                {uploading ? "Uploading..." : receiptName || "Attach receipt"}
                            </Button>
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-full">Cancel</Button>
                            <Button type="submit" data-testid="expense-submit-btn" className="rounded-full bg-brand-action hover:bg-brand-actionHover">Save</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
