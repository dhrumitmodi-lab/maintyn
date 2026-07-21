import React, { useRef, useState } from "react";
import api, { formatError } from "@/lib/api";
import { useSociety } from "@/context/SocietyContext";
import { fileDownloadUrl } from "@/lib/files";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { UploadSimple, Trash, Bank, QrCode, House, WarningOctagon } from "@phosphor-icons/react";
import { toast } from "sonner";

export default function SocietySettingsDialog({ open, onOpenChange }) {
    const { society, setSociety } = useSociety();
    const [form, setForm] = useState({
        name: "", address: "", city: "", established_year: "",
        contact_email: "", contact_phone: "",
        logo_file_id: "", upi_id: "", upi_qr_file_id: "",
        bank_name: "", bank_account_number: "", bank_account_holder: "", bank_ifsc: "",
        penalty_enabled: false, penalty_mode: "fixed", penalty_amount: "", penalty_max: "",
    });
    const [busy, setBusy] = useState(false);
    const [uploading, setUploading] = useState({ logo: false, qr: false });
    const logoRef = useRef();
    const qrRef = useRef();

    React.useEffect(() => {
        if (open && society) {
            setForm({
                name: society.name || "",
                address: society.address || "",
                city: society.city || "",
                established_year: society.established_year || "",
                contact_email: society.contact_email || "",
                contact_phone: society.contact_phone || "",
                logo_file_id: society.logo_file_id || "",
                upi_id: society.upi_id || "",
                upi_qr_file_id: society.upi_qr_file_id || "",
                bank_name: society.bank_name || "",
                bank_account_number: society.bank_account_number || "",
                bank_account_holder: society.bank_account_holder || "",
                bank_ifsc: society.bank_ifsc || "",
                penalty_enabled: !!society.penalty_enabled,
                penalty_mode: society.penalty_mode || "fixed",
                penalty_amount: society.penalty_amount ?? "",
                penalty_max: society.penalty_max ?? "",
            });
        }
    }, [open, society]);

    async function uploadFile(key, file) {
        setUploading((u) => ({ ...u, [key]: true }));
        try {
            const fd = new FormData();
            fd.append("file", file);
            const { data } = await api.post("/files/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
            setForm((f) => ({ ...f, [key === "logo" ? "logo_file_id" : "upi_qr_file_id"]: data.id }));
            toast.success(`${key === "logo" ? "Logo" : "QR code"} uploaded`);
        } catch (e) { toast.error(formatError(e)); }
        finally { setUploading((u) => ({ ...u, [key]: false })); }
    }

    async function submit(e) {
        e.preventDefault();
        setBusy(true);
        try {
            const payload = { ...form };
            payload.established_year = form.established_year ? Number(form.established_year) : null;
            Object.keys(payload).forEach((k) => { if (payload[k] === "") payload[k] = null; });
            const { data } = await api.patch("/society", payload);
            setSociety(data);
            toast.success("Society settings saved");
            onOpenChange(false);
        } catch (e) { toast.error(formatError(e)); }
        finally { setBusy(false); }
    }

    const logoUrl = fileDownloadUrl(form.logo_file_id);
    const qrUrl = fileDownloadUrl(form.upi_qr_file_id);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="rounded-sm max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="font-heading text-2xl tracking-tight">Society settings</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-brand-inkSoft -mt-2">
                    Society name & logo appear on the sidebar, header and every invoice. UPI & bank details show on invoices so residents can pay directly.
                </p>
                <form onSubmit={submit}>
                    <Tabs defaultValue="general" className="w-full">
                        <TabsList className="bg-brand-bg border border-brand-line rounded-full p-1 mb-4">
                            <TabsTrigger data-testid="settings-tab-general" value="general" className="rounded-full data-[state=active]:bg-brand-ink data-[state=active]:text-white px-4">
                                <House size={14} className="mr-1.5" /> General
                            </TabsTrigger>
                            <TabsTrigger data-testid="settings-tab-payment" value="payment" className="rounded-full data-[state=active]:bg-brand-ink data-[state=active]:text-white px-4">
                                <QrCode size={14} className="mr-1.5" /> UPI
                            </TabsTrigger>
                            <TabsTrigger data-testid="settings-tab-bank" value="bank" className="rounded-full data-[state=active]:bg-brand-ink data-[state=active]:text-white px-4">
                                <Bank size={14} className="mr-1.5" /> Bank
                            </TabsTrigger>
                            <TabsTrigger data-testid="settings-tab-penalty" value="penalty" className="rounded-full data-[state=active]:bg-brand-ink data-[state=active]:text-white px-4">
                                <WarningOctagon size={14} className="mr-1.5" /> Penalty
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="general" className="space-y-4">
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
                                    <Label>Established year</Label>
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
                            <div className="space-y-2 border-t border-brand-line pt-4">
                                <Label>Society logo</Label>
                                <p className="text-xs text-brand-inkSoft">Shows on the sidebar and top of every invoice. PNG or JPG, ideally square.</p>
                                <div className="flex items-center gap-4">
                                    <div className="w-20 h-20 rounded-sm border border-brand-line bg-brand-bg flex items-center justify-center overflow-hidden">
                                        {logoUrl ? <img src={logoUrl} alt="logo" className="w-full h-full object-contain" data-testid="society-logo-preview" />
                                            : <House size={28} className="text-brand-inkSoft" />}
                                    </div>
                                    <input ref={logoRef} type="file" accept="image/*" className="hidden"
                                        onChange={(e) => e.target.files?.[0] && uploadFile("logo", e.target.files[0])} />
                                    <div className="flex flex-col gap-2">
                                        <Button type="button" variant="outline" data-testid="society-upload-logo"
                                            onClick={() => logoRef.current?.click()} disabled={uploading.logo}
                                            className="rounded-full border-brand-line">
                                            <UploadSimple size={14} className="mr-1.5" />
                                            {uploading.logo ? "Uploading..." : logoUrl ? "Replace" : "Upload logo"}
                                        </Button>
                                        {logoUrl && (
                                            <button type="button" data-testid="society-remove-logo"
                                                onClick={() => setForm({ ...form, logo_file_id: "" })}
                                                className="text-xs text-brand-action hover:underline flex items-center gap-1">
                                                <Trash size={12} /> Remove
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </TabsContent>

                        <TabsContent value="payment" className="space-y-4">
                            <div className="space-y-2">
                                <Label>UPI ID</Label>
                                <p className="text-xs text-brand-inkSoft">e.g. <span className="font-mono">society.treasurer@icici</span> — a QR code will be auto-generated on the invoice from this ID.</p>
                                <Input data-testid="society-upi-input" value={form.upi_id}
                                    onChange={(e) => setForm({ ...form, upi_id: e.target.value })}
                                    placeholder="society.treasurer@icici"
                                    className="rounded-sm border-brand-line h-11 font-mono" />
                            </div>
                            <div className="border-t border-brand-line pt-4">
                                <Label>Or upload your own UPI QR image</Label>
                                <p className="text-xs text-brand-inkSoft mt-1">Optional — if you upload one, this image is shown on the invoice instead of the auto-generated QR.</p>
                                <div className="flex items-center gap-4 mt-3">
                                    <div className="w-24 h-24 rounded-sm border border-brand-line bg-brand-bg flex items-center justify-center overflow-hidden">
                                        {qrUrl ? <img src={qrUrl} alt="qr" className="w-full h-full object-contain" data-testid="society-qr-preview" />
                                            : <QrCode size={30} className="text-brand-inkSoft" />}
                                    </div>
                                    <input ref={qrRef} type="file" accept="image/*" className="hidden"
                                        onChange={(e) => e.target.files?.[0] && uploadFile("qr", e.target.files[0])} />
                                    <div className="flex flex-col gap-2">
                                        <Button type="button" variant="outline" data-testid="society-upload-qr"
                                            onClick={() => qrRef.current?.click()} disabled={uploading.qr}
                                            className="rounded-full border-brand-line">
                                            <UploadSimple size={14} className="mr-1.5" />
                                            {uploading.qr ? "Uploading..." : qrUrl ? "Replace" : "Upload QR image"}
                                        </Button>
                                        {qrUrl && (
                                            <button type="button" data-testid="society-remove-qr"
                                                onClick={() => setForm({ ...form, upi_qr_file_id: "" })}
                                                className="text-xs text-brand-action hover:underline flex items-center gap-1">
                                                <Trash size={12} /> Remove
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </TabsContent>

                        <TabsContent value="bank" className="space-y-4">
                            <p className="text-sm text-brand-inkSoft">Shown on the invoice so residents can do a direct NEFT/RTGS/IMPS transfer.</p>
                            <div className="space-y-2">
                                <Label>Account holder name</Label>
                                <Input data-testid="society-bank-holder-input" value={form.bank_account_holder}
                                    onChange={(e) => setForm({ ...form, bank_account_holder: e.target.value })}
                                    placeholder="Green Valley Residency Welfare Association"
                                    className="rounded-sm border-brand-line h-11" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label>Bank name</Label>
                                    <Input data-testid="society-bank-name-input" value={form.bank_name}
                                        onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                                        placeholder="ICICI Bank"
                                        className="rounded-sm border-brand-line h-11" />
                                </div>
                                <div className="space-y-2">
                                    <Label>IFSC</Label>
                                    <Input data-testid="society-bank-ifsc-input" value={form.bank_ifsc}
                                        onChange={(e) => setForm({ ...form, bank_ifsc: e.target.value.toUpperCase() })}
                                        placeholder="ICIC0001234"
                                        className="rounded-sm border-brand-line h-11 font-mono" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Account number</Label>
                                <Input data-testid="society-bank-account-input" value={form.bank_account_number}
                                    onChange={(e) => setForm({ ...form, bank_account_number: e.target.value })}
                                    placeholder="0123 4567 8901 2345"
                                    className="rounded-sm border-brand-line h-11 font-mono" />
                            </div>
                        </TabsContent>

                        <TabsContent value="penalty" className="space-y-4">
                            <div className="bg-brand-sage/40 border border-brand-line rounded-sm p-4">
                                <p className="text-sm text-brand-ink">
                                    Auto-apply a late fee once an invoice crosses its due date. Choose a one-time fixed amount, or an amount that accrues per day of delay.
                                </p>
                            </div>

                            <label className="flex items-center gap-3 cursor-pointer select-none">
                                <input
                                    data-testid="penalty-enabled-toggle"
                                    type="checkbox"
                                    checked={form.penalty_enabled}
                                    onChange={(e) => setForm({ ...form, penalty_enabled: e.target.checked })}
                                    className="h-4 w-4"
                                />
                                <span className="text-sm text-brand-ink font-medium">Enable late-payment penalty</span>
                            </label>

                            <div className={form.penalty_enabled ? "space-y-4" : "space-y-4 opacity-50 pointer-events-none"}>
                                <div className="space-y-2">
                                    <Label>Penalty mode</Label>
                                    <div className="grid grid-cols-2 gap-3">
                                        {[
                                            { v: "fixed", label: "Fixed", hint: "One-time fee once overdue" },
                                            { v: "per_day", label: "Per day", hint: "Accrues each day past due date" },
                                        ].map(opt => (
                                            <button
                                                key={opt.v}
                                                type="button"
                                                data-testid={`penalty-mode-${opt.v}`}
                                                onClick={() => setForm({ ...form, penalty_mode: opt.v })}
                                                className={`rounded-sm border p-3 text-left transition-colors ${
                                                    form.penalty_mode === opt.v
                                                        ? "border-brand-ink bg-brand-ink text-white"
                                                        : "border-brand-line bg-white text-brand-ink hover:border-brand-ink"
                                                }`}
                                            >
                                                <p className="font-heading text-base">{opt.label}</p>
                                                <p className={`text-xs mt-0.5 ${form.penalty_mode === opt.v ? "text-white/70" : "text-brand-inkSoft"}`}>{opt.hint}</p>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-2">
                                        <Label>{form.penalty_mode === "per_day" ? "Amount per day (₹)" : "Fixed amount (₹)"}</Label>
                                        <Input
                                            data-testid="penalty-amount-input"
                                            type="number"
                                            min={0}
                                            step="0.01"
                                            value={form.penalty_amount}
                                            onChange={(e) => setForm({ ...form, penalty_amount: e.target.value })}
                                            placeholder={form.penalty_mode === "per_day" ? "10" : "100"}
                                            className="rounded-sm border-brand-line h-11 font-mono"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Max cap (₹) {form.penalty_mode === "fixed" && <span className="text-xs text-brand-inkSoft">— ignored for fixed</span>}</Label>
                                        <Input
                                            data-testid="penalty-max-input"
                                            type="number"
                                            min={0}
                                            step="0.01"
                                            value={form.penalty_max}
                                            onChange={(e) => setForm({ ...form, penalty_max: e.target.value })}
                                            placeholder="0 = no cap"
                                            className="rounded-sm border-brand-line h-11 font-mono"
                                        />
                                    </div>
                                </div>

                                <div className="bg-white border border-brand-line rounded-sm p-3 text-xs text-brand-inkSoft">
                                    <p className="text-brand-ink font-medium mb-1">Preview</p>
                                    {form.penalty_enabled && Number(form.penalty_amount) > 0 ? (
                                        form.penalty_mode === "fixed" ? (
                                            <p>An overdue invoice gets a one-time <b>₹{Number(form.penalty_amount).toLocaleString("en-IN")}</b> late fee added.</p>
                                        ) : (
                                            <p>An overdue invoice accrues <b>₹{Number(form.penalty_amount).toLocaleString("en-IN")}/day</b>{Number(form.penalty_max) > 0 ? <> capped at <b>₹{Number(form.penalty_max).toLocaleString("en-IN")}</b></> : ""}.</p>
                                        )
                                    ) : (
                                        <p>No penalty will be applied.</p>
                                    )}
                                    <p className="mt-2">The late fee is frozen on the invoice at the moment it's marked paid, so residents & auditors see the exact amount collected.</p>
                                </div>
                            </div>
                        </TabsContent>
                    </Tabs>

                    <DialogFooter className="mt-6">
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
