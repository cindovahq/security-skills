from django.urls import path

from . import views

urlpatterns = [
    path("login/", views.login_view, name="login"),
    path("logout/", views.logout_view, name="logout"),
    path("profile/", views.update_profile, name="profile"),
    path("directory/", views.member_directory, name="directory"),
    path("manage/users/<int:user_id>/staff/", views.set_staff_status, name="set-staff"),
]
