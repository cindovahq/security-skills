from django.urls import path

from . import views, webhooks

urlpatterns = [
    path("invoices/", views.invoice_list, name="invoice-list"),
    path("invoices/<int:pk>/", views.invoice_detail, name="invoice-detail"),
    path("invoices/<int:pk>/pdf/", views.invoice_pdf, name="invoice-pdf"),
    path("webhooks/payments/", webhooks.payment_webhook, name="payment-webhook"),
    path("webhooks/repo/", webhooks.repo_webhook, name="repo-webhook"),
]
