import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import api, { formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import Logo from "@/components/Logo";

export default function ResetPassword() {
    const [params] = useSearchParams();
    const nav = useNavigate();
    const token = params.get("token") || "";
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [busy, setBusy] = useState(false);

    async function onSubmit(e) {
        e.preventDefault();
        if (password !== confirm) { toast.error("Passwords do not match"); return; }
        if (!token) { toast.error("Missing reset token"); return; }
        setBusy(true);
        try {
            await api.post("/auth/reset-password", { token, password });
            toast.success("Password updated. Please sign in.");
            nav("/login");
        } catch (err) {
            toast.error(formatError(err));
        } finally { setBusy(false); }
    }

    return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-brand-bg">
            <div className="w-full max-w-sm animate-fade-up">
                <div className="mb-8"><Logo /></div>
                <p className="text-xs uppercase tracking-overline text-brand-inkSoft">Set new password</p>
                <h2 className="font-heading text-3xl tracking-tight text-brand-ink mt-1">Choose a new password</h2>
                {!token && <p className="text-brand-action mt-2 text-sm">This link is missing a token. Please request a new reset email.</p>}

                <form onSubmit={onSubmit} className="mt-8 space-y-5">
                    <div className="space-y-2">
                        <Label className="text-xs uppercase tracking-overline text-brand-inkSoft">New password</Label>
                        <Input data-testid="reset-password" type="password" required minLength={6}
                            value={password} onChange={(e) => setPassword(e.target.value)}
                            className="rounded-sm border-brand-line bg-white h-11" />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-xs uppercase tracking-overline text-brand-inkSoft">Confirm password</Label>
                        <Input data-testid="reset-confirm" type="password" required minLength={6}
                            value={confirm} onChange={(e) => setConfirm(e.target.value)}
                            className="rounded-sm border-brand-line bg-white h-11" />
                    </div>
                    <Button type="submit" data-testid="reset-submit" disabled={busy || !token}
                        className="w-full h-11 rounded-full bg-brand-action hover:bg-brand-actionHover text-white font-medium">
                        {busy ? "Updating..." : "Update password"}
                    </Button>
                </form>
                <p className="mt-6 text-sm text-brand-inkSoft">
                    <Link to="/login" className="text-brand-action font-medium hover:underline">← Back to sign in</Link>
                </p>
            </div>
        </div>
    );
}
