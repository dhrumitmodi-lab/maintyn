import React from "react";

export function PageHeader({ overline, title, description, actions }) {
    return (
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
            <div>
                {overline && <p className="text-xs uppercase tracking-overline text-brand-action">{overline}</p>}
                <h1 className="font-heading text-3xl lg:text-4xl tracking-tight text-brand-ink mt-1">{title}</h1>
                {description && <p className="text-brand-inkSoft mt-2 max-w-xl leading-relaxed">{description}</p>}
            </div>
            {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
    );
}

export function StatCard({ label, value, hint, accent }) {
    return (
        <div className="bg-white border border-brand-line rounded-sm p-6 hover:-translate-y-1 hover:shadow-lg transition-transform duration-200 h-full">
            <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft">{label}</p>
            <p className={`font-heading text-3xl tracking-tight mt-3 ${accent ? "text-brand-action" : "text-brand-ink"}`}>{value}</p>
            {hint && <p className="text-xs text-brand-inkSoft mt-2">{hint}</p>}
        </div>
    );
}

export function EmptyState({ title, description, image, action }) {
    return (
        <div className="border border-dashed border-brand-line rounded-sm bg-white p-10 text-center">
            {image && <img src={image} alt="" className="mx-auto max-h-40 rounded-sm object-cover mb-6 opacity-90" />}
            <h3 className="font-heading text-xl text-brand-ink">{title}</h3>
            {description && <p className="text-brand-inkSoft mt-2 max-w-md mx-auto">{description}</p>}
            {action && <div className="mt-6">{action}</div>}
        </div>
    );
}

export function Chip({ children, variant = "default" }) {
    const styles = {
        default: "bg-brand-sage text-brand-ink",
        warn: "bg-[#FFE9C7] text-[#7A4A00]",
        success: "bg-[#D4EBD9] text-[#1F5B32]",
        danger: "bg-[#F5D6CE] text-[#7A2A18]",
        neutral: "bg-brand-line text-brand-ink",
    };
    return (
        <span className={`inline-flex items-center rounded-full text-[10px] uppercase tracking-overline px-2.5 py-1 font-medium ${styles[variant] || styles.default}`}>
            {children}
        </span>
    );
}
