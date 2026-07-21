import React, { useState } from "react";
import api, { formatError } from "@/lib/api";
import { useSociety } from "@/context/SocietyContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

export default function SocietySettingsDialog({ open, onOpenChange }) {
    const { society, setSociety } = useSociety();
    const [form, setForm] = useState({
        name: "", address: "", city: "", established_year: "", contact_email: "", contact_phone: "",
    });
    const [busy, setBusy] = useState(false);

    React.useEffect(() => {
        if (open && society) {
            setForm({
                name: society.name || "",
                address: society.address || "",
                city: society.city || "",
                established_year: society.established_year || "",
                contact_email: society.contact_email || "",
                contact_phone: society.contact_phone || "",
            });
        }
    }, [open, society]);

    async function submit(e) {
        e.preventDefault();
        setBusy(true);
        try {
            const payload = { ...form };
            payload.established_year = form.established_year ? Number(form.established_year) : null;
            Object.keys(payload).forEach(k => { if (payload[k] === "") payload[k] = null; });
            const { data } = await api.patch("/society", payload);
            setSociety(data);
            toast.success("Society settings saved");
            onOpenChange(false);
        } catch (e) { toast.error(formatError(e)); }
        finally { setBusy(false); }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="rounded-sm max-w-lg">
                <DialogHeader>
                    <DialogTitle className="font-heading text-2xl tracking-tight">Society settings</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-brand-inkSoft -mt-2">
                    The society name shows on the sidebar, landing page and every email.
                </p>
                <form onSubmit={submit} className="space-y-4">
                    <div className="space-y-2">
                        <Label>Society name</Label>
                        <Input data-testid="society-name-input" required value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            placeholder="Green Valley Residency"
                            className="rounded-sm border-brand-line h-11" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <Label>City</Label>
                            <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}
                                placeholder="Bengaluru" className="rounded-sm border-brand-line h-11" />
                        </div>
                        <div className="space-y-2">
                            <Label>Established</Label>
                            <Input type="number" min={1900} max={2100} value={form.established_year}
                                onChange={(e) => setForm({ ...form, established_year: e.target.value })}
                                placeholder="2015" className="rounded-sm border-brand-line h-11" />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <Label>Address</Label>
                        <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                            placeholder="123 Main Road, Sector 5"
                            className="rounded-sm border-brand-line h-11" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <Label>Contact email</Label>
                            <Input type="email" value={form.contact_email}
                                onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                                className="rounded-sm border-brand-line h-11" />
                        </div>
                        <div className="space-y-2">
                            <Label>Contact phone</Label>
                            <Input value={form.contact_phone}
                                onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
                                className="rounded-sm border-brand-line h-11" />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="rounded-full">Cancel</Button>
                        <Button type="submit" data-testid="society-save-btn" disabled={busy}
                            className="rounded-full bg-brand-action hover:bg-brand-actionHover">
                            {busy ? "Saving..." : "Save"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
