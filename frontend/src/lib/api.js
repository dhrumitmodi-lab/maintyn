import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API_BASE = `${BACKEND_URL}/api`;

const api = axios.create({
    baseURL: API_BASE,
    withCredentials: true,
});

api.interceptors.request.use((config) => {
    const token = localStorage.getItem("maintyn_token");
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

api.interceptors.response.use(
    (r) => r,
    (err) => {
        if (err?.response?.status === 401) {
            const path = window.location.pathname;
            if (path !== "/login" && path !== "/register" && path !== "/") {
                localStorage.removeItem("maintyn_token");
            }
        }
        return Promise.reject(err);
    }
);

export function formatError(err) {
    const d = err?.response?.data?.detail;
    if (!d) return err?.message || "Something went wrong";
    if (typeof d === "string") return d;
    if (Array.isArray(d)) return d.map((e) => e?.msg || JSON.stringify(e)).join(", ");
    if (d?.msg) return d.msg;
    return String(d);
}

export default api;
