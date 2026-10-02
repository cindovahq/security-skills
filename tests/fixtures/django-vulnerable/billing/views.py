from django.contrib.auth.decorators import login_required
from django.http import HttpResponse
from django.shortcuts import get_object_or_404, render

from .models import Invoice


@login_required
def invoice_list(request):
    invoices = Invoice.objects.filter(owner=request.user).order_by("-created_at")
    return render(request, "billing/invoice_list.html", {"invoices": invoices})


@login_required
def invoice_detail(request, pk):
    invoice = get_object_or_404(Invoice, pk=pk)
    return render(request, "billing/invoice_detail.html", {"invoice": invoice})


@login_required
def invoice_pdf(request, pk):
    invoice = get_object_or_404(Invoice, pk=pk, owner=request.user)
    response = HttpResponse(f"Invoice {invoice.number}: {invoice.total}", content_type="text/plain")
    response["Content-Disposition"] = f'attachment; filename="{invoice.number}.txt"'
    return response
