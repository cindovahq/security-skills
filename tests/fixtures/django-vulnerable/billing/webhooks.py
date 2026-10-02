import hashlib
import hmac
import json

from django.conf import settings
from django.http import HttpResponse, HttpResponseForbidden
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from .models import Invoice


@csrf_exempt
@require_POST
def payment_webhook(request):
    event = json.loads(request.body)
    if event.get("type") == "payment.succeeded":
        Invoice.objects.filter(pk=event["data"]["invoice_id"]).update(status="paid")
    return HttpResponse(status=204)


@csrf_exempt
@require_POST
def repo_webhook(request):
    secret = settings.REPO_WEBHOOK_SECRET.encode()
    expected = "sha256=" + hmac.new(secret, request.body, hashlib.sha256).hexdigest()
    supplied = request.headers.get("X-Signature-256", "")
    if not hmac.compare_digest(expected, supplied):
        return HttpResponseForbidden()
    payload = json.loads(request.body)
    return HttpResponse(f"received {payload.get('ref', '')[:40]}".encode(), content_type="text/plain", status=202)
