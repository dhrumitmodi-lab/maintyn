"""Complaints routes: list/create with auto-assign, patch with reassign/status."""
from typing import Optional
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

router = APIRouter()


def _mount(app_module):
    db = app_module.db
    now_iso = app_module.now_iso
    new_id = app_module.new_id
    require_staff = app_module.require_staff
    get_current_user = app_module.get_current_user
    ComplaintIn = app_module.ComplaintIn
    ComplaintUpdate = app_module.ComplaintUpdate
    _notify_complaint_status = app_module._notify_complaint_status

    async def _auto_assign_staff(category: str) -> Optional[str]:
        """Round-robin: pick least-recently-auto-assigned active staff for this category."""
        candidates = await db.staff.find(
            {"category": category, "is_active": True}, {"_id": 0}
        ).to_list(500)
        if not candidates:
            return None
        candidates.sort(key=lambda s: (
            s.get("last_auto_assigned_at") or "",
            s.get("created_at") or "",
        ))
        chosen = candidates[0]
        await db.staff.update_one({"id": chosen["id"]}, {"$set": {"last_auto_assigned_at": now_iso()}})
        return chosen["id"]

    async def _staff_summary(sid: str) -> Optional[dict]:
        s = await db.staff.find_one({"id": sid}, {"_id": 0})
        if not s:
            return None
        return {"id": s["id"], "name": s["name"], "role_label": s.get("role_label"),
                "phone": s.get("phone"), "email": s.get("email"), "vendor_org": s.get("vendor_org")}

    @router.get("/complaints")
    async def list_complaints(user: dict = Depends(get_current_user)):
        query = {} if user["role"] in ("admin", "committee") else {"created_by": user["id"]}
        docs = await db.complaints.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)
        staff_ids = list({d["assigned_to"] for d in docs if d.get("assigned_to")})
        staff_map = {}
        if staff_ids:
            async for s in db.staff.find({"id": {"$in": staff_ids}}, {"_id": 0}):
                staff_map[s["id"]] = {
                    "id": s["id"], "name": s["name"], "role_label": s.get("role_label"),
                    "phone": s.get("phone"), "email": s.get("email"), "vendor_org": s.get("vendor_org"),
                }
        for d in docs:
            if d.get("assigned_to"):
                d["assigned_staff"] = staff_map.get(d["assigned_to"])
        return docs

    @router.post("/complaints")
    async def create_complaint(data: ComplaintIn, user: dict = Depends(get_current_user)):
        assigned = await _auto_assign_staff(data.category)
        c = {
            "id": new_id(),
            **data.model_dump(),
            "status": "open",
            "created_by": user["id"],
            "created_by_name": user["name"],
            "flat_id": user.get("flat_id"),
            "resolution_note": None,
            "resolved_by": None,
            "resolved_at": None,
            "assigned_to": assigned,
            "assigned_at": now_iso() if assigned else None,
            "created_at": now_iso(),
        }
        await db.complaints.insert_one(c)
        c.pop("_id", None)
        if assigned:
            summary = await _staff_summary(assigned)
            if summary:
                c["assigned_staff"] = summary
        return c

    @router.patch("/complaints/{cid}")
    async def update_complaint(cid: str, data: ComplaintUpdate, background: BackgroundTasks, user: dict = Depends(require_staff)):
        existing = await db.complaints.find_one({"id": cid})
        if not existing:
            raise HTTPException(404, "Complaint not found")
        payload = data.model_dump(exclude_unset=True)
        upd = {}
        for k, v in payload.items():
            if k == "assigned_to":
                if v is None or v == "":
                    upd["assigned_to"] = None
                    upd["assigned_at"] = None
                else:
                    s = await db.staff.find_one({"id": v})
                    if not s:
                        raise HTTPException(400, "Staff not found")
                    upd["assigned_to"] = v
                    upd["assigned_at"] = now_iso()
            elif v is not None:
                upd[k] = v
        if upd.get("status") == "resolved":
            upd["resolved_by"] = user["id"]
            upd["resolved_at"] = now_iso()
        if not upd:
            raise HTTPException(400, "No changes")
        await db.complaints.update_one({"id": cid}, {"$set": upd})
        doc = await db.complaints.find_one({"id": cid}, {"_id": 0})
        if doc.get("assigned_to"):
            summary = await _staff_summary(doc["assigned_to"])
            if summary:
                doc["assigned_staff"] = summary
        if upd.get("status") and upd["status"] != existing.get("status"):
            background.add_task(_notify_complaint_status, doc, upd["status"])
        return doc
