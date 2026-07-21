import React, { useEffect, useMemo, useState } from "react";
import api, { formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PageHeader, EmptyState, Chip } from "@/components/Shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Plus, Trash, PencilSimple, ClockCounterClockwise, MapPin, Users as UsersIcon, CalendarBlank, X } from "@phosphor-icons/react";
import { toast } from "sonner";
import { format } from "date-fns";

const inr = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);
const toISODate = (d) => format(d, "yyyy-MM-dd");

const AMENITY_IMAGES = {
    "clubhouse": "https://images.unsplash.com/photo-1519974719765-e6559eac2575?crop=entropy&cs=tinysrgb&fm=jpg&w=800&q=80",
    "gym": "https://images.unsplash.com/photo-1571902943202-507ec2618e8f?crop=entropy&cs=tinysrgb&fm=jpg&w=800&q=80",
    "hall": "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?crop=entropy&cs=tinysrgb&fm=jpg&w=800&q=80",
    "pool": "https://images.unsplash.com/photo-1519315901367-f34ff9154487?crop=entropy&cs=tinysrgb&fm=jpg&w=800&q=80",
    "garden": "https://images.unsplash.com/photo-1560493676-04071c5f467b?crop=entropy&cs=tinysrgb&fm=jpg&w=800&q=80",
    "default": "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?crop=entropy&cs=tinysrgb&fm=jpg&w=800&q=80",
};

function pickImage(name = "", url) {
    if (url) return url;
    const key = Object.keys(AMENITY_IMAGES).find(k => name.toLowerCase().includes(k));
    return AMENITY_IMAGES[key || "default"];
}

export default function Amenities() {
    const { user } = useAuth();
    const isStaff = user?.role === "admin" || user?.role === "committee";
    const [amenities, setAmenities] = useState([]);
    const [bookings, setBookings] = useState([]);
    const [tab, setTab] = useState("browse");

    const [amenityOpen, setAmenityOpen] = useState(false);
    const [amEditing, setAmEditing] = useState(null);
    const [amForm, setAmForm] = useState({
        name: "", description: "", capacity: "", open_time: "06:00", close_time: "22:00",
        slot_duration_minutes: 60, price_per_slot: 0, is_active: true, image_url: "",
    });

    const [bookOpen, setBookOpen] = useState(false);
    const [bookAmenity, setBookAmenity] = useState(null);
    const [bookDate, setBookDate] = useState(new Date());
    const [slots, setSlots] = useState([]);
    const [selectedSlot, setSelectedSlot] = useState(null);
    const [bookNotes, setBookNotes] = useState("");
    const [loadingSlots, setLoadingSlots] = useState(false);

    async function loadAll() {
        try {
            const [a, b] = await Promise.all([api.get("/amenities"), api.get("/bookings")]);
            setAmenities(a.data); setBookings(b.data);
        } catch (e) { toast.error(formatError(e)); }
    }
    useEffect(() => { loadAll(); }, []);

    // ---- Amenity CRUD (staff) ----
    function openCreateAmenity() {
        setAmEditing(null);
        setAmForm({ name: "", description: "", capacity: "", open_time: "06:00", close_time: "22:00",
            slot_duration_minutes: 60, price_per_slot: 0, is_active: true, image_url: "" });
        setAmenityOpen(true);
    }
    function openEditAmenity(a) {
        setAmEditing(a);
        setAmForm({
            name: a.name, description: a.description || "", capacity: a.capacity || "",
            open_time: a.open_time, close_time: a.close_time,
            slot_duration_minutes: a.slot_duration_minutes, price_per_slot: a.price_per_slot,
            is_active: !!a.is_active, image_url: a.image_url || "",
        });
        setAmenityOpen(true);
    }
    async function submitAmenity(e) {
        e.preventDefault();
        const payload = {
            ...amForm,
            capacity: amForm.capacity ? Number(amForm.capacity) : null,
            slot_duration_minutes: Number(amForm.slot_duration_minutes) || 60,
            price_per_slot: Number(amForm.price_per_slot) || 0,
        };
        try {
            if (amEditing) {
                await api.patch(`/amenities/${amEditing.id}`, payload);
                toast.success("Amenity updated");
            } else {
                await api.post("/amenities", payload);
                toast.success("Amenity added");
            }
            setAmenityOpen(false);
            loadAll();
        } catch (err) { toast.error(formatError(err)); }
    }
    async function removeAmenity(a) {
        if (!confirm(`Delete ${a.name}? Future bookings will be cancelled.`)) return;
        try { await api.delete(`/amenities/${a.id}`); toast.success("Deleted"); loadAll(); }
        catch (e) { toast.error(formatError(e)); }
    }

    // ---- Booking flow ----
    async function openBook(a) {
        setBookAmenity(a);
        setBookDate(new Date());
        setSelectedSlot(null);
        setBookNotes("");
        setBookOpen(true);
        await fetchSlots(a.id, new Date());
    }
    async function fetchSlots(amenityId, date) {
        setLoadingSlots(true);
        try {
            const { data } = await api.get(`/amenities/${amenityId}/slots`, { params: { date: toISODate(date) } });
            setSlots(data.slots);
        } catch (e) { toast.error(formatError(e)); }
        finally { setLoadingSlots(false); }
    }
    useEffect(() => {
        if (bookAmenity && bookOpen) fetchSlots(bookAmenity.id, bookDate);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bookDate]);

    async function submitBooking() {
        if (!selectedSlot) { toast.error("Pick a time slot"); return; }
        try {
            await api.post("/bookings", {
                amenity_id: bookAmenity.id,
                date: toISODate(bookDate),
                start_time: selectedSlot.start_time,
                end_time: selectedSlot.end_time,
                notes: bookNotes || null,
            });
            toast.success("Booking confirmed! Check your email.");
            setBookOpen(false);
            loadAll();
        } catch (e) { toast.error(formatError(e)); }
    }

    async function cancelBooking(b) {
        if (!confirm("Cancel this booking?")) return;
        try { await api.post(`/bookings/${b.id}/cancel`); toast.success("Cancelled"); loadAll(); }
        catch (e) { toast.error(formatError(e)); }
    }

    const upcomingBookings = useMemo(() => {
        const today = toISODate(new Date());
        return bookings.filter(b => b.date >= today && b.status !== "cancelled")
            .sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));
    }, [bookings]);

    const pastBookings = useMemo(() => {
        const today = toISODate(new Date());
        return bookings.filter(b => b.date < today || b.status === "cancelled");
    }, [bookings]);

    return (
        <div className="animate-fade-up">
            <PageHeader
                overline="Community perks"
                title="Amenities"
                description="Book the clubhouse, gym, hall and more. Slot conflicts are auto-prevented."
                actions={isStaff && (
                    <Button data-testid="add-amenity-btn" onClick={openCreateAmenity}
                        className="rounded-full bg-brand-action hover:bg-brand-actionHover text-white active:scale-[0.98]">
                        <Plus size={16} className="mr-1.5" /> Add amenity
                    </Button>
                )}
            />

            <Tabs value={tab} onValueChange={setTab} className="w-full">
                <TabsList className="bg-white border border-brand-line rounded-full p-1 mb-6">
                    <TabsTrigger data-testid="tab-browse" value="browse" className="rounded-full data-[state=active]:bg-brand-ink data-[state=active]:text-white px-5">Browse</TabsTrigger>
                    <TabsTrigger data-testid="tab-mybookings" value="mine" className="rounded-full data-[state=active]:bg-brand-ink data-[state=active]:text-white px-5">
                        My bookings {upcomingBookings.length > 0 && <span className="ml-1.5 text-[10px] bg-brand-action text-white rounded-full px-1.5">{upcomingBookings.length}</span>}
                    </TabsTrigger>
                    {isStaff && <TabsTrigger data-testid="tab-all-bookings" value="all" className="rounded-full data-[state=active]:bg-brand-ink data-[state=active]:text-white px-5">All bookings</TabsTrigger>}
                </TabsList>

                <TabsContent value="browse">
                    {amenities.length === 0 ? (
                        <EmptyState title="No amenities yet" description={isStaff ? "Add your first amenity — clubhouse, gym, party hall..." : "Committee will add amenities soon."} />
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {amenities.map((a) => (
                                <div key={a.id} className="bg-white border border-brand-line rounded-sm overflow-hidden hover:-translate-y-1 hover:shadow-lg transition-transform duration-200 flex flex-col">
                                    <div className="h-40 bg-brand-sage overflow-hidden relative">
                                        <img src={pickImage(a.name, a.image_url)} alt={a.name} className="w-full h-full object-cover" />
                                        {!a.is_active && (
                                            <div className="absolute inset-0 bg-brand-ink/60 flex items-center justify-center">
                                                <Chip variant="danger">Inactive</Chip>
                                            </div>
                                        )}
                                    </div>
                                    <div className="p-5 flex-1 flex flex-col">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <h3 className="font-heading text-xl text-brand-ink tracking-tight">{a.name}</h3>
                                                {a.description && <p className="text-sm text-brand-inkSoft mt-1 leading-relaxed line-clamp-2">{a.description}</p>}
                                            </div>
                                            {a.price_per_slot > 0 && (
                                                <div className="text-right">
                                                    <p className="font-heading text-brand-ink text-lg">{inr(a.price_per_slot)}</p>
                                                    <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft">per slot</p>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-4 mt-4 text-xs text-brand-inkSoft">
                                            <span className="inline-flex items-center gap-1"><ClockCounterClockwise size={14} /> {a.open_time}–{a.close_time}</span>
                                            <span className="inline-flex items-center gap-1"><CalendarBlank size={14} /> {a.slot_duration_minutes} min</span>
                                            {a.capacity && <span className="inline-flex items-center gap-1"><UsersIcon size={14} /> {a.capacity}</span>}
                                        </div>
                                        <div className="mt-5 flex items-center gap-2">
                                            <Button data-testid={`book-amenity-${a.id}`} onClick={() => openBook(a)} disabled={!a.is_active}
                                                className="flex-1 rounded-full bg-brand-action hover:bg-brand-actionHover text-white active:scale-[0.98]">
                                                Book
                                            </Button>
                                            {isStaff && (
                                                <>
                                                    <button data-testid={`edit-amenity-${a.id}`} onClick={() => openEditAmenity(a)} className="p-2 hover:bg-brand-sage rounded-sm"><PencilSimple size={14} /></button>
                                                    {user?.role === "admin" && (
                                                        <button data-testid={`delete-amenity-${a.id}`} onClick={() => removeAmenity(a)} className="p-2 hover:bg-[#F5D6CE] rounded-sm text-brand-action"><Trash size={14} /></button>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="mine">
                    <BookingsTable bookings={[...upcomingBookings, ...pastBookings.filter(b => b.user_id === user.id)]} onCancel={cancelBooking} user={user} showUser={false} />
                </TabsContent>

                {isStaff && (
                    <TabsContent value="all">
                        <BookingsTable bookings={bookings} onCancel={cancelBooking} user={user} showUser={true} />
                    </TabsContent>
                )}
            </Tabs>

            {/* Amenity create/edit dialog */}
            <Dialog open={amenityOpen} onOpenChange={setAmenityOpen}>
                <DialogContent className="rounded-sm max-w-lg">
                    <DialogHeader><DialogTitle className="font-heading text-2xl tracking-tight">{amEditing ? "Edit amenity" : "Add amenity"}</DialogTitle></DialogHeader>
                    <form onSubmit={submitAmenity} className="space-y-4">
                        <div className="space-y-2"><Label>Name</Label>
                            <Input data-testid="amenity-name-input" required value={amForm.name} onChange={(e) => setAmForm({ ...amForm, name: e.target.value })} placeholder="Clubhouse" className="rounded-sm border-brand-line" />
                        </div>
                        <div className="space-y-2"><Label>Description</Label>
                            <Textarea rows={2} value={amForm.description} onChange={(e) => setAmForm({ ...amForm, description: e.target.value })} className="rounded-sm border-brand-line" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2"><Label>Open time</Label>
                                <Input type="time" required value={amForm.open_time} onChange={(e) => setAmForm({ ...amForm, open_time: e.target.value })} className="rounded-sm border-brand-line" />
                            </div>
                            <div className="space-y-2"><Label>Close time</Label>
                                <Input type="time" required value={amForm.close_time} onChange={(e) => setAmForm({ ...amForm, close_time: e.target.value })} className="rounded-sm border-brand-line" />
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-2"><Label>Slot (min)</Label>
                                <Input type="number" min={15} step={15} value={amForm.slot_duration_minutes} onChange={(e) => setAmForm({ ...amForm, slot_duration_minutes: e.target.value })} className="rounded-sm border-brand-line" />
                            </div>
                            <div className="space-y-2"><Label>Price / slot (₹)</Label>
                                <Input type="number" min={0} step={50} value={amForm.price_per_slot} onChange={(e) => setAmForm({ ...amForm, price_per_slot: e.target.value })} className="rounded-sm border-brand-line" />
                            </div>
                            <div className="space-y-2"><Label>Capacity</Label>
                                <Input type="number" min={0} value={amForm.capacity} onChange={(e) => setAmForm({ ...amForm, capacity: e.target.value })} className="rounded-sm border-brand-line" />
                            </div>
                        </div>
                        <div className="space-y-2"><Label>Image URL (optional)</Label>
                            <Input value={amForm.image_url} onChange={(e) => setAmForm({ ...amForm, image_url: e.target.value })} placeholder="https://..." className="rounded-sm border-brand-line" />
                        </div>
                        <div className="flex items-center justify-between border border-brand-line rounded-sm p-3">
                            <div>
                                <Label>Active</Label>
                                <p className="text-xs text-brand-inkSoft">Residents can only book active amenities</p>
                            </div>
                            <Switch data-testid="amenity-active-switch" checked={amForm.is_active} onCheckedChange={(v) => setAmForm({ ...amForm, is_active: v })} />
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setAmenityOpen(false)} className="rounded-full">Cancel</Button>
                            <Button type="submit" data-testid="amenity-submit-btn" className="rounded-full bg-brand-action hover:bg-brand-actionHover">{amEditing ? "Save" : "Add"}</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Booking dialog */}
            <Dialog open={bookOpen} onOpenChange={setBookOpen}>
                <DialogContent className="rounded-sm max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="font-heading text-2xl tracking-tight">Book {bookAmenity?.name}</DialogTitle>
                    </DialogHeader>
                    <div className="grid md:grid-cols-2 gap-6">
                        <div>
                            <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft mb-2">Pick a date</p>
                            <div className="border border-brand-line rounded-sm p-2 bg-white">
                                <Calendar
                                    mode="single"
                                    selected={bookDate}
                                    onSelect={(d) => d && setBookDate(d)}
                                    disabled={(d) => d < new Date(new Date().toDateString())}
                                    className="rounded-sm"
                                    data-testid="booking-calendar"
                                />
                            </div>
                        </div>
                        <div className="flex flex-col">
                            <p className="text-[10px] uppercase tracking-overline text-brand-inkSoft mb-2">
                                Available slots · {format(bookDate, "EEE, MMM d")}
                            </p>
                            <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
                                {loadingSlots && <p className="col-span-2 text-sm text-brand-inkSoft py-6 text-center">Loading slots...</p>}
                                {!loadingSlots && slots.length === 0 && <p className="col-span-2 text-sm text-brand-inkSoft py-6 text-center">No slots for this day.</p>}
                                {slots.map((s) => {
                                    const active = selectedSlot?.start_time === s.start_time;
                                    return (
                                        <button
                                            key={s.start_time}
                                            data-testid={`slot-${s.start_time}`}
                                            disabled={s.booked}
                                            onClick={() => setSelectedSlot(s)}
                                            className={`text-left px-3 py-2 rounded-sm text-sm border transition-colors duration-150 ${
                                                s.booked
                                                    ? "bg-brand-bg border-brand-line text-brand-inkSoft cursor-not-allowed line-through"
                                                    : active
                                                    ? "bg-brand-ink text-white border-brand-ink"
                                                    : "bg-white border-brand-line text-brand-ink hover:border-brand-ink"
                                            }`}
                                        >
                                            <p className="font-medium">{s.start_time} – {s.end_time}</p>
                                            <p className="text-[10px] uppercase tracking-overline mt-0.5 opacity-70">{s.booked ? "Booked" : "Available"}</p>
                                        </button>
                                    );
                                })}
                            </div>
                            {bookAmenity?.price_per_slot > 0 && selectedSlot && (
                                <p className="mt-3 text-sm text-brand-inkSoft">
                                    Price: <span className="font-heading text-brand-ink">{inr(bookAmenity.price_per_slot)}</span> · pay at reception
                                </p>
                            )}
                            <div className="space-y-2 mt-4">
                                <Label>Notes (optional)</Label>
                                <Textarea rows={2} value={bookNotes} onChange={(e) => setBookNotes(e.target.value)} placeholder="Birthday party, guests count..." className="rounded-sm border-brand-line" />
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setBookOpen(false)} className="rounded-full">Cancel</Button>
                        <Button type="button" onClick={submitBooking} data-testid="booking-submit-btn"
                            disabled={!selectedSlot}
                            className="rounded-full bg-brand-action hover:bg-brand-actionHover">
                            Confirm booking
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function BookingsTable({ bookings, onCancel, user, showUser }) {
    if (bookings.length === 0) return <EmptyState title="No bookings" description="Nothing booked yet." />;
    const today = format(new Date(), "yyyy-MM-dd");
    return (
        <div className="bg-white border border-brand-line rounded-sm overflow-hidden">
            <table className="w-full text-sm">
                <thead>
                    <tr className="bg-brand-bg border-b border-brand-line text-left">
                        {["Amenity", "Date", "Time", ...(showUser ? ["Booked by"] : []), "Status", ""].map(h => (
                            <th key={h} className="py-3 px-4 font-medium text-brand-inkSoft text-[10px] uppercase tracking-overline">{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {bookings.map((b) => {
                        const isFuture = b.date >= today && b.status !== "cancelled";
                        const canCancel = isFuture && (b.user_id === user.id || user.role !== "resident");
                        return (
                            <tr key={b.id} className="border-b border-brand-line/60 hover:bg-brand-bg/50">
                                <td className="py-3 px-4 font-medium text-brand-ink">{b.amenity_name || b.amenity?.name || "—"}</td>
                                <td className="py-3 px-4 text-brand-inkSoft">{b.date}</td>
                                <td className="py-3 px-4 text-brand-inkSoft">{b.start_time} – {b.end_time}</td>
                                {showUser && <td className="py-3 px-4 text-brand-inkSoft">{b.user_name} {b.flat_label && `(${b.flat_label})`}</td>}
                                <td className="py-3 px-4">
                                    <Chip variant={b.status === "cancelled" ? "danger" : b.status === "confirmed" ? "success" : "default"}>{b.status}</Chip>
                                </td>
                                <td className="py-3 px-4 text-right">
                                    {canCancel && (
                                        <button data-testid={`cancel-booking-${b.id}`} onClick={() => onCancel(b)} className="text-brand-action hover:underline text-xs font-medium inline-flex items-center gap-1">
                                            <X size={12} /> Cancel
                                        </button>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
