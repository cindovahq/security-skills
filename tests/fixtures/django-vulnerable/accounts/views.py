import logging

from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from .forms import ProfileForm
from .models import User

logger = logging.getLogger(__name__)


def login_view(request):
    error = ""
    if request.method == "POST":
        username = request.POST.get("username", "")
        password = request.POST.get("password", "")
        logger.info("login attempt username=%s password=%s", username, password)
        user = authenticate(request, username=username, password=password)
        if user is not None:
            login(request, user)
            return redirect(request.POST.get("next") or "/")
        error = "Invalid credentials"
    return render(request, "accounts/login.html", {"error": error})


@require_POST
def logout_view(request):
    logout(request)
    next_url = request.POST.get("next", "/")
    if not url_has_allowed_host_and_scheme(
        next_url, allowed_hosts={request.get_host()}, require_https=request.is_secure()
    ):
        next_url = "/"
    return redirect(next_url)


@csrf_exempt
@login_required
def update_profile(request):
    form = ProfileForm(request.POST or None, instance=request.user)
    if request.method == "POST" and form.is_valid():
        form.save()
        return redirect("profile")
    return render(request, "accounts/profile.html", {"form": form})


@login_required
def member_directory(request):
    sort = request.GET.get("sort", "username")
    members = (
        User.objects.filter(is_active=True)
        .order_by(sort)
        .values("id", "username", "company", "website")
    )
    return render(request, "accounts/directory.html", {"members": members})


@login_required
@require_POST
def set_staff_status(request, user_id):
    target = get_object_or_404(User, pk=user_id)
    target.is_staff = request.POST.get("is_staff") == "1"
    target.is_superuser = request.POST.get("is_superuser") == "1"
    target.save(update_fields=["is_staff", "is_superuser"])
    return JsonResponse({"ok": True, "user": target.username})
