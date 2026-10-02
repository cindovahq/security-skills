from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    company = models.CharField(max_length=120, blank=True)
    website = models.CharField(max_length=200, blank=True)
    api_token = models.CharField(max_length=64, blank=True)

    def __str__(self):
        return self.username
