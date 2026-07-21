import { API_BASE } from "@/lib/api";

export function fileDownloadUrl(fid) {
    if (!fid) return null;
    const token = localStorage.getItem("maintyn_token");
    return `${API_BASE}/files/${fid}/download?auth=${encodeURIComponent(token || "")}`;
}
