import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import Logo from "@/components/Logo";

export default function Register() {
    const { register } = useAuth();
    const nav = useNavigate();
    const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
    const [busy, setBusy] = useState(false);

    async function onSubmit(e) {
        e.preventDefault();
        setBusy(true);
        try {
            await register(form);
            toast.success("Welcome to maintyn");
            nav("/app");
        } catch (err) {
            toast.error(formatError(err));
        } finally {
            setBusy(false);
        }
    }

    const upd = (k) => (e) => setForm({ ...form, [k]: e.target.value });

    return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-brand-bg">
            <div className="w-full max-w-md animate-fade-up">
                <div className="mb-8"><Logo /></div>
                <p className="text-xs uppercase tracking-overline text-brand-inkSoft">Create account</p>
                <h2 className="font-heading text-3xl tracking-tight text-brand-ink mt-1">Join your community.</h2>
                <p className="text-brand-inkSoft mt-2 leading-relaxed">
                    Sign up as a resident. Your committee will assign you a flat.
                </p>

                <form onSubmit={onSubmit} className="mt-8 space-y-4">
                    <div className="space-y-2">
                        <Label className="text-xs uppercase tracking-overline text-brand-inkSoft">Full name</Label>
                        <Input data-testid="register-name" required value={form.name} onChange={upd("name")} className="rounded-sm border-brand-line bg-white h-11" />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-xs uppercase tracking-overline text-brand-inkSoft">Email</Label>
                        <Input data-testid="register-email" type="email" required value={form.email} onChange={upd("email")} className="rounded-sm border-brand-line bg-white h-11" />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-xs uppercase tracking-overline text-brand-inkSoft">Phone</Label>
                        <Input data-testid="register-phone" value={form.phone} onChange={upd("phone")} className="rounded-sm border-brand-line bg-white h-11" />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-xs uppercase tracking-overline text-brand-inkSoft">Password</Label>
                        <Input data-testid="register-password" type="password" required minLength={6} value={form.password} onChange={upd("password")} className="rounded-sm border-brand-line bg-white h-11" />
                    </div>
                    <Button type="submit" data-testid="register-submit" disabled={busy}
                        className="w-full h-11 rounded-full bg-brand-action hover:bg-brand-actionHover text-white font-medium active:scale-[0.98] transition-colors duration-200">
                        {busy ? "Creating account..." : "Create account"}
                    </Button>
                </form>

                <p className="mt-6 text-sm text-brand-inkSoft">
                    Already have an account?{" "}
                    <Link to="/login" data-testid="register-goto-login" className="text-brand-action font-medium hover:underline">Sign in</Link>
                </p>
            </div>
        </div>
    );
}
