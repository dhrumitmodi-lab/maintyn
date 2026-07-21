import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api, { formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader, StatCard, Chip, EmptyState } from "@/components/Shared";
import { Buildings, Plus, Trash, Pause, Play, ArrowSquareOut, UserCircle, SignOut, Users as UsersIcon } from "@phosphor-icons/react";
import { toast } from "sonner";

const inr = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);

export default function MasterConsole() {
    const { user, logout, setUser } = useAuth();
    const nav = useNavigate();
    const [societies, setSocieties] = useState([]);
    const [rollup, setRollup] = useState(null);
    const [agents, setAgents] = useState([]);
    const [tab, setTab] = useState("societies");

    // Create society
    const [openCreate, setOpenCreate] = useState(false);
    const [form, setForm] = useState({ name: "", admin_name: "", admin_email: "", admin_password: "", admin_phone: "" });

    // Create master user
    const [agentOpen, setAgentOpen] = useState(false);
    const [agentForm, setAgentForm] = useState({ name: "", email: "", password: "", role: "support" });

    const isSuper = user?.role === "super_admin";

    async function load() {
        try {
            const [s, r] = await Promise.all([api.get("/master/societies"), api.get("/master/rollup")]);
            setSocieties(s.data); setRollup(r.data);
            if (isSuper) {
                const a = await api.get("/master/users");
                setAgents(a.data);
            }
        } catch (e) { toast.error(formatError(e)); }
    }
    useEffect(() => { load(); }, []);

    async function createSociety(e) {
        e.preventDefault();
        try {
            await api.post("/master/societies", form);
            toast.success(`${form.name} created — welcome email sent to admin`);
            setOpenCreate(false);
            setForm({ name: "", admin_name: "", admin_email: "", admin_password: "", admin_phone: "" });
            load();
        } catch (e) { toast.error(formatError(e)); }
    }
    async function toggleStatus(s) {
        const next = s.status === "active" ? "suspended" : "active";
        try { await api.patch(`/master/societies/${s.id}/status`, { status: next }); toast.success(`${s.name}: ${next}`); load(); }
        catch (e) { toast.error(formatError(e)); }
    }
    async function removeSociety(s) {
        if (!confirm(`Delete ${s.name} and ALL its data? This cannot be undone.`)) return;
        if (!confirm(`Type-through confirm: This will drop the ${s.name} database. Proceed?`)) return;
        try { await api.delete(`/master/societies/${s.id}`); toast.success(`${s.name} deleted`); load(); }
        catch (e) { toast.error(formatError(e)); }
    }
    async function impersonate(s) {
        try {
            const { data } = await api.post(`/master/societies/${s.id}/impersonate`);
            if (data.access_token) localStorage.setItem("maintyn_token", data.access_token);
            toast.success(`Impersonating ${s.name} as ${data.user.name}`);
            setUser(null);
            setTimeout(() => nav("/app"), 100);
        } catch (e) { toast.error(formatError(e)); }
    }
    async function createAgent(e) {
        e.preventDefault();
        try {
            await api.post("/master/users", agentForm);
            toast.success("Master user created");
            setAgentOpen(false);
            setAgentForm({ name: "", email: "", password: "", role: "support" });
            load();
        } catch (e) { toast.error(formatError(e)); }
    }
    async function toggleAgent(u) {
        try { await api.patch(`/master/users/${u.id}`, { is_active: !u.is_active }); toast.success("Updated"); load(); }
        catch (e) { toast.error(formatError(e)); }
    }
    async function removeAgent(u) {
        if (!confirm(`Remove ${u.name}?`)) return;
        try { await api.delete(`/master/users/${u.id}`); toast.success("Removed"); load(); }
        catch (e) { toast.error(formatError(e)); }
    }

    return (
        <div className="min-h-screen bg-brand-bg">
            <header className="bg-[#13241D] text-white">
                <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
                    <div>
                        <p className="text-[10px] uppercase tracking-overline text-[#C85A3C]">Master console</p>
                        <h1 className="font-heading text-2xl">maintyn · Customer Success</h1>
                    </div>
                    <div className="text-right">
                        <p className="text-sm font-medium" data-testid="master-user-name">{user?.name}</p>
                        <p className="text-xs text-[#8FA69A]">{user?.email} · {user?.role}</p>
                        <button data-testid="master-logout" onClick={async () => { await logout(); nav("/login"); }}
                            className="mt-2 text-xs bg-white/10 hover:bg-[#C85A3C] rounded-full px-3 py-1 inline-flex items-center gap-1 transition-colors">
                            <SignOut size={12} /> Sign out
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-6 py-8">
                <PageHeader
                    overline="Rollup"
                    title="All societies"
                    description="Create, monitor, suspend, and impersonate any society on maintyn."
                />

                {/* Rollup */}
                {rollup && (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
                        <StatCard label="Societies" value={rollup.societies} />
                        <StatCard label="Residents" value={rollup.total_residents} />
                        <StatCard label="Flats" value={rollup.total_flats} />
                        <StatCard label="Unpaid invoices" value={rollup.total_unpaid_invoices} accent />
                        <StatCard label="Pending amount" value={inr(rollup.total_pending_amount)} />
                    </div>
                )}

                <Tabs value={tab} onValueChange={setTab}>
                    <TabsList className="bg-white border border-brand-line rounded-full p-1 mb-6">
                        <TabsTrigger data-testid="master-tab-societies" value="societies" className="rounded-full data-[state=active]:bg-brand-ink data-[state=active]:text-white px-5">
                            <Buildings size={14} className="mr-1.5" /> Societies
                        </TabsTrigger>
                        {isSuper && (
                            <TabsTrigger data-testid="master-tab-agents" value="agents" className="rounded-full data-[state=active]:bg-brand-ink data-[state=active]:text-white px-5">
                                <UsersIcon size={14} className="mr-1.5" /> Support team
                            </TabsTrigger>
                        )}
                    </TabsList>

                    <TabsContent value="societies">
                        <div className="flex justify-end mb-4">
                            {isSuper && (
                                <Button data-testid="master-create-society-btn" onClick={() => setOpenCreate(true)}
                                    className="rounded-full bg-brand-action hover:bg-brand-actionHover text-white">
                                    <Plus size={16} className="mr-1.5" /> Create society
                                </Button>
                            )}
                        </div>
                        {societies.length === 0 ? <EmptyState title="No societies yet" description="Create your first society." /> : (
                            <div className="bg-white border border-brand-line rounded-sm overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-brand-bg border-b border-brand-line text-left">
                                            {["Society", "Admin", "Flats", "Residents", "Unpaid", "Status", ""].map(h => (
                                                <th key={h} className="py-3 px-4 font-medium text-brand-inkSoft text-[10px] uppercase tracking-overline">{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {societies.map(s => (
                                            <tr key={s.id} data-testid={`society-row-${s.id}`} className="border-b border-brand-line/60 hover:bg-brand-bg/50">
                                                <td className="py-3 px-4">
                                                    <div className="font-medium text-brand-ink">{s.name}</div>
                                                    <div className="text-[10px] uppercase tracking-overline text-brand-inkSoft">{s.is_default ? "default" : "custom"} · {new Date(s.created_at).toLocaleDateString()}</div>
                                                </td>
                                                <td className="py-3 px-4 text-brand-inkSoft">{s.first_admin_email}</td>
                                                <td className="py-3 px-4 text-brand-ink font-heading">{s.flats}</td>
                                                <td className="py-3 px-4 text-brand-ink font-heading">{s.residents}</td>
                                                <td className="py-3 px-4 text-brand-ink font-heading">{s.unpaid_invoices}</td>
                                                <td className="py-3 px-4"><Chip variant={s.status === "active" ? "success" : "danger"}>{s.status}</Chip></td>
                                                <td className="py-3 px-4 text-right space-x-1">
                                                    <button data-testid={`impersonate-${s.id}`} onClick={() => impersonate(s)}
                                                        title="Impersonate admin" className="p-1.5 hover:bg-brand-sage rounded-sm inline-flex"><ArrowSquareOut size={14} /></button>
                                                    {isSuper && (
                                                        <>
                                                            <button data-testid={`toggle-${s.id}`} onClick={() => toggleStatus(s)}
                                                                title={s.status === "active" ? "Suspend" : "Reactivate"}
                                                                className="p-1.5 hover:bg-brand-sage rounded-sm inline-flex">
                                                                {s.status === "active" ? <Pause size={14} /> : <Play size={14} />}
                                                            </button>
                                                            {!s.is_default && (
                                                                <button data-testid={`delete-${s.id}`} onClick={() => removeSociety(s)}
                                                                    title="Delete society" className="p-1.5 hover:bg-[#F5D6CE] rounded-sm text-brand-action inline-flex">
                                                                    <Trash size={14} />
                                                                </button>
                                                            )}
                                                        </>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </TabsContent>

                    {isSuper && (
                        <TabsContent value="agents">
                            <div className="flex justify-end mb-4">
                                <Button data-testid="master-create-agent-btn" onClick={() => setAgentOpen(true)}
                                    className="rounded-full bg-brand-action hover:bg-brand-actionHover text-white">
                                    <Plus size={16} className="mr-1.5" /> Add support agent
                                </Button>
                            </div>
                            <div className="bg-white border border-brand-line rounded-sm overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-brand-bg border-b border-brand-line text-left">
                                            {["Name", "Email", "Role", "Status", ""].map(h => (
                                                <th key={h} className="py-3 px-4 font-medium text-brand-inkSoft text-[10px] uppercase tracking-overline">{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {agents.map(a => (
                                            <tr key={a.id} data-testid={`agent-row-${a.id}`} className="border-b border-brand-line/60">
                                                <td className="py-3 px-4 font-medium text-brand-ink">{a.name}</td>
                                                <td className="py-3 px-4 text-brand-inkSoft">{a.email}</td>
                                                <td className="py-3 px-4"><Chip variant={a.role === "super_admin" ? "danger" : "default"}>{a.role}</Chip></td>
                                                <td className="py-3 px-4"><Chip variant={a.is_active ? "success" : "neutral"}>{a.is_active ? "active" : "inactive"}</Chip></td>
                                                <td className="py-3 px-4 text-right space-x-1">
                                                    <button data-testid={`toggle-agent-${a.id}`} onClick={() => toggleAgent(a)}
                                                        className="text-xs text-brand-action hover:underline mr-2">{a.is_active ? "Deactivate" : "Activate"}</button>
                                                    {a.id !== user.id && (
                                                        <button data-testid={`delete-agent-${a.id}`} onClick={() => removeAgent(a)}
                                                            className="p-1.5 hover:bg-[#F5D6CE] rounded-sm text-brand-action inline-flex"><Trash size={14} /></button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </TabsContent>
                    )}
                </Tabs>
            </main>

            {/* Create society dialog */}
            <Dialog open={openCreate} onOpenChange={setOpenCreate}>
                <DialogContent className="rounded-sm">
                    <DialogHeader><DialogTitle className="font-heading text-2xl tracking-tight">New society</DialogTitle></DialogHeader>
                    <form onSubmit={createSociety} className="space-y-4">
                        <div className="space-y-2"><Label>Society name</Label>
                            <Input data-testid="society-name-field" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                                placeholder="Green Valley Residency" className="rounded-sm border-brand-line" /></div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2"><Label>First admin name</Label>
                                <Input data-testid="society-admin-name" required value={form.admin_name} onChange={e => setForm({ ...form, admin_name: e.target.value })}
                                    className="rounded-sm border-brand-line" /></div>
                            <div className="space-y-2"><Label>Admin phone</Label>
                                <Input value={form.admin_phone} onChange={e => setForm({ ...form, admin_phone: e.target.value })}
                                    className="rounded-sm border-brand-line" /></div>
                        </div>
                        <div className="space-y-2"><Label>Admin email</Label>
                            <Input data-testid="society-admin-email" type="email" required value={form.admin_email} onChange={e => setForm({ ...form, admin_email: e.target.value })}
                                className="rounded-sm border-brand-line" /></div>
                        <div className="space-y-2"><Label>Temporary password (share privately)</Label>
                            <Input data-testid="society-admin-password" required minLength={6} value={form.admin_password} onChange={e => setForm({ ...form, admin_password: e.target.value })}
                                placeholder="e.g. Welcome@2026" className="rounded-sm border-brand-line font-mono" /></div>
                        <p className="text-xs text-brand-inkSoft">A welcome email with these credentials will be sent to the admin.</p>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setOpenCreate(false)} className="rounded-full">Cancel</Button>
                            <Button type="submit" data-testid="society-create-submit" className="rounded-full bg-brand-action hover:bg-brand-actionHover">Create society</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Create master user dialog */}
            <Dialog open={agentOpen} onOpenChange={setAgentOpen}>
                <DialogContent className="rounded-sm">
                    <DialogHeader><DialogTitle className="font-heading text-2xl tracking-tight">Add support agent</DialogTitle></DialogHeader>
                    <form onSubmit={createAgent} className="space-y-4">
                        <div className="space-y-2"><Label>Name</Label>
                            <Input required value={agentForm.name} onChange={e => setAgentForm({ ...agentForm, name: e.target.value })} className="rounded-sm border-brand-line" /></div>
                        <div className="space-y-2"><Label>Email</Label>
                            <Input data-testid="agent-email" type="email" required value={agentForm.email} onChange={e => setAgentForm({ ...agentForm, email: e.target.value })} className="rounded-sm border-brand-line" /></div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2"><Label>Password</Label>
                                <Input required minLength={6} value={agentForm.password} onChange={e => setAgentForm({ ...agentForm, password: e.target.value })} className="rounded-sm border-brand-line font-mono" /></div>
                            <div className="space-y-2"><Label>Role</Label>
                                <select value={agentForm.role} onChange={e => setAgentForm({ ...agentForm, role: e.target.value })}
                                    className="rounded-sm border border-brand-line h-10 px-3 bg-white w-full">
                                    <option value="support">support</option>
                                    <option value="super_admin">super_admin</option>
                                </select>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setAgentOpen(false)} className="rounded-full">Cancel</Button>
                            <Button type="submit" data-testid="agent-create-submit" className="rounded-full bg-brand-action hover:bg-brand-actionHover">Add</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
