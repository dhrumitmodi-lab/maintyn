import React from "react";

export function Logo({ className = "" }) {
    return (
        <div className={`inline-flex items-center gap-2 ${className}`}>
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
                <rect x="2" y="10" width="28" height="20" rx="1" fill="#1B3127" />
                <path d="M2 10 L16 2 L30 10" stroke="#1B3127" strokeWidth="2" strokeLinejoin="round" fill="none" />
                <rect x="7" y="16" width="4" height="6" fill="#C85A3C" />
                <rect x="14" y="16" width="4" height="6" fill="#DDECE5" />
                <rect x="21" y="16" width="4" height="6" fill="#DDECE5" />
            </svg>
            <span className="font-heading font-bold text-xl tracking-tight text-brand-ink">
                maintyn
            </span>
        </div>
    );
}

export default Logo;
