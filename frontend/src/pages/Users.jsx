import React, { useEffect, useState } from "react";
import api, { formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, EmptyState, Chip } from "@/components/Shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash, Plus, PencilSimple, UploadSimple } from "@phosphor-icons/react";
import { toast } from "sonner";
import CsvImport from "@/components/CsvImport";

const ROLES = ["admin", "committee", "resident"];

export default function Users() {
    const { user } = useAuth();
    const [users, setUsers] = useState([]);
    const [flats, setFlats] = useState([]);
    const [open, setOpen] = useState(false);
    const [csvOpen, setCsvOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", role: "resident", flat_id: "" });

    async function load() {
        try {
            const [u, f] = await Promise.all([api.get("/users"), api.get("/flats")]);
            setUsers(u.data);
            setFlats(f.data);
        } catch (e) { toast.error(formatError(e)); }
    }
    useEffect(() => { load(); }, []);

    function openCreate() {
        setEditing(null);
        setForm({ name: "", email: "", phone: "", password: "", role: "resident", flat_id: "" });
        setOpen(true);
    }
    function openEdit(u) {
        setEditing(u);
        setForm({ name: u.name, email: u.email, phone: u.phone || "", password: "", role: u.role, flat_id: u.flat_id || "" });
        setOpen(true);
    }
    async function submit(e) {
        e.preventDefault();
        try {
            if (editing) {
                const payload = { name: form.name, phone: form.phone, role: form.role, flat_id: form.flat_id || null };
                if (form.password) payload.password = form.password;
                await api.patch(`/users/${editing.id}`, payload);
                toast.success("Resident updated");
            } else {
                await api.post("/users", { ...form, flat_id: form.flat_id || null });
                toast.success("Resident added");
            }
            setOpen(false);
            load();
        } catch (e) { toast.error(formatError(e)); }
    }
    async function remove(u) {
        if (!confirm(`Delete ${u.name}?`)) return;
        try { await api.delete(`/users/${u.id}`); toast.success("Deleted"); load(); }
        catch (e) { toast.error(formatError(e)); }
    }

    const canManage = user?.role === "admin";

    return (
        <div className="animate-fade-up">
            <PageHeader
                overline="Community"
                title="Residents"
                description="Manage committee members, residents, and their flat assignments."
                actions={canManage && (
                    <div className="flex flex-wrap gap-2">
                        <Button data-testid="import-users-btn" onClick={() => setCsvOpen(true)} variant="outline"
                            className="rounded-full border-brand-ink text-brand-ink hover:bg-brand-ink hover:text-white">
                            <UploadSimple size={16} className="mr-1.5" /> Import CSV
                        </Button>
                        <Button data-testid="add-user-btn" onClick={openCreate} className="rounded-full bg-brand-action hover:bg-brand-actionHover text-white active:scale-[0.98]">
                            <Plus size={16} className="mr-1.5" /> Add resident
                        </Button>
                    </div>
                )}
            />

            {users.length === 0 ? (
                <EmptyState title="No residents yet" description="Add your first resident to get started." />
            ) : (
                <div className="bg-white border border-brand-line rounded-sm overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-brand-bg border-b border-brand-line text-left">
                                <th className="py-3 px-4 font-medium text-brand-inkSoft text-[10px] uppercase tracking-overline">Name</th>
                                <th className="py-3 px-4 font-medium text-brand-inkSoft text-[10px] uppercase tracking-overline">Email</th>
                                <th className="py-3 px-4 font-medium text-brand-inkSoft text-[10px] uppercase tracking-overline">Role</th>
                                <th className="py-3 px-4 font-medium text-brand-inkSoft text-[10px] uppercase tracking-overline">Flat</th>
                                <th className="py-3 px-4 font-medium text-brand-inkSoft text-[10px] uppercase tracking-overline">Phone</th>
                                {canManage && <th className="py-3 px-4"></th>}
                            </tr>
                        </thead>
                        <tbody>
                            {users.map((u) => (
                                <tr key={u.id} className="border-b border-brand-line/60 hover:bg-brand-bg/50">
                                    <td className="py-3 px-4 font-medium text-brand-ink">{u.name}</td>
                                    <td className="py-3 px-4 text-brand-inkSoft">{u.email}</td>
                                    <td className="py-3 px-4"><Chip variant={u.role === "admin" ? "danger" : u.role === "committee" ? "warn" : "default"}>{u.role}</Chip></td>
                                    <td className="py-3 px-4 text-brand-inkSoft">{u.flat ? `${u.flat.block}-${u.flat.number}` : "—"}</td>
                                    <td className="py-3 px-4 text-brand-inkSoft">{u.phone || "—"}</td>
                                    {canManage && (
                                        <td className="py-3 px-4 text-right">
                                            <button data-testid={`edit-user-${u.id}`} onClick={() => openEdit(u)} className="p-1.5 hover:bg-brand-sage rounded-sm mr-1">
                                                <PencilSimple size={14} />
                                            </button>
                                            <button data-testid={`delete-user-${u.id}`} onClick={() => remove(u)} className="p-1.5 hover:bg-[#F5D6CE] rounded-sm text-brand-action">
                                                <Trash size={14} />
                                            </button>
                                        </td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="rounded-sm border-brand-line" data-testid="user-dialog">
                    <DialogHeader>
                        <DialogTitle className="font-heading text-2xl tracking-tight">{editing ? "Edit resident" : "Add resident"}</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={submit} className="space-y-4">
                        <div className="space-y-2">
                            <Label>Full name</Label>
                            <Input data-testid="user-name-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-sm border-brand-line" />
                        </div>
                        <div className="space-y-2">
                            <Label>Email</Label>
                            <Input data-testid="user-email-input" type="email" required disabled={!!editing} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-sm border-brand-line" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <Label>Phone</Label>
                                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="rounded-sm border-brand-line" />
                            </div>
                            <div className="space-y-2">
                                <Label>Role</Label>
                                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                                    <SelectTrigger data-testid="user-role-select" className="rounded-sm border-brand-line"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Flat</Label>
                            <Select value={form.flat_id || "__none"} onValueChange={(v) => setForm({ ...form, flat_id: v === "__none" ? "" : v })}>
                                <SelectTrigger data-testid="user-flat-select" className="rounded-sm border-brand-line"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none">Unassigned</SelectItem>
                                    {flats.map((f) => <SelectItem key={f.id} value={f.id}>{f.block}-{f.number}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>{editing ? "New password (leave blank to keep)" : "Password"}</Label>
                            <Input data-testid="user-password-input" type="password" required={!editing} minLength={editing ? 0 : 6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="rounded-sm border-brand-line" />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-full">Cancel</Button>
                            <Button type="submit" data-testid="user-submit-btn" className="rounded-full bg-brand-action hover:bg-brand-actionHover">{editing ? "Save" : "Add"}</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <CsvImport
                open={csvOpen}
                onOpenChange={setCsvOpen}
                endpoint="/users/import-csv"
                title="Import residents"
                columns="name, email, phone, role, password, block, flat_number"
                template={`name,email,phone,role,password,block,flat_number\nAsha Rao,asha@example.com,+919000000001,resident,welcome123,A,101\nRavi Kumar,ravi@example.com,+919000000002,resident,welcome123,A,102\n`}
                onDone={load}
            />
        </div>
    );
}
