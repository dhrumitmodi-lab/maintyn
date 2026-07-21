import React from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import Logo from "@/components/Logo";
import { Buildings, Receipt, ChatCircleDots, IdentificationBadge, Megaphone, CurrencyInr } from "@phosphor-icons/react";

const FEATURES = [
    { icon: Buildings, title: "Flats & residents", desc: "Add, remove, and assign residents to flats with a single source of truth." },
    { icon: Receipt, title: "Invoices", desc: "Raise maintenance bills per flat or in bulk. Track paid & pending." },
    { icon: CurrencyInr, title: "Expenses", desc: "Upload receipts, categorize spending, keep the books transparent." },
    { icon: ChatCircleDots, title: "Complaints", desc: "Residents raise tickets. Committee resolves. Everyone sees status." },
    { icon: Megaphone, title: "Notices", desc: "Broadcast announcements to every household — no more WhatsApp chaos." },
    { icon: IdentificationBadge, title: "Visitors", desc: "Log check-ins & check-outs. Know who's on the premises." },
];

export default function Landing() {
    return (
        <div className="min-h-screen bg-brand-bg">
            <header className="border-b border-brand-line bg-white">
                <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
                    <Logo />
                    <div className="flex items-center gap-2">
                        <Link to="/login">
                            <Button variant="ghost" data-testid="landing-signin" className="rounded-full text-brand-ink hover:bg-brand-sage">
                                Sign in
                            </Button>
                        </Link>
                        <Link to="/register">
                            <Button data-testid="landing-signup" className="rounded-full bg-brand-action hover:bg-brand-actionHover text-white active:scale-[0.98] transition-colors">
                                Get started
                            </Button>
                        </Link>
                    </div>
                </div>
            </header>

            <section className="max-w-6xl mx-auto px-6 py-16 lg:py-24 grid lg:grid-cols-2 gap-12 items-center">
                <div className="animate-fade-up">
                    <p className="text-xs uppercase tracking-overline text-brand-action">Community operating system</p>
                    <h1 className="font-heading font-bold text-4xl sm:text-5xl lg:text-6xl leading-none tracking-tight text-brand-ink mt-4">
                        The calm way to run
                        <br />
                        <span className="text-brand-action">your society.</span>
                    </h1>
                    <p className="mt-6 text-lg text-brand-inkSoft leading-relaxed max-w-lg">
                        maintyn brings flats, invoices, expenses, complaints, notices and visitors into one clean workspace — for committees and residents alike.
                    </p>
                    <div className="mt-8 flex flex-wrap gap-3">
                        <Link to="/register">
                            <Button data-testid="hero-cta-primary" className="rounded-full h-12 px-6 bg-brand-action hover:bg-brand-actionHover text-white active:scale-[0.98]">
                                Start free
                            </Button>
                        </Link>
                        <Link to="/login">
                            <Button variant="outline" data-testid="hero-cta-secondary" className="rounded-full h-12 px-6 border-brand-ink text-brand-ink hover:bg-brand-ink hover:text-white transition-colors">
                                Sign in
                            </Button>
                        </Link>
                    </div>
                </div>
                <div className="relative">
                    <img
                        src="https://images.unsplash.com/photo-1624204386084-dd8c05e32226?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTJ8MHwxfHNlYXJjaHwzfHxtb2Rlcm4lMjByZXNpZGVudGlhbCUyMGFwYXJ0bWVudCUyMGJ1aWxkaW5nJTIwZXh0ZXJpb3J8ZW58MHx8fHwxNzg0NjIzMzM0fDA&ixlib=rb-4.1.0&q=85"
                        alt="Residential building"
                        className="w-full h-[420px] lg:h-[520px] object-cover rounded-sm border border-brand-line"
                    />
                    <div className="absolute -bottom-4 -left-4 bg-white border border-brand-line rounded-sm p-4 max-w-[240px] shadow-lg">
                        <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft">Collected this month</p>
                        <p className="font-heading text-2xl text-brand-ink tracking-tight mt-1">₹4,82,000</p>
                        <div className="flex items-center gap-2 mt-2">
                            <div className="h-1.5 flex-1 bg-brand-line rounded-full overflow-hidden">
                                <div className="h-full w-4/5 bg-brand-action" />
                            </div>
                            <span className="text-xs text-brand-inkSoft">82%</span>
                        </div>
                    </div>
                </div>
            </section>

            <section className="max-w-6xl mx-auto px-6 py-16 border-t border-brand-line">
                <p className="text-xs uppercase tracking-overline text-brand-action">Everything you need</p>
                <h2 className="font-heading text-3xl lg:text-4xl tracking-tight text-brand-ink mt-3 max-w-xl">
                    A dashboard for the committee, a home for residents.
                </h2>
                <div className="mt-10 grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {FEATURES.map((f) => {
                        const Icon = f.icon;
                        return (
                            <div key={f.title} className="border border-brand-line bg-white rounded-sm p-6 hover:-translate-y-1 hover:shadow-lg transition-transform duration-200">
                                <div className="w-10 h-10 rounded-sm bg-brand-sage flex items-center justify-center text-brand-ink">
                                    <Icon size={22} weight="duotone" />
                                </div>
                                <h3 className="font-heading text-lg mt-4 text-brand-ink">{f.title}</h3>
                                <p className="text-sm text-brand-inkSoft mt-2 leading-relaxed">{f.desc}</p>
                            </div>
                        );
                    })}
                </div>
            </section>

            <footer className="max-w-6xl mx-auto px-6 py-10 border-t border-brand-line flex items-center justify-between text-xs text-brand-inkSoft">
                <span>© {new Date().getFullYear()} maintyn</span>
                <span className="uppercase tracking-overline">Community OS</span>
            </footer>
        </div>
    );
}
