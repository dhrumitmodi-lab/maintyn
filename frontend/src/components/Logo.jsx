import React from "react";

/**
 * Inline SVG icon that matches the new maintyn house glyph.
 * Supports light/dark backgrounds via the `variant` prop.
 * - "brand" (default): dark green house, cream windows, red chimney (for light backgrounds)
 * - "light": cream house outline, red chimney (for dark backgrounds like the sidebar)
 */
export function LogoIcon({ className = "", size = 28, variant = "brand" }) {
    const stroke = variant === "light" ? "#F6F4F1" : "#1B3127";
    const wallFill = variant === "light" ? "transparent" : "#1B3127";
    const window1 = variant === "light" ? "#F6F4F1" : "#F6F4F1";
    const window2 = variant === "light" ? "#F6F4F1" : "#F6F4F1";
    const chimney = "#C85A3C";
    return (
        <svg
            width={size}
            height={size * (32 / 38)}
            viewBox="0 0 38 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
            aria-hidden="true"
        >
            {/* Chimney */}
            <rect x="24" y="4" width="4" height="6" rx="0.5" fill={chimney} />
            {/* Roof */}
            <path
                d="M3 14 L19 3 L35 14"
                stroke={stroke}
                strokeWidth="2.2"
                strokeLinejoin="round"
                strokeLinecap="round"
                fill="none"
            />
            {/* House body */}
            <rect x="4" y="13" width="30" height="16" rx="1" fill={wallFill} stroke={stroke} strokeWidth="2" />
            {/* Windows */}
            <rect x="9" y="18" width="7" height="7" fill={window1} />
            <rect x="22" y="18" width="7" height="7" fill={window2} />
        </svg>
    );
}

/**
 * Full brand mark (icon + wordmark). Uses the official maintyn PNG so the
 * red-dot 't' / 'y' and dark green house match the printed brand exactly.
 * Ideal for light-background placements.
 */
export function Logo({ className = "", size = 28 }) {
    return (
        <img
            src="/maintyn-logo.png"
            alt="maintyn"
            style={{ height: size, width: "auto" }}
            className={`inline-block select-none ${className}`}
            draggable={false}
        />
    );
}

/**
 * Icon-only variant using the cropped PNG (light-background use).
 */
export function LogoMark({ className = "", size = 28 }) {
    return (
        <img
            src="/maintyn-icon.png"
            alt="maintyn"
            style={{ height: size, width: "auto" }}
            className={`inline-block select-none ${className}`}
            draggable={false}
        />
    );
}

export default Logo;
