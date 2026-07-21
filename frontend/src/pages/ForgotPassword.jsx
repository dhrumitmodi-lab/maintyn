import React, { useState } from "react";
import { Link } from "react-router-dom";
import api, { formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import Logo from "@/components/Logo";

export default function ForgotPassword() {
    const [email, setEmail] = useState("");
    const [sent, setSent] = useState(false);
    const [busy, setBusy] = useState(false);

    async function onSubmit(e) {
        e.preventDefault();
        setBusy(true);
        try {
            await api.post("/auth/forgot-password", { email });
            setSent(true);
            toast.success("Check your inbox");
        } catch (err) {
            toast.error(formatError(err));
        } finally { setBusy(false); }
    }

    return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-brand-bg">
            <div className="w-full max-w-sm animate-fade-up">
                <div className="mb-8"><Logo /></div>
                <p className="text-xs uppercase tracking-overline text-brand-inkSoft">Password reset</p>
                <h2 className="font-heading text-3xl tracking-tight text-brand-ink mt-1">Forgot password?</h2>
                <p className="text-brand-inkSoft mt-2 leading-relaxed">
                    Enter your email and we'll send a reset link.
                </p>
                {sent ? (
                    <div className="mt-8 rounded-sm border border-brand-line bg-white p-6">
                        <p className="text-brand-ink">If <b>{email}</b> matches an account, a reset link has been sent. Please check your inbox (and spam).</p>
                        <Link to="/login" data-testid="forgot-back-login" className="text-brand-action font-medium hover:underline mt-4 inline-block">← Back to sign in</Link>
                    </div>
                ) : (
                    <form onSubmit={onSubmit} className="mt-8 space-y-5">
                        <div className="space-y-2">
                            <Label className="text-xs uppercase tracking-overline text-brand-inkSoft">Email</Label>
                            <Input data-testid="forgot-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                                placeholder="you@society.com" className="rounded-sm border-brand-line bg-white h-11" />
                        </div>
                        <Button type="submit" data-testid="forgot-submit" disabled={busy}
                            className="w-full h-11 rounded-full bg-brand-action hover:bg-brand-actionHover text-white font-medium">
                            {busy ? "Sending..." : "Send reset link"}
                        </Button>
                    </form>
                )}
                <p className="mt-6 text-sm text-brand-inkSoft">
                    Remembered it?{" "}
                    <Link to="/login" className="text-brand-action font-medium hover:underline">Sign in</Link>
                </p>
            </div>
        </div>
    );
}
