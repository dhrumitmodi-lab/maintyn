"""Invoice + Expense dashboards + Defaulter dunning endpoint."""
from datetime import datetime, timezone, timedelta, date as _date
from typing import List, Optional
from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel

router = APIRouter()


class DunningPayload(BaseModel):
    flat_ids: Optional[List[str]] = None
    subject: Optional[str] = None
    message: Optional[str] = None


def _mount(app_module):
    db = app_module.db
    require_staff = app_module.require_staff
    _flat_map = app_module._flat_map
    SOCIETY_ID = app_module.SOCIETY_ID
    send_email_raw = app_module.send_email_raw
    _email_frame = app_module._email_frame
    FRONTEND_URL = app_module.FRONTEND_URL

    @router.get("/invoices/stats")
    async def invoice_stats(_: dict = Depends(require_staff)):
        raised_agg = await db.invoices.aggregate([
            {"$group": {"_id": None, "total": {"$sum": "$amount"}, "count": {"$sum": 1}}}
        ]).to_list(1)
        paid_agg = await db.invoices.aggregate([
            {"$match": {"status": "paid"}},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}, "count": {"$sum": 1}}}
        ]).to_list(1)
        unpaid_agg = await db.invoices.aggregate([
            {"$match": {"status": "unpaid"}},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}, "count": {"$sum": 1}}}
        ]).to_list(1)

        raised_total = float(raised_agg[0]["total"]) if raised_agg else 0.0
        raised_count = int(raised_agg[0]["count"]) if raised_agg else 0
        received_total = float(paid_agg[0]["total"]) if paid_agg else 0.0
        received_count = int(paid_agg[0]["count"]) if paid_agg else 0
        pending_total = float(unpaid_agg[0]["total"]) if unpaid_agg else 0.0
        pending_count = int(unpaid_agg[0]["count"]) if unpaid_agg else 0
        collection_pct = int(round((received_total / raised_total) * 100)) if raised_total else 0

        threshold_iso = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
        per_flat = await db.invoices.aggregate([
            {"$match": {"status": "unpaid"}},
            {"$group": {
                "_id": "$flat_id",
                "unpaid_count": {"$sum": 1},
                "amount": {"$sum": "$amount"},
                "oldest": {"$min": "$created_at"},
            }},
            {"$match": {"oldest": {"$lte": threshold_iso}}},
            {"$sort": {"amount": -1}},
        ]).to_list(500)

        flat_ids = [p["_id"] for p in per_flat if p.get("_id")]
        flats_map = await _flat_map(flat_ids)
        residents_by_flat = {}
        if flat_ids:
            async for r in db.users.find({"flat_id": {"$in": flat_ids}}, {"password_hash": 0, "_id": 0}):
                residents_by_flat.setdefault(r["flat_id"], []).append(
                    {"id": r["id"], "name": r["name"], "email": r["email"], "phone": r.get("phone")}
                )

        now_utc = datetime.now(timezone.utc)
        defaulters = []
        for p in per_flat:
            flat = flats_map.get(p["_id"])
            if not flat:
                continue
            try:
                oldest_dt = datetime.fromisoformat(p["oldest"].replace("Z", "+00:00"))
            except Exception:
                continue
            months_pending = max(1, int((now_utc - oldest_dt).days // 30))
            defaulters.append({
                "flat_id": p["_id"],
                "flat_label": f"{flat['block']}-{flat['number']}",
                "unpaid_count": int(p["unpaid_count"]),
                "amount": float(p["amount"]),
                "oldest": p["oldest"],
                "months_pending": months_pending,
                "residents": residents_by_flat.get(p["_id"], []),
            })

        trend_agg = await db.invoices.aggregate([
            {"$group": {
                "_id": "$month",
                "raised": {"$sum": "$amount"},
                "received": {"$sum": {"$cond": [{"$eq": ["$status", "paid"]}, "$amount", 0]}},
            }},
            {"$sort": {"_id": -1}},
            {"$limit": 6},
        ]).to_list(6)
        trend = [{"month": t["_id"], "raised": float(t["raised"]), "received": float(t["received"])} for t in reversed(trend_agg)]

        return {
            "raised": {"total": raised_total, "count": raised_count},
            "received": {"total": received_total, "count": received_count},
            "pending": {"total": pending_total, "count": pending_count},
            "collection_pct": collection_pct,
            "defaulters": defaulters,
            "trend": trend,
        }

    async def _send_dunning_for_flat(flat_id: str, subject: str, preamble: Optional[str]) -> int:
        residents = await db.users.find({"flat_id": flat_id}, {"password_hash": 0}).to_list(50)
        if not residents:
            return 0
        unpaid = await db.invoices.find({"flat_id": flat_id, "status": "unpaid"}, {"_id": 0}).sort("created_at", 1).to_list(200)
        if not unpaid:
            return 0
        flat = await db.flats.find_one({"id": flat_id})
        flat_label = f"{flat['block']}-{flat['number']}" if flat else "your flat"
        society_doc = await db.society.find_one({"id": SOCIETY_ID}) or {}
        society_name = society_doc.get("name") or "Society"
        total_due = sum(float(i.get("amount", 0)) for i in unpaid)
        rows = "".join(
            f"<tr>"
            f"<td style='padding:6px;border-bottom:1px solid #E2DFD8'>{i.get('month','')}</td>"
            f"<td style='padding:6px;border-bottom:1px solid #E2DFD8'>{i.get('description','')}</td>"
            f"<td style='padding:6px;border-bottom:1px solid #E2DFD8;text-align:right'><b>₹{float(i.get('amount',0)):,.0f}</b></td>"
            f"<td style='padding:6px;border-bottom:1px solid #E2DFD8'>{i.get('due_date','')}</td>"
            f"</tr>"
            for i in unpaid
        )
        sent = 0
        for r in residents:
            preface = f"<p>{preamble}</p>" if preamble else ""
            body = (
                f"<p>Hi {r['name']},</p>"
                f"<p>This is a reminder from <b>{society_name}</b> — <b>{flat_label}</b> has "
                f"<b>{len(unpaid)}</b> unpaid maintenance invoice{'s' if len(unpaid)!=1 else ''} totalling <b>₹{total_due:,.0f}</b>.</p>"
                + preface +
                f"<table cellpadding='0' cellspacing='0' style='width:100%;border-collapse:collapse;font-size:13px;margin:12px 0'>"
                f"<thead><tr style='background:#F6F4F1'>"
                f"<th style='padding:6px;text-align:left;color:#576B61;font-weight:600'>Month</th>"
                f"<th style='padding:6px;text-align:left;color:#576B61;font-weight:600'>Description</th>"
                f"<th style='padding:6px;text-align:right;color:#576B61;font-weight:600'>Amount</th>"
                f"<th style='padding:6px;text-align:left;color:#576B61;font-weight:600'>Due date</th>"
                f"</tr></thead>"
                f"<tbody>{rows}</tbody>"
                f"</table>"
                f"<p>Please clear the dues at your earliest convenience — you can pay online and mark it paid from the invoice screen.</p>"
            )
            html = _email_frame(subject, body, f"{FRONTEND_URL}/app/invoices", "View & pay invoices")
            await send_email_raw(r["email"], subject, html)
            sent += 1
        return sent

    @router.post("/invoices/defaulters/remind")
    async def remind_defaulters(payload: DunningPayload, background: BackgroundTasks, _: dict = Depends(require_staff)):
        target_flats: List[str] = list(payload.flat_ids or [])
        if not target_flats:
            threshold_iso = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
            agg = await db.invoices.aggregate([
                {"$match": {"status": "unpaid"}},
                {"$group": {"_id": "$flat_id", "oldest": {"$min": "$created_at"}}},
                {"$match": {"oldest": {"$lte": threshold_iso}}},
            ]).to_list(1000)
            target_flats = [a["_id"] for a in agg if a.get("_id")]
        if not target_flats:
            return {"flats_targeted": 0, "emails_queued": 0}
        subject = payload.subject or "Reminder · Unpaid maintenance dues"
        total_residents = await db.users.count_documents({"flat_id": {"$in": target_flats}})
        for fid in target_flats:
            background.add_task(_send_dunning_for_flat, fid, subject, payload.message)
        return {"flats_targeted": len(target_flats), "emails_queued": total_residents}

    @router.get("/expenses/stats")
    async def expense_stats(_: dict = Depends(require_staff)):
        today = _date.today()
        keys = []
        y, m = today.year, today.month
        for _ in range(12):
            keys.append(f"{y:04d}-{m:02d}")
            m -= 1
            if m == 0:
                m = 12
                y -= 1
        keys.reverse()
        key_set = set(keys)

        income_agg = await db.invoices.aggregate([
            {"$match": {"status": "paid", "month": {"$in": list(key_set)}}},
            {"$group": {"_id": "$month", "total": {"$sum": "$amount"}}}
        ]).to_list(50)
        income_map = {r["_id"]: float(r["total"]) for r in income_agg}

        spent_agg = await db.expenses.aggregate([
            {"$group": {"_id": {"$substr": ["$date", 0, 7]}, "total": {"$sum": "$amount"}}}
        ]).to_list(200)
        spent_map = {r["_id"]: float(r["total"]) for r in spent_agg if r["_id"] in key_set}

        series = [
            {"month": k, "income": round(income_map.get(k, 0.0), 2), "spent": round(spent_map.get(k, 0.0), 2)}
            for k in keys
        ]

        last3 = series[-3:]
        def _avg(vals):
            vals = [v for v in vals if v > 0]
            return sum(vals) / len(vals) if vals else 0.0
        proj_income = _avg([s["income"] for s in last3])
        proj_spent = _avg([s["spent"] for s in last3])

        ny, nm = today.year, today.month
        proj_keys = []
        for _ in range(3):
            nm += 1
            if nm == 13:
                nm = 1
                ny += 1
            proj_keys.append(f"{ny:04d}-{nm:02d}")

        projection = [{"month": k, "income": round(proj_income, 2), "spent": round(proj_spent, 2)} for k in proj_keys]

        total_income = sum(s["income"] for s in series)
        total_spent = sum(s["spent"] for s in series)
        net = round(total_income - total_spent, 2)

        cat_agg = await db.expenses.aggregate([
            {"$match": {"date": {"$gte": keys[0] + "-01"}}},
            {"$group": {"_id": "$category", "total": {"$sum": "$amount"}}},
            {"$sort": {"total": -1}}
        ]).to_list(20)
        categories = [{"category": r["_id"] or "other", "total": float(r["total"])} for r in cat_agg]

        return {
            "window": {"from": keys[0], "to": keys[-1]},
            "series": series,
            "projection": projection,
            "totals": {"income": round(total_income, 2), "spent": round(total_spent, 2), "net": net},
            "avg": {"income": round(proj_income, 2), "spent": round(proj_spent, 2)},
            "categories": categories,
        }
