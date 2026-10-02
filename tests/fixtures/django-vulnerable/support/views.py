import base64
import json
import os
import pickle
import re

import requests
from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.db.models import Q
from django.http import FileResponse, HttpResponseBadRequest, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST

from .models import Article, Attachment, Comment, Ticket
from .tasks import export_tickets

SORTS = {
    "newest": "-created_at",
    "oldest": "created_at",
    "title": "title",
    "priority": "priority",
}


@login_required
def ticket_list(request):
    filters = {k: v for k, v in request.GET.items() if k not in ("sort", "page")}
    tickets = Ticket.objects.filter(owner=request.user, **filters)
    tickets = tickets.order_by(SORTS.get(request.GET.get("sort"), "-created_at"))
    return render(request, "support/ticket_list.html", {"tickets": tickets})


@login_required
def dashboard(request):
    q = request.GET.get("q", "")
    tickets = Ticket.objects.filter(owner=request.user)
    if q:
        tickets = tickets.filter(Q(title__icontains=q) | Q(body__icontains=q))
    view_config = json.dumps({"user": request.user.username, "query": q, "filters": request.GET.dict()})
    return render(request, "support/dashboard.html", {"tickets": tickets[:20], "view_config": view_config})


def _visible_tickets(user):
    if user.is_staff:
        return Ticket.objects.all()
    return Ticket.objects.filter(owner=user)


@login_required
def ticket_detail(request, pk):
    ticket = get_object_or_404(_visible_tickets(request.user), pk=pk)
    meta = {"id": ticket.pk, "status": ticket.status, "title": ticket.title}
    return render(
        request,
        "support/ticket_detail.html",
        {"ticket": ticket, "comments": ticket.comments.select_related("author"), "ticket_meta": meta},
    )


@login_required
@require_POST
def add_comment(request, pk):
    ticket = get_object_or_404(_visible_tickets(request.user), pk=pk)
    Comment.objects.create(ticket=ticket, author=request.user, body=request.POST.get("body", ""))
    return redirect("ticket-detail", pk=ticket.pk)


@login_required
@require_POST
def upload_attachment(request, pk):
    ticket = get_object_or_404(Ticket, pk=pk, owner=request.user)
    upload = request.FILES.get("file")
    if upload is None:
        return HttpResponseBadRequest("file required")
    Attachment.objects.create(ticket=ticket, uploaded_by=request.user, file=upload)
    return redirect("ticket-detail", pk=ticket.pk)


def kb_search(request):
    q = request.GET.get("q", "")
    articles = Article.objects.raw(
        f"SELECT * FROM support_article WHERE published = 1 AND title LIKE '%{q}%'"
    )
    return JsonResponse({"results": [{"id": a.pk, "title": a.title} for a in articles]})


def articles_by_category(request, category_id):
    articles = Article.objects.raw(
        "SELECT * FROM support_article WHERE published = 1 AND category_id = %s", [category_id]
    )
    return JsonResponse({"results": [{"id": a.pk, "title": a.title} for a in articles]})


@login_required
def download_report(request):
    name = request.GET.get("file", "")
    path = os.path.join(settings.BASE_DIR, "reports", name)
    return FileResponse(open(path, "rb"), as_attachment=True)


@login_required
def link_preview(request):
    url = request.GET.get("url", "")
    resp = requests.get(url, timeout=5)
    match = re.search(r"<title>(.*?)</title>", resp.text, re.S | re.I)
    return JsonResponse(
        {"status": resp.status_code, "title": match.group(1).strip() if match else "", "body": resp.text[:2000]}
    )


@login_required
def exchange_rates(request):
    resp = requests.get(settings.FX_RATES_URL, timeout=5)
    return JsonResponse(resp.json())


@login_required
def restore_view_state(request):
    raw = request.COOKIES.get("view_state", "")
    state = pickle.loads(base64.b64decode(raw)) if raw else {}
    return JsonResponse({"restored": sorted(state.keys()) if isinstance(state, dict) else []})


@login_required
@require_POST
def request_export(request):
    export_tickets.delay(request.user.pk, request.POST.get("name", "export"))
    return JsonResponse({"queued": True}, status=202)
