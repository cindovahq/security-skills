from django.urls import path

from . import views

urlpatterns = [
    path("tickets/", views.ticket_list, name="ticket-list"),
    path("tickets/<int:pk>/", views.ticket_detail, name="ticket-detail"),
    path("tickets/<int:pk>/comments/", views.add_comment, name="ticket-comment"),
    path("tickets/<int:pk>/upload/", views.upload_attachment, name="ticket-upload"),
    path("tickets/export/", views.request_export, name="ticket-export"),
    path("kb/search/", views.kb_search, name="kb-search"),
    path("kb/category/<int:category_id>/", views.articles_by_category, name="kb-category"),
    path("download/", views.download_report, name="download-report"),
    path("preview/", views.link_preview, name="link-preview"),
    path("rates/", views.exchange_rates, name="rates"),
    path("view-state/", views.restore_view_state, name="view-state"),
    path("dashboard/", views.dashboard, name="dashboard"),
]
