import React, { useRef, useState } from "react";
import api, { formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { UploadSimple, DownloadSimple } from "@phosphor-icons/react";
import { toast } from "sonner";

export default function CsvImport({ open, onOpenChange, endpoint, title, template, columns, onDone }) {
    const fileRef = useRef();
    const [file, setFile] = useState(null);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);

    function downloadTemplate() {
        const blob = new Blob([template], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${title.toLowerCase().replace(/\s+/g, "-")}-template.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    async function upload() {
        if (!file) return;
        setBusy(true);
        try {
            const fd = new FormData();
            fd.append("file", file);
            const { data } = await api.post(endpoint, fd, { headers: { "Content-Type": "multipart/form-data" } });
            setResult(data);
            toast.success(`${data.created} created · ${data.skipped} skipped`);
            onDone?.();
        } catch (e) { toast.error(formatError(e)); }
        finally { setBusy(false); }
    }

    function close() {
        setFile(null); setResult(null);
        onOpenChange(false);
    }

    return (
        <Dialog open={open} onOpenChange={(v) => (!v ? close() : onOpenChange(v))}>
            <DialogContent className="rounded-sm max-w-lg">
                <DialogHeader>
                    <DialogTitle className="font-heading text-2xl tracking-tight">{title}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="bg-brand-sage/50 border border-brand-line rounded-sm p-4 text-sm">
                        <p className="font-medium text-brand-ink">CSV columns</p>
                        <p className="text-brand-inkSoft mt-1 font-mono text-xs">{columns}</p>
                        <button data-testid="csv-download-template" onClick={downloadTemplate}
                            className="mt-3 inline-flex items-center gap-1 text-brand-action text-xs hover:underline">
                            <DownloadSimple size={14} /> Download template
                        </button>
                    </div>
                    <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
                        onChange={(e) => setFile(e.target.files?.[0] || null)} />
                    <Button data-testid="csv-pick-file" type="button" variant="outline" onClick={() => fileRef.current?.click()}
                        className="rounded-full border-brand-line w-full">
                        <UploadSimple size={14} className="mr-1.5" />
                        {file ? file.name : "Choose a CSV file"}
                    </Button>

                    {result && (
                        <div className="border border-brand-line rounded-sm p-4 text-sm bg-white">
                            <p><b>{result.created}</b> created · <b>{result.skipped}</b> skipped</p>
                            {result.errors?.length > 0 && (
                                <details className="mt-2">
                                    <summary className="text-brand-action cursor-pointer text-xs">{result.errors.length} error(s)</summary>
                                    <ul className="mt-2 text-xs text-brand-inkSoft space-y-1 max-h-40 overflow-y-auto">
                                        {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                                    </ul>
                                </details>
                            )}
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={close} className="rounded-full">Close</Button>
                    <Button type="button" data-testid="csv-upload-submit" disabled={!file || busy} onClick={upload}
                        className="rounded-full bg-brand-action hover:bg-brand-actionHover">
                        {busy ? "Uploading..." : "Import"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
