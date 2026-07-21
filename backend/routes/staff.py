"""Staff & Vendor directory routes.

Split out of server.py — imports shared plumbing (db proxy, deps, helpers, models)
lazily to avoid circular imports.
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException

router = APIRouter()


def _mount(app_module):
    """Wire the routes onto this router using symbols from server.py."""
    db = app_module.db
    now_iso = app_module.now_iso
    new_id = app_module.new_id
    require_staff = app_module.require_staff
    get_current_user = app_module.get_current_user
    StaffIn = app_module.StaffIn
    StaffUpdate = app_module.StaffUpdate

    @router.get("/staff")
    async def list_staff(user: dict = Depends(get_current_user), category: Optional[str] = None, active: Optional[bool] = None):
        q = {}
        if category:
            q["category"] = category
        if active is not None:
            q["is_active"] = active
        docs = await db.staff.find(q, {"_id": 0}).sort([("category", 1), ("name", 1)]).to_list(500)
        return docs

    @router.post("/staff")
    async def create_staff(data: StaffIn, _: dict = Depends(require_staff)):
        s = {"id": new_id(), **data.model_dump(), "created_at": now_iso()}
        await db.staff.insert_one(s)
        s.pop("_id", None)
        return s

    @router.patch("/staff/{sid}")
    async def update_staff(sid: str, data: StaffUpdate, _: dict = Depends(require_staff)):
        upd = {k: v for k, v in data.model_dump(exclude_unset=True).items()}
        if not upd:
            raise HTTPException(400, "No changes")
        upd["updated_at"] = now_iso()
        res = await db.staff.update_one({"id": sid}, {"$set": upd})
        if res.matched_count == 0:
            raise HTTPException(404, "Staff not found")
        return await db.staff.find_one({"id": sid}, {"_id": 0})

    @router.delete("/staff/{sid}")
    async def delete_staff(sid: str, _: dict = Depends(require_staff)):
        res = await db.staff.delete_one({"id": sid})
        if res.deleted_count == 0:
            raise HTTPException(404, "Staff not found")
        await db.complaints.update_many({"assigned_to": sid}, {"$set": {"assigned_to": None, "assigned_at": None}})
        return {"ok": True}
