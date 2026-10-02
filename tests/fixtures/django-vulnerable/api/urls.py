from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("accounts", views.AccountViewSet, basename="account")
router.register("tickets", views.TicketViewSet, basename="ticket")

urlpatterns = [
    path("", include(router.urls)),
    path("sync/", views.DeviceSyncView.as_view(), name="device-sync"),
]
