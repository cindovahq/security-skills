from django.conf import settings
from django.db import models


class Invoice(models.Model):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="invoices")
    number = models.CharField(max_length=32, unique=True)
    total = models.DecimalField(max_digits=10, decimal_places=2)
    status = models.CharField(max_length=16, default="open")
    billing_email = models.EmailField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.number
