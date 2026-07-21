import React, { useEffect, useMemo, useState } from "react";
import api, { formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, EmptyState, Chip } from "@/components/Shared";
import { Input } from "@/components/ui/input";
import { Phone, EnvelopeSimple, MagnifyingGlass, Crown, Users as UsersIcon } from "@phosphor-icons/react";
import { toast } from "sonner";

export default function Directory() {
    const { user } = useAuth();
    const [committee, setCommittee] = useState([]);
    const [members, setMembers] = useState([]);
    const [q, setQ] = useState("");

    useEffect(() => {
        (async () => {
            try {
                const [c, d] = await Promise.all([api.get("/committee"), api.get("/directory")]);
                setCommittee(c.data);
                setMembers(d.data);
            } catch (e) { toast.error(formatError(e)); }
        })();
    }, []);

    const filtered = useMemo(() => {
        const t = q.trim().toLowerCase();
        if (!t) return members;
        return members.filter((m) =>
            [m.name, m.email, m.phone || "", m.flat_label || "", m.role].join(" ").toLowerCase().includes(t)
        );
    }, [members, q]);

    return (
        <div className="animate-fade-up">
            <PageHeader
                overline="Contacts"
                title="Member directory"
                description="Meet your committee and find any resident by name, flat or role."
            />

            {/* Committee cards */}
            <div className="mb-10">
                <div className="flex items-center gap-2 mb-4">
                    <Crown size={18} weight="duotone" className="text-brand-action" />
                    <h2 className="font-heading text-xl text-brand-ink">Your committee</h2>
                    <span className="text-xs text-brand-inkSoft">— reach out for any concern</span>
                </div>
                {committee.length === 0 ? (
                    <EmptyState title="No committee members yet" description="Ask your admin to promote a resident to the committee." />
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {committee.map((m) => (
                            <div key={m.id} data-testid={`committee-card-${m.id}`}
                                className="bg-white border border-brand-line rounded-sm p-5 hover:-translate-y-1 hover:shadow-lg transition-transform duration-200">
                                <div className="flex items-start justify-between">
                                    <div className="min-w-0">
                                        <p className="font-heading text-lg text-brand-ink truncate">{m.name}</p>
                                        <p className="text-xs text-brand-inkSoft mt-0.5">{m.flat_label ? `Flat ${m.flat_label}` : "—"}</p>
                                    </div>
                                    <Chip variant={m.role === "admin" ? "danger" : "warn"}>{m.role}</Chip>
                                </div>
                                <div className="mt-4 space-y-2 text-sm">
                                    <a href={`mailto:${m.email}`} className="flex items-center gap-2 text-brand-ink hover:text-brand-action group">
                                        <EnvelopeSimple size={16} className="text-brand-inkSoft group-hover:text-brand-action" /> {m.email}
                                    </a>
                                    {m.phone && (
                                        <a href={`tel:${m.phone}`} className="flex items-center gap-2 text-brand-ink hover:text-brand-action group">
                                            <Phone size={16} className="text-brand-inkSoft group-hover:text-brand-action" /> {m.phone}
                                        </a>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* All members */}
            <div>
                <div className="flex items-center gap-2 mb-4">
                    <UsersIcon size={18} weight="duotone" className="text-brand-ink" />
                    <h2 className="font-heading text-xl text-brand-ink">All members</h2>
                    <span className="text-xs text-brand-inkSoft">— {members.length} total</span>
                </div>
                <div className="relative mb-4 max-w-sm">
                    <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-inkSoft" />
                    <Input data-testid="directory-search" value={q} onChange={(e) => setQ(e.target.value)}
                        placeholder="Search by name, flat, phone..." className="pl-9 rounded-sm border-brand-line bg-white h-10" />
                </div>
                {filtered.length === 0 ? (
                    <EmptyState title="No matches" description="Try a different search." />
                ) : (
                    <div className="bg-white border border-brand-line rounded-sm overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-brand-bg border-b border-brand-line text-left">
                                    {["Name", "Role", "Flat", "Email", "Phone"].map(h => (
                                        <th key={h} className="py-3 px-4 font-medium text-brand-inkSoft text-[10px] uppercase tracking-overline">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((m) => (
                                    <tr key={m.id} data-testid={`directory-row-${m.id}`} className="border-b border-brand-line/60 hover:bg-brand-bg/50">
                                        <td className="py-3 px-4 font-medium text-brand-ink">{m.name}</td>
                                        <td className="py-3 px-4"><Chip variant={m.role === "admin" ? "danger" : m.role === "committee" ? "warn" : "default"}>{m.role}</Chip></td>
                                        <td className="py-3 px-4 text-brand-inkSoft">{m.flat_label || "—"}</td>
                                        <td className="py-3 px-4 text-brand-inkSoft"><a href={`mailto:${m.email}`} className="hover:text-brand-action">{m.email}</a></td>
                                        <td className="py-3 px-4 text-brand-inkSoft">{m.phone ? <a href={`tel:${m.phone}`} className="hover:text-brand-action">{m.phone}</a> : "—"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
