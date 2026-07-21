import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import Logo from "@/components/Logo";

export default function Login() {
    const { login } = useAuth();
    const nav = useNavigate();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);

    async function onSubmit(e) {
        e.preventDefault();
        setBusy(true);
        try {
            await login(email, password);
            toast.success("Welcome back");
            nav("/app");
        } catch (err) {
            toast.error(formatError(err));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="min-h-screen grid lg:grid-cols-2 bg-brand-bg">
            {/* Left: image */}
            <div className="hidden lg:block relative">
                <img
                    src="https://images.unsplash.com/photo-1624204386084-dd8c05e32226?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTJ8MHwxfHNlYXJjaHwzfHxtb2Rlcm4lMjByZXNpZGVudGlhbCUyMGFwYXJ0bWVudCUyMGJ1aWxkaW5nJTIwZXh0ZXJpb3J8ZW58MHx8fHwxNzg0NjIzMzM0fDA&ixlib=rb-4.1.0&q=85"
                    alt="Residential"
                    className="absolute inset-0 w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-[#13241D]/50" />
                <div className="relative z-10 h-full flex flex-col justify-between p-12 text-white">
                    <Link to="/">
                        <div className="flex items-center gap-2">
                            <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
                                <rect x="2" y="10" width="28" height="20" rx="1" fill="#F6F4F1" />
                                <path d="M2 10 L16 2 L30 10" stroke="#F6F4F1" strokeWidth="2" strokeLinejoin="round" fill="none" />
                                <rect x="7" y="16" width="4" height="6" fill="#C85A3C" />
                                <rect x="14" y="16" width="4" height="6" fill="#DDECE5" />
                                <rect x="21" y="16" width="4" height="6" fill="#DDECE5" />
                            </svg>
                            <span className="font-heading font-bold text-2xl tracking-tight">maintyn</span>
                        </div>
                    </Link>
                    <div className="max-w-md">
                        <p className="text-xs uppercase tracking-overline text-[#DDECE5] mb-3">Community OS</p>
                        <h1 className="font-heading text-4xl leading-tight tracking-tight">
                            Run your society like a well-tended garden.
                        </h1>
                        <p className="mt-4 text-white/80 leading-relaxed">
                            Invoices, expenses, notices, complaints and visitors — one clean, calm place for committees and residents.
                        </p>
                    </div>
                </div>
            </div>

            {/* Right: form */}
            <div className="flex items-center justify-center p-6 lg:p-12">
                <div className="w-full max-w-sm animate-fade-up">
                    <div className="lg:hidden mb-8"><Logo /></div>
                    <p className="text-xs uppercase tracking-overline text-brand-inkSoft">Sign in</p>
                    <h2 className="font-heading text-3xl tracking-tight text-brand-ink mt-1">
                        Welcome home.
                    </h2>
                    <p className="text-brand-inkSoft mt-2 leading-relaxed">
                        Access your community dashboard.
                    </p>

                    <form onSubmit={onSubmit} className="mt-8 space-y-5">
                        <div className="space-y-2">
                            <Label htmlFor="email" className="text-xs uppercase tracking-overline text-brand-inkSoft">Email</Label>
                            <Input
                                id="email"
                                data-testid="login-email"
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="you@society.com"
                                className="rounded-sm border-brand-line bg-white h-11 focus-visible:ring-2 focus-visible:ring-brand-action"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="password" className="text-xs uppercase tracking-overline text-brand-inkSoft">Password</Label>
                            <Input
                                id="password"
                                data-testid="login-password"
                                type="password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                className="rounded-sm border-brand-line bg-white h-11 focus-visible:ring-2 focus-visible:ring-brand-action"
                            />
                        </div>
                        <Button
                            type="submit"
                            data-testid="login-submit"
                            disabled={busy}
                            className="w-full h-11 rounded-full bg-brand-action hover:bg-brand-actionHover text-white font-medium transition-colors duration-200 active:scale-[0.98]"
                        >
                            {busy ? "Signing in..." : "Sign in"}
                        </Button>
                    </form>

                    <div className="mt-4 flex items-center justify-between text-sm">
                        <Link to="/forgot-password" data-testid="login-forgot" className="text-brand-inkSoft hover:text-brand-action">
                            Forgot password?
                        </Link>
                    </div>

                    <p className="mt-6 text-sm text-brand-inkSoft">
                        New resident?{" "}
                        <Link to="/register" data-testid="login-goto-register" className="text-brand-action font-medium hover:underline">
                            Create an account
                        </Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
