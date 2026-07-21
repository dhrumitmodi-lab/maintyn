import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api, { formatError } from "@/lib/api";
import { useSociety } from "@/context/SocietyContext";
import { fileDownloadUrl } from "@/lib/files";
import { Button } from "@/components/ui/button";
import QRCode from "react-qr-code";
import { Printer, ArrowLeft, Copy } from "@phosphor-icons/react";
import { toast } from "sonner";

const inr = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);

function buildUpiIntent(vpa, name, amount, note) {
    if (!vpa) return null;
    const params = new URLSearchParams();
    params.set("pa", vpa);
    if (name) params.set("pn", name);
    if (amount) params.set("am", String(amount));
    params.set("cu", "INR");
    if (note) params.set("tn", note);
    return `upi://pay?${params.toString()}`;
}

export default function InvoiceView() {
    const { id } = useParams();
    const nav = useNavigate();
    const { society } = useSociety();
    const [invoice, setInvoice] = useState(null);
    const [resident, setResident] = useState(null);

    useEffect(() => {
        (async () => {
            try {
                const { data } = await api.get("/invoices");
                const inv = data.find((x) => x.id === id);
                if (!inv) { toast.error("Invoice not found"); nav("/app/invoices"); return; }
                setInvoice(inv);
                // Best-effort resident name for the flat
                try {
                    const flats = await api.get("/flats");
                    const flat = flats.data.find((f) => f.id === inv.flat_id);
                    if (flat?.residents?.length) setResident(flat.residents[0]);
                } catch {}
            } catch (e) { toast.error(formatError(e)); }
        })();
    }, [id, nav]);

    if (!invoice) return <div className="p-6 text-brand-inkSoft text-sm">Loading invoice…</div>;

    const penalty = Number(invoice.penalty || 0);
    const totalDue = Number(invoice.total_due ?? invoice.amount);
    const logoUrl = fileDownloadUrl(society?.logo_file_id);
    const qrUploadedUrl = fileDownloadUrl(society?.upi_qr_file_id);
    const upiIntent = buildUpiIntent(
        society?.upi_id,
        society?.name,
        invoice.status === "paid" ? null : totalDue,
        `${invoice.description} ${invoice.month}`
    );
    const invoiceNumber = `INV-${(invoice.id || "").slice(0, 8).toUpperCase()}`;

    function copyText(t, label) {
        navigator.clipboard.writeText(t);
        toast.success(`${label} copied`);
    }

    return (
        <div className="animate-fade-up">
            <div className="flex items-center justify-between mb-6 print:hidden">
                <button data-testid="invoice-back-btn" onClick={() => nav("/app/invoices")}
                    className="text-sm text-brand-inkSoft hover:text-brand-ink inline-flex items-center gap-1">
                    <ArrowLeft size={16} /> Back to invoices
                </button>
                <Button data-testid="invoice-print-btn" onClick={() => window.print()}
                    className="rounded-full bg-brand-ink hover:bg-brand-forest text-white">
                    <Printer size={16} className="mr-1.5" /> Print / Save PDF
                </Button>
            </div>

            <article data-testid="invoice-sheet"
                className="max-w-3xl mx-auto bg-white border border-brand-line rounded-sm p-8 md:p-12 print:border-0 print:p-6 print:max-w-none">
                {/* Header */}
                <header className="flex items-start justify-between gap-6 border-b border-brand-line pb-6">
                    <div className="flex items-start gap-4">
                        {logoUrl ? (
                            <img src={logoUrl} alt="logo" data-testid="invoice-society-logo"
                                className="w-16 h-16 object-contain rounded-sm border border-brand-line" />
                        ) : (
                            <div className="w-16 h-16 rounded-sm bg-brand-sage flex items-center justify-center">
                                <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
                                    <rect x="2" y="10" width="28" height="20" rx="1" fill="#1B3127" />
                                    <path d="M2 10 L16 2 L30 10" stroke="#1B3127" strokeWidth="2" strokeLinejoin="round" fill="none" />
                                    <rect x="7" y="16" width="4" height="6" fill="#C85A3C" />
                                    <rect x="14" y="16" width="4" height="6" fill="#DDECE5" />
                                    <rect x="21" y="16" width="4" height="6" fill="#DDECE5" />
                                </svg>
                            </div>
                        )}
                        <div>
                            <h1 className="font-heading text-2xl text-brand-ink tracking-tight" data-testid="invoice-society-name">{society?.name || "Society"}</h1>
                            {society?.address && <p className="text-sm text-brand-inkSoft mt-1">{society.address}{society.city ? `, ${society.city}` : ""}</p>}
                            <div className="text-xs text-brand-inkSoft mt-1 space-x-2">
                                {society?.contact_email && <span>{society.contact_email}</span>}
                                {society?.contact_phone && <span>· {society.contact_phone}</span>}
                            </div>
                        </div>
                    </div>
                    <div className="text-right">
                        <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft">Invoice</p>
                        <p className="font-heading text-lg text-brand-ink font-mono">{invoiceNumber}</p>
                        <p className="text-xs text-brand-inkSoft mt-2">Date: {new Date(invoice.created_at).toLocaleDateString()}</p>
                        <p className="text-xs text-brand-inkSoft">Due: {invoice.due_date}</p>
                        <span className={`inline-block mt-2 rounded-full px-3 py-1 text-[10px] uppercase tracking-overline font-medium ${
                            invoice.status === "paid" ? "bg-[#D4EBD9] text-[#1F5B32]" : "bg-[#FFE9C7] text-[#7A4A00]"
                        }`} data-testid="invoice-status-chip">{invoice.status}</span>
                    </div>
                </header>

                {/* Bill to */}
                <section className="grid md:grid-cols-2 gap-6 py-6 border-b border-brand-line">
                    <div>
                        <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft">Bill to</p>
                        <p className="font-medium text-brand-ink mt-1">Flat {invoice.flat?.block}-{invoice.flat?.number}</p>
                        {resident && <p className="text-sm text-brand-inkSoft">{resident.name}</p>}
                        <p className="text-xs text-brand-inkSoft mt-1">{invoice.flat?.floor && `Floor ${invoice.flat.floor} · `}{invoice.flat?.bhk}</p>
                    </div>
                    <div>
                        <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft">Billing period</p>
                        <p className="font-medium text-brand-ink mt-1">{invoice.month}</p>
                    </div>
                </section>

                {/* Line items */}
                <section className="py-6 border-b border-brand-line">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-brand-line">
                                <th className="text-left py-2 text-[10px] uppercase tracking-overline text-brand-inkSoft">Description</th>
                                <th className="text-right py-2 text-[10px] uppercase tracking-overline text-brand-inkSoft">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td className="py-3 text-brand-ink">{invoice.description}</td>
                                <td className="py-3 text-right font-heading text-brand-ink">{inr(invoice.amount)}</td>
                            </tr>
                            {penalty > 0 && (
                                <tr data-testid="invoice-penalty-row">
                                    <td className="py-3 text-[#7A2A18]">
                                        Late-payment fee
                                        <span className="block text-[10px] uppercase tracking-overline text-brand-inkSoft mt-0.5">
                                            {invoice.status === "paid" ? "Frozen at time of payment" : `Overdue past ${invoice.due_date}`}
                                        </span>
                                    </td>
                                    <td className="py-3 text-right font-heading text-[#7A2A18]">{inr(penalty)}</td>
                                </tr>
                            )}
                        </tbody>
                        <tfoot>
                            <tr className="border-t border-brand-ink">
                                <td className="pt-4 font-heading text-brand-ink">Total {invoice.status === "paid" ? "paid" : "due"}</td>
                                <td className="pt-4 text-right font-heading text-2xl text-brand-ink" data-testid="invoice-total">{inr(totalDue)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </section>

                {/* Payment section */}
                {invoice.status !== "paid" && (
                    <section className="py-6 grid md:grid-cols-2 gap-6">
                        {/* UPI */}
                        {(society?.upi_id || qrUploadedUrl) && (
                            <div data-testid="invoice-upi-section">
                                <p className="text-[10px] uppercase tracking-overline text-brand-action">Pay via UPI</p>
                                <p className="font-heading text-lg text-brand-ink mt-1 mb-3">Scan &amp; pay</p>
                                <div className="flex items-start gap-4">
                                    <div className="bg-white p-2 border border-brand-line rounded-sm">
                                        {qrUploadedUrl ? (
                                            <img src={qrUploadedUrl} alt="UPI QR" className="w-32 h-32 object-contain" data-testid="invoice-qr-uploaded" />
                                        ) : upiIntent ? (
                                            <div data-testid="invoice-qr-generated">
                                                <QRCode value={upiIntent} size={128} bgColor="#ffffff" fgColor="#1B3127" />
                                            </div>
                                        ) : null}
                                    </div>
                                    <div className="text-sm space-y-1 min-w-0">
                                        {society?.upi_id && (
                                            <div>
                                                <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft">UPI ID</p>
                                                <button data-testid="invoice-copy-upi" type="button"
                                                    onClick={() => copyText(society.upi_id, "UPI ID")}
                                                    className="font-mono text-brand-ink hover:text-brand-action inline-flex items-center gap-1 text-sm break-all">
                                                    {society.upi_id} <Copy size={12} className="shrink-0" />
                                                </button>
                                            </div>
                                        )}
                                        <p className="text-xs text-brand-inkSoft pt-2">
                                            Scan with any UPI app (GPay, PhonePe, Paytm) — amount and reference are pre-filled.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Bank details */}
                        {(society?.bank_account_number || society?.bank_name) && (
                            <div data-testid="invoice-bank-section">
                                <p className="text-[10px] uppercase tracking-overline text-brand-action">Bank transfer (NEFT / IMPS / RTGS)</p>
                                <p className="font-heading text-lg text-brand-ink mt-1 mb-3">Direct transfer</p>
                                <div className="text-sm space-y-2 border border-brand-line rounded-sm p-4 bg-brand-bg">
                                    {society?.bank_account_holder && (
                                        <div>
                                            <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft">Account holder</p>
                                            <p className="text-brand-ink">{society.bank_account_holder}</p>
                                        </div>
                                    )}
                                    {society?.bank_name && (
                                        <div>
                                            <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft">Bank</p>
                                            <p className="text-brand-ink">{society.bank_name}</p>
                                        </div>
                                    )}
                                    {society?.bank_account_number && (
                                        <div>
                                            <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft">Account no.</p>
                                            <button data-testid="invoice-copy-account" type="button"
                                                onClick={() => copyText(society.bank_account_number, "Account number")}
                                                className="font-mono text-brand-ink hover:text-brand-action inline-flex items-center gap-1">
                                                {society.bank_account_number} <Copy size={12} />
                                            </button>
                                        </div>
                                    )}
                                    {society?.bank_ifsc && (
                                        <div>
                                            <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft">IFSC</p>
                                            <button data-testid="invoice-copy-ifsc" type="button"
                                                onClick={() => copyText(society.bank_ifsc, "IFSC")}
                                                className="font-mono text-brand-ink hover:text-brand-action inline-flex items-center gap-1">
                                                {society.bank_ifsc} <Copy size={12} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {!society?.upi_id && !qrUploadedUrl && !society?.bank_account_number && (
                            <div className="md:col-span-2 border border-dashed border-brand-line rounded-sm p-4 text-sm text-brand-inkSoft" data-testid="invoice-no-payment-info">
                                Payment details not configured yet. Admin can add UPI ID and bank details from <b>Society settings</b> in the sidebar.
                            </div>
                        )}
                    </section>
                )}

                {invoice.status === "paid" && (
                    <section className="py-6 text-center">
                        <p className="inline-block bg-[#D4EBD9] text-[#1F5B32] rounded-full px-4 py-2 text-sm font-medium">
                            ✓ Paid on {invoice.paid_at ? new Date(invoice.paid_at).toLocaleDateString() : "—"}
                        </p>
                    </section>
                )}

                <footer className="mt-6 pt-4 border-t border-brand-line text-xs text-brand-inkSoft">
                    <p>Please quote invoice reference <b className="font-mono">{invoiceNumber}</b> in your UPI note or bank transfer remark.</p>
                    <p className="mt-1">Generated via maintyn · Community OS</p>
                </footer>
            </article>

            <style>{`
                @media print {
                    body { background: white !important; }
                    aside, header, nav, [data-print-hide], .print\\:hidden { display: none !important; }
                    main { padding: 0 !important; }
                }
            `}</style>
        </div>
    );
}
